import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrderExpiryProcessor } from '../queues/processors/order-expiry.processor';
import { QueuesService } from '../queues/queues.service';
import { ORDER_EXPIRY_QUEUE, EMAIL_QUEUE } from '../queues/queues.constants';
import { EmailProcessor } from '../queues/processors/email.processor';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: ORDER_EXPIRY_QUEUE },
      { name: EMAIL_QUEUE },
    ),
  ],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrderExpiryProcessor,
    QueuesService,
    EmailProcessor,
  ],
  exports: [OrdersService, QueuesService],
})
export class OrdersModule {}
