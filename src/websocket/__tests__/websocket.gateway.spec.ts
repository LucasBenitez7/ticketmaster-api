import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Server } from 'socket.io';
import { WebsocketGateway } from '../websocket.gateway';
import { PrismaService } from '../../../prisma/prisma.service';

// ─── Dependency mocks ─────────────────────────────────────────────────────────

const mockPrisma = {
  ticketCategory: {
    findMany: jest.fn(),
  },
};

const mockConfig = {
  get: jest.fn().mockReturnValue(undefined),
};

// ─── Socket.io server mock ────────────────────────────────────────────────────

const mockEmit = jest.fn();
const mockServer = { emit: mockEmit } as unknown as Server;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockCategories = [
  { id: 'cat-uuid-1', name: 'VIP', availableStock: 50 },
  { id: 'cat-uuid-2', name: 'General', availableStock: 200 },
];

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('WebsocketGateway', () => {
  let gateway: WebsocketGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebsocketGateway,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    gateway = module.get<WebsocketGateway>(WebsocketGateway);
    jest.clearAllMocks();
  });

  // ─── emitStockUpdate ───────────────────────────────────────────────────────

  describe('emitStockUpdate', () => {
    it('should emit "ticket:stock-updated" with eventId and categories when server is ready', () => {
      gateway.server = mockServer;

      gateway.emitStockUpdate('event-uuid-1', mockCategories);

      expect(mockEmit).toHaveBeenCalledWith('ticket:stock-updated', {
        eventId: 'event-uuid-1',
        categories: mockCategories,
      });
    });

    it('should not throw and should skip emit when server is not initialized', () => {
      gateway.server = undefined as unknown as Server;

      expect(() => {
        gateway.emitStockUpdate('event-uuid-1', mockCategories);
      }).not.toThrow();

      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('should emit with empty categories array', () => {
      gateway.server = mockServer;

      gateway.emitStockUpdate('event-uuid-1', []);

      expect(mockEmit).toHaveBeenCalledWith('ticket:stock-updated', {
        eventId: 'event-uuid-1',
        categories: [],
      });
    });
  });

  // ─── emitStockForEvent ─────────────────────────────────────────────────────

  describe('emitStockForEvent', () => {
    beforeEach(() => {
      gateway.server = mockServer;
    });

    it('should fetch categories from DB and emit stock update', async () => {
      mockPrisma.ticketCategory.findMany.mockResolvedValue(mockCategories);

      await gateway.emitStockForEvent('event-uuid-1');

      expect(mockPrisma.ticketCategory.findMany).toHaveBeenCalledWith({
        where: { eventId: 'event-uuid-1' },
        select: { id: true, name: true, availableStock: true },
      });
      expect(mockEmit).toHaveBeenCalledWith('ticket:stock-updated', {
        eventId: 'event-uuid-1',
        categories: mockCategories,
      });
    });

    it('should emit with empty array if event has no categories', async () => {
      mockPrisma.ticketCategory.findMany.mockResolvedValue([]);

      await gateway.emitStockForEvent('event-uuid-1');

      expect(mockEmit).toHaveBeenCalledWith('ticket:stock-updated', {
        eventId: 'event-uuid-1',
        categories: [],
      });
    });

    it('should propagate DB errors', async () => {
      mockPrisma.ticketCategory.findMany.mockRejectedValue(
        new Error('DB connection lost'),
      );

      await expect(gateway.emitStockForEvent('event-uuid-1')).rejects.toThrow(
        'DB connection lost',
      );
    });
  });
});
