import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrdersService } from '../orders.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueuesService } from '../../queues/queues.service';
import { WebsocketGateway } from '../../websocket/websocket.gateway';
import {
  OrderStatus,
  EventStatus,
  RefundPolicy,
} from '../../generated/prisma/client/client';
import { AuthUser } from '../../auth/strategies/jwt.strategy';

// ─── Stripe mock ──────────────────────────────────────────────────────────────

const mockStripePaymentIntentsCreate = jest.fn();
const mockStripeRefundsCreate = jest.fn();

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: { create: mockStripePaymentIntentsCreate },
    refunds: { create: mockStripeRefundsCreate },
  }));
});

// ─── Dependency mocks ─────────────────────────────────────────────────────────

const mockPrisma = {
  ticketCategory: { findUnique: jest.fn(), update: jest.fn() },
  order: {
    create: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    aggregate: jest.fn(),
  },
  ticket: { deleteMany: jest.fn() },
  $transaction: jest.fn(),
};

const mockConfig = {
  get: jest.fn().mockReturnValue('sk_test_mock'),
};

const mockQueuesService = {
  addOrderExpiryJob: jest.fn(),
  addEmailJob: jest.fn(),
};

const mockWsGateway = {
  emitStockForEvent: jest.fn().mockResolvedValue(undefined),
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockUser: AuthUser = {
  id: 'user-uuid-1',
  email: 'john@example.com',
  name: 'John',
  role: 'CUSTOMER' as AuthUser['role'],
};

const futureDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

const mockCategory = {
  id: 'cat-uuid-1',
  name: 'VIP',
  price: '150.00',
  availableStock: 100,
  maxTicketsPerUser: 4,
  refundPolicy: RefundPolicy.PARTIAL,
  refundPercentage: 80,
  refundDeadlineHours: 48,
  event: {
    id: 'event-uuid-1',
    title: 'Rock Festival',
    date: futureDate,
    location: 'MSG',
    status: EventStatus.PUBLISHED,
  },
};

const mockOrder = {
  id: 'order-uuid-1',
  userId: mockUser.id,
  eventId: 'event-uuid-1',
  categoryId: 'cat-uuid-1',
  quantity: 2,
  totalAmount: '300.00',
  status: OrderStatus.PENDING,
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  stripePaymentIntentId: 'pi_mock_123',
  tickets: [{ id: 'ticket-1' }, { id: 'ticket-2' }],
  user: { email: mockUser.email, name: mockUser.name },
  event: { title: 'Rock Festival', date: futureDate, location: 'MSG' },
  category: {
    refundPolicy: RefundPolicy.PARTIAL,
    refundPercentage: 80,
    refundDeadlineHours: 48,
  },
};

const mockPaymentIntent = {
  id: 'pi_mock_123',
  client_secret: 'pi_mock_123_secret_abc',
};

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('OrdersService', () => {
  let service: OrdersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: QueuesService, useValue: mockQueuesService },
        { provide: WebsocketGateway, useValue: mockWsGateway },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
    jest.clearAllMocks();
  });

  // ─── checkout ──────────────────────────────────────────────────────────────

  describe('checkout', () => {
    const dto = { categoryId: 'cat-uuid-1', quantity: 2 };

    beforeEach(() => {
      // Default happy path mocks
      mockPrisma.ticketCategory.findUnique.mockResolvedValue(mockCategory);
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
          // Simulate inner transaction: re-fetch category + aggregate + create order + update stock
          mockPrisma.ticketCategory.findUnique.mockResolvedValueOnce(
            mockCategory,
          );
          mockPrisma.order.aggregate.mockResolvedValueOnce({
            _sum: { quantity: 0 },
          });
          mockPrisma.order.create.mockResolvedValueOnce({ ...mockOrder });
          mockPrisma.ticketCategory.update.mockResolvedValueOnce({});
          return fn(mockPrisma);
        },
      );
      mockStripePaymentIntentsCreate.mockResolvedValue(mockPaymentIntent);
      mockPrisma.order.update.mockResolvedValue({});
      mockQueuesService.addOrderExpiryJob.mockResolvedValue(undefined);
      mockQueuesService.addEmailJob.mockResolvedValue(undefined);
    });

    it('should create order and return stripeClientSecret', async () => {
      const result = await service.checkout(dto, mockUser);

      expect(result).toHaveProperty('orderId', mockOrder.id);
      expect(result).toHaveProperty(
        'stripeClientSecret',
        mockPaymentIntent.client_secret,
      );
      expect(result.status).toBe(OrderStatus.PENDING);
    });

    it('should throw NotFoundException if category not found', async () => {
      mockPrisma.ticketCategory.findUnique.mockResolvedValue(null);

      await expect(service.checkout(dto, mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if event is not PUBLISHED', async () => {
      mockPrisma.ticketCategory.findUnique.mockResolvedValue({
        ...mockCategory,
        event: { ...mockCategory.event, status: EventStatus.DRAFT },
      });

      await expect(service.checkout(dto, mockUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if not enough stock', async () => {
      mockPrisma.ticketCategory.findUnique.mockResolvedValue(mockCategory);
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
          mockPrisma.ticketCategory.findUnique.mockResolvedValueOnce({
            ...mockCategory,
            availableStock: 1, // less than requested quantity=2
          });
          return fn(mockPrisma);
        },
      );

      await expect(service.checkout(dto, mockUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if user exceeds maxTicketsPerUser', async () => {
      mockPrisma.ticketCategory.findUnique.mockResolvedValue(mockCategory);
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
          mockPrisma.ticketCategory.findUnique.mockResolvedValueOnce(
            mockCategory,
          );
          // User already has 3 tickets, maxTicketsPerUser=4, requesting 2 → total 5 > 4
          mockPrisma.order.aggregate.mockResolvedValueOnce({
            _sum: { quantity: 3 },
          });
          return fn(mockPrisma);
        },
      );

      await expect(service.checkout(dto, mockUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should rollback order and restore stock if Stripe fails', async () => {
      mockStripePaymentIntentsCreate.mockRejectedValue(
        new Error('Stripe error'),
      );

      // Rollback transaction
      const rollbackTx = {
        ticket: { deleteMany: jest.fn() },
        order: { update: jest.fn() },
        ticketCategory: { update: jest.fn() },
      };
      mockPrisma.$transaction
        .mockImplementationOnce(
          async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
            mockPrisma.ticketCategory.findUnique.mockResolvedValueOnce(
              mockCategory,
            );
            mockPrisma.order.aggregate.mockResolvedValueOnce({
              _sum: { quantity: 0 },
            });
            mockPrisma.order.create.mockResolvedValueOnce({ ...mockOrder });
            mockPrisma.ticketCategory.update.mockResolvedValueOnce({});
            return fn(mockPrisma);
          },
        )
        .mockImplementationOnce(
          async (fn: (tx: typeof rollbackTx) => Promise<unknown>) =>
            fn(rollbackTx),
        );

      await expect(service.checkout(dto, mockUser)).rejects.toThrow(
        BadRequestException,
      );
      expect(rollbackTx.ticket.deleteMany).toHaveBeenCalledWith({
        where: { orderId: mockOrder.id },
      });
      expect(rollbackTx.ticketCategory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { availableStock: { increment: dto.quantity } },
        }),
      );
    });

    it('should throw BadRequestException if client_secret is null', async () => {
      mockStripePaymentIntentsCreate.mockResolvedValue({
        ...mockPaymentIntent,
        client_secret: null,
      });

      await expect(service.checkout(dto, mockUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should enqueue order expiry job after successful checkout', async () => {
      await service.checkout(dto, mockUser);

      expect(mockQueuesService.addOrderExpiryJob).toHaveBeenCalledWith(
        mockOrder.id,
        expect.any(Number),
      );
    });
  });

  // ─── refund ────────────────────────────────────────────────────────────────

  describe('refund', () => {
    const paidOrder = { ...mockOrder, status: OrderStatus.PAID };

    beforeEach(() => {
      mockPrisma.order.findFirst.mockResolvedValue(paidOrder);
      mockStripeRefundsCreate.mockResolvedValue({});
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
          mockPrisma.order.update.mockResolvedValueOnce({
            ...paidOrder,
            status: OrderStatus.PARTIALLY_REFUNDED,
          });
          mockPrisma.ticketCategory.update.mockResolvedValueOnce({});
          return fn(mockPrisma);
        },
      );
      mockQueuesService.addEmailJob.mockResolvedValue(undefined);
      mockWsGateway.emitStockForEvent.mockResolvedValue(undefined);
    });

    it('should process partial refund and return refund details', async () => {
      const result = await service.refund('order-uuid-1', mockUser);

      expect(mockStripeRefundsCreate).toHaveBeenCalledWith({
        payment_intent: paidOrder.stripePaymentIntentId,
        amount: expect.any(Number) as number,
      });
      expect(result).toHaveProperty('refundAmount');
      expect(result).toHaveProperty('refundPercentage', 80);
    });

    it('should throw NotFoundException if order not found', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(null);

      await expect(service.refund('nonexistent', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if order is not PAID', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({
        ...paidOrder,
        status: OrderStatus.PENDING,
      });

      await expect(service.refund('order-uuid-1', mockUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw ForbiddenException if category is NON_REFUNDABLE', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({
        ...paidOrder,
        category: {
          ...paidOrder.category,
          refundPolicy: RefundPolicy.NON_REFUNDABLE,
        },
      });

      await expect(service.refund('order-uuid-1', mockUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw BadRequestException if refund deadline has passed', async () => {
      // Event is in 10 hours, deadline is 48h before → deadline already passed
      const soonEvent = new Date(Date.now() + 10 * 60 * 60 * 1000);
      mockPrisma.order.findFirst.mockResolvedValue({
        ...paidOrder,
        event: { ...paidOrder.event, date: soonEvent },
      });

      await expect(service.refund('order-uuid-1', mockUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if stripePaymentIntentId is null', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({
        ...paidOrder,
        stripePaymentIntentId: null,
      });

      await expect(service.refund('order-uuid-1', mockUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should enqueue refund email and emit stock after successful refund', async () => {
      await service.refund('order-uuid-1', mockUser);

      expect(mockQueuesService.addEmailJob).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'refund' }),
      );
      expect(mockWsGateway.emitStockForEvent).toHaveBeenCalledWith(
        paidOrder.eventId,
      );
    });
  });

  // ─── expireOrder ───────────────────────────────────────────────────────────

  describe('expireOrder', () => {
    it('should expire PENDING order, restore stock, and return true', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.PENDING,
      });
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
          mockPrisma.order.update.mockResolvedValueOnce({});
          mockPrisma.ticketCategory.update.mockResolvedValueOnce({});
          return fn(mockPrisma);
        },
      );
      mockQueuesService.addEmailJob.mockResolvedValue(undefined);
      mockWsGateway.emitStockForEvent.mockResolvedValue(undefined);

      const result = await service.expireOrder('order-uuid-1');

      expect(result).toBe(true);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockQueuesService.addEmailJob).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'expired' }),
      );
      expect(mockWsGateway.emitStockForEvent).toHaveBeenCalledWith(
        mockOrder.eventId,
      );
    });

    it('should return false if order not found', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      const result = await service.expireOrder('nonexistent');

      expect(result).toBe(false);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should return false if order is not PENDING (already PAID, EXPIRED, etc.)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.PAID,
      });

      const result = await service.expireOrder('order-uuid-1');

      expect(result).toBe(false);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ─── findMyOrders ──────────────────────────────────────────────────────────

  describe('findMyOrders', () => {
    it('should return all orders for the given userId', async () => {
      const orders = [mockOrder, { ...mockOrder, id: 'order-uuid-2' }];
      mockPrisma.order.findMany.mockResolvedValue(orders);

      const result = await service.findMyOrders(mockUser.id);

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: mockUser.id },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(result).toHaveLength(2);
    });

    it('should return empty array if user has no orders', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);

      const result = await service.findMyOrders(mockUser.id);

      expect(result).toEqual([]);
    });
  });

  // ─── findOne ───────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return the order when found', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(mockOrder);

      const result = await service.findOne('order-uuid-1', mockUser.id);

      expect(mockPrisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-uuid-1', userId: mockUser.id },
        }),
      );
      expect(result).toMatchObject({ id: mockOrder.id });
    });

    it('should throw NotFoundException if order is not found', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(null);

      await expect(service.findOne('nonexistent', mockUser.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
