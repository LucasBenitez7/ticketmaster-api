import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueuesService } from './queues.service';
import { ORDER_EXPIRY_QUEUE, EMAIL_QUEUE } from './queues.constants';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: ORDER_EXPIRY_QUEUE },
      { name: EMAIL_QUEUE },
    ),
  ],
  providers: [QueuesService],
  exports: [QueuesService],
})
export class QueuesModule {}
