import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrderExpiryProcessor } from '../queues/processors/order-expiry.processor';
import { EmailProcessor } from '../queues/processors/email.processor';
import { QueuesModule } from '../queues/queues.module';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [QueuesModule, WebsocketModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderExpiryProcessor, EmailProcessor],
  exports: [OrdersService],
})
export class OrdersModule {}
