import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

// El decorador se evalúa antes de la DI, por eso leemos process.env directamente.
const wsOrigin = process.env.WEBSOCKET_CORS_ORIGIN ?? '*';

@Injectable()
@WebSocketGateway({ cors: { origin: wsOrigin } })
export class WebsocketGateway {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WebsocketGateway.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

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

  async emitStockForEvent(eventId: string): Promise<void> {
    const categories = await this.prisma.ticketCategory.findMany({
      where: { eventId },
      select: { id: true, name: true, availableStock: true },
    });
    this.emitStockUpdate(eventId, categories);
  }
}
