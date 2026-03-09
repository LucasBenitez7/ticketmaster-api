import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import {
  QueuesService,
  JOB_ORDER_EXPIRY,
  JOB_SEND_EMAIL,
} from '../queues.service';
import { ORDER_EXPIRY_QUEUE, EMAIL_QUEUE } from '../queues.constants';

const mockOrderExpiryQueue = { add: jest.fn() };
const mockEmailQueue = { add: jest.fn() };

describe('QueuesService', () => {
  let service: QueuesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueuesService,
        {
          provide: getQueueToken(ORDER_EXPIRY_QUEUE),
          useValue: mockOrderExpiryQueue,
        },
        { provide: getQueueToken(EMAIL_QUEUE), useValue: mockEmailQueue },
      ],
    }).compile();

    service = module.get<QueuesService>(QueuesService);
    jest.clearAllMocks();
  });

  // ─── addOrderExpiryJob ─────────────────────────────────────────────────────

  describe('addOrderExpiryJob', () => {
    it('should add a job to the order-expiry queue with correct params', async () => {
      await service.addOrderExpiryJob('order-uuid-1', 900000);

      expect(mockOrderExpiryQueue.add).toHaveBeenCalledWith(
        JOB_ORDER_EXPIRY,
        { orderId: 'order-uuid-1' },
        expect.objectContaining({
          delay: 900000,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        }),
      );
    });

    it('should not call the email queue', async () => {
      await service.addOrderExpiryJob('order-uuid-1', 900000);
      expect(mockEmailQueue.add).not.toHaveBeenCalled();
    });
  });

  // ─── addEmailJob ───────────────────────────────────────────────────────────

  describe('addEmailJob', () => {
    const purchasePayload = {
      type: 'purchase' as const,
      to: 'user@example.com',
      userName: 'John',
      orderId: 'order-uuid-1',
      eventTitle: 'Rock Festival',
      eventDate: new Date('2026-08-15'),
      eventLocation: 'MSG',
      quantity: 2,
      totalAmount: 300,
      categoryName: 'VIP',
    };

    it('should add a job to the email queue with correct payload', async () => {
      await service.addEmailJob(purchasePayload);

      expect(mockEmailQueue.add).toHaveBeenCalledWith(
        JOB_SEND_EMAIL,
        purchasePayload,
        expect.objectContaining({
          delay: 0,
          attempts: 3,
          backoff: { type: 'exponential', delay: 3000 },
          removeOnComplete: true,
          removeOnFail: false,
        }),
      );
    });

    it('should respect the delay parameter', async () => {
      await service.addEmailJob(purchasePayload, 86400000);

      expect(mockEmailQueue.add).toHaveBeenCalledWith(
        JOB_SEND_EMAIL,
        purchasePayload,
        expect.objectContaining({ delay: 86400000 }),
      );
    });

    it('should default delay to 0 if not provided', async () => {
      await service.addEmailJob(purchasePayload);

      expect(mockEmailQueue.add).toHaveBeenCalledWith(
        JOB_SEND_EMAIL,
        purchasePayload,
        expect.objectContaining({ delay: 0 }),
      );
    });

    it('should not call the order-expiry queue', async () => {
      await service.addEmailJob(purchasePayload);
      expect(mockOrderExpiryQueue.add).not.toHaveBeenCalled();
    });
  });
});
