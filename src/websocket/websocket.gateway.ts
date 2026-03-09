import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
@WebSocketGateway({ cors: { origin: '*' } })
export class WebsocketGateway {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WebsocketGateway.name);

  emitStockUpdate(
    eventId: string,
    categories: Array<{ id: string; name: string; availableStock: number }>,
  ) {
    if (!this.server) {
      this.logger.warn('[WS] Server not initialized, skipping emit');
      return;
    }
    this.server.emit('ticket:stock-updated', { eventId, categories });
    this.logger.log(
      `[WS] ticket:stock-updated emitted | Event: ${eventId} | Categories: ${JSON.stringify(categories)}`,
    );
  }
}
