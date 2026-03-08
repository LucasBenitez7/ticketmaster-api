import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ORDER_EXPIRY_QUEUE } from '../queues.constants';
import { JOB_ORDER_EXPIRY, OrderExpiryJobData } from '../queues.service';
import { OrdersService } from '../../orders/orders.service';

@Processor(ORDER_EXPIRY_QUEUE)
export class OrderExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderExpiryProcessor.name);

  constructor(private readonly ordersService: OrdersService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== JOB_ORDER_EXPIRY) return;

    const { orderId } = job.data as OrderExpiryJobData;

    this.logger.log(`Processing order expiry for orderId: ${orderId}`);

    try {
      const expired = await this.ordersService.expireOrder(orderId);

      if (expired) {
        this.logger.log(`Order ${orderId} expired and stock restored`);
      } else {
        this.logger.log(`Order ${orderId} skipped — already in a final state`);
      }
    } catch (error) {
      this.logger.error(`Failed to expire order ${orderId}`, error);
      throw error;
    }
  }
}
