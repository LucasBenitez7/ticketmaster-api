import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { WebhooksService } from '../webhooks.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueuesService } from '../../queues/queues.service';
import { WebsocketGateway } from '../../websocket/websocket.gateway';
import { OrderStatus } from '../../generated/prisma/client/client';

// ─── Stripe mock ──────────────────────────────────────────────────────────────

const mockConstructEvent = jest.fn();

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
  }));
});

// ─── Dependency mocks ─────────────────────────────────────────────────────────

const mockPrisma = {
  order: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  ticketCategory: { update: jest.fn() },
  $transaction: jest.fn(),
};

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'STRIPE_SECRET_KEY') return 'sk_test_mock';
    if (key === 'STRIPE_WEBHOOK_SECRET') return 'whsec_mock';
    return undefined;
  }),
};

const mockQueuesService = { addEmailJob: jest.fn() };
const mockWsGateway = {
  emitStockForEvent: jest.fn().mockResolvedValue(undefined),
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockOrder = {
  id: 'order-uuid-1',
  status: OrderStatus.PENDING,
  quantity: 2,
  totalAmount: '300.00',
  categoryId: 'cat-uuid-1',
  eventId: 'event-uuid-1',
  stripePaymentIntentId: 'pi_mock_123',
  user: { email: 'john@example.com', name: 'John' },
  event: {
    title: 'Rock Festival',
    date: new Date('2026-08-15'),
    location: 'MSG',
  },
  category: { name: 'VIP' },
  tickets: [],
};

const mockPaymentIntent = {
  id: 'pi_mock_123',
  metadata: { orderId: 'order-uuid-1' },
} as unknown as Stripe.PaymentIntent;

const mockStripeEvent = (type: string, object: unknown): Stripe.Event =>
  ({ type, data: { object } }) as unknown as Stripe.Event;

const rawBody = Buffer.from('{}');
const signature = 't=123,v1=abc';

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('WebhooksService', () => {
  let service: WebhooksService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: QueuesService, useValue: mockQueuesService },
        { provide: WebsocketGateway, useValue: mockWsGateway },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
    jest.clearAllMocks();
  });

  // ─── handleStripeWebhook ───────────────────────────────────────────────────

  describe('handleStripeWebhook', () => {
    it('should return { received: true } on valid event', async () => {
      mockConstructEvent.mockReturnValue(
        mockStripeEvent('payment_intent.succeeded', mockPaymentIntent),
      );
      mockPrisma.order.findFirst.mockResolvedValue({ ...mockOrder });
      mockPrisma.order.update.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.PAID,
      });

      const result = await service.handleStripeWebhook(rawBody, signature);

      expect(result).toEqual({ received: true });
    });

    it('should throw BadRequestException if webhook secret is not configured', async () => {
      // Creamos una instancia con STRIPE_WEBHOOK_SECRET=undefined pero STRIPE_SECRET_KEY válida
      const configWithoutWebhookSecret = {
        get: jest.fn((key: string) => {
          if (key === 'STRIPE_SECRET_KEY') return 'sk_test_mock';
          return undefined; // STRIPE_WEBHOOK_SECRET no definida
        }),
      };
      const moduleNoSecret = await Test.createTestingModule({
        providers: [
          WebhooksService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ConfigService, useValue: configWithoutWebhookSecret },
          { provide: QueuesService, useValue: mockQueuesService },
          { provide: WebsocketGateway, useValue: mockWsGateway },
        ],
      }).compile();
      const serviceNoSecret =
        moduleNoSecret.get<WebhooksService>(WebhooksService);

      await expect(
        serviceNoSecret.handleStripeWebhook(rawBody, signature),
      ).rejects.toThrow(BadRequestException);
      expect(mockConstructEvent).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if signature verification fails', async () => {
      mockConstructEvent.mockImplementation(() => {
        throw new Error('Webhook signature verification failed');
      });

      await expect(
        service.handleStripeWebhook(rawBody, 'bad-sig'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle unrecognized event types without throwing', async () => {
      mockConstructEvent.mockReturnValue(
        mockStripeEvent('customer.created', {}),
      );

      await expect(
        service.handleStripeWebhook(rawBody, signature),
      ).resolves.toEqual({
        received: true,
      });
    });
  });

  // ─── handlePaymentSucceeded ────────────────────────────────────────────────

  describe('handlePaymentSucceeded (via payment_intent.succeeded)', () => {
    beforeEach(() => {
      mockConstructEvent.mockReturnValue(
        mockStripeEvent('payment_intent.succeeded', mockPaymentIntent),
      );
    });

    it('should mark order as PAID and enqueue purchase email', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({ ...mockOrder });
      mockPrisma.order.update.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.PAID,
      });

      await service.handleStripeWebhook(rawBody, signature);

      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: mockOrder.id },
        data: { status: OrderStatus.PAID },
      });
      expect(mockQueuesService.addEmailJob).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'purchase', to: mockOrder.user.email }),
      );
      expect(mockWsGateway.emitStockForEvent).toHaveBeenCalledWith(
        mockOrder.eventId,
      );
    });

    it('should do nothing if order not found', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(null);

      await service.handleStripeWebhook(rawBody, signature);

      expect(mockPrisma.order.update).not.toHaveBeenCalled();
      expect(mockQueuesService.addEmailJob).not.toHaveBeenCalled();
    });

    it('should skip if order is already PAID (idempotency)', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.PAID,
      });

      await service.handleStripeWebhook(rawBody, signature);

      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    it('should not mark PAID if order is EXPIRED (no late transitions)', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.EXPIRED,
      });

      await service.handleStripeWebhook(rawBody, signature);

      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    it('should not mark PAID if order is FAILED', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.FAILED,
      });

      await service.handleStripeWebhook(rawBody, signature);

      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });
  });

  // ─── handlePaymentFailed ───────────────────────────────────────────────────

  describe('handlePaymentFailed (via payment_intent.payment_failed)', () => {
    beforeEach(() => {
      mockConstructEvent.mockReturnValue(
        mockStripeEvent('payment_intent.payment_failed', mockPaymentIntent),
      );
    });

    it('should mark order as FAILED and restore stock', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({ ...mockOrder });
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<void>) => fn(mockPrisma),
      );
      mockPrisma.order.update.mockResolvedValue({});
      mockPrisma.ticketCategory.update.mockResolvedValue({});

      await service.handleStripeWebhook(rawBody, signature);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: mockOrder.id },
        data: { status: OrderStatus.FAILED },
      });
      expect(mockPrisma.ticketCategory.update).toHaveBeenCalledWith({
        where: { id: mockOrder.categoryId },
        data: { availableStock: { increment: mockOrder.quantity } },
      });
      expect(mockWsGateway.emitStockForEvent).toHaveBeenCalledWith(
        mockOrder.eventId,
      );
    });

    it('should do nothing if order not found', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(null);

      await service.handleStripeWebhook(rawBody, signature);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
