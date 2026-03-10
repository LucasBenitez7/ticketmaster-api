import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ORDER_EXPIRY_QUEUE, EMAIL_QUEUE } from './queues.constants';
import { EmailPayload } from '../email/email.types';

export const JOB_ORDER_EXPIRY = 'order-expiry';
export const JOB_SEND_EMAIL = 'send-email';

export interface OrderExpiryJobData {
  orderId: string;
}

@Injectable()
export class QueuesService {
  constructor(
    @InjectQueue(ORDER_EXPIRY_QUEUE) private readonly orderExpiryQueue: Queue,
    @InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue,
  ) {}

  async addOrderExpiryJob(orderId: string, delayMs: number): Promise<void> {
    await this.orderExpiryQueue.add(
      JOB_ORDER_EXPIRY,
      { orderId } satisfies OrderExpiryJobData,
      {
        delay: delayMs,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  async addEmailJob(payload: EmailPayload, delayMs = 0): Promise<void> {
    await this.emailQueue.add(JOB_SEND_EMAIL, payload, {
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }
}
