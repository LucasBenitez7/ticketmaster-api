import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { EventsService } from '../events.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { QueuesService } from '../../queues/queues.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { EventStatus, OrderStatus } from '../../generated/prisma/client/client';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  event: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    delete: jest.fn(),
  },
  order: {
    findMany: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockStorage = {
  uploadFile: jest.fn(),
  deleteFile: jest.fn(),
};

const mockQueuesService = { addEmailJob: jest.fn() };

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  scan: jest.fn(),
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockEvent = {
  id: 'event-uuid-1',
  title: 'Rock Festival',
  description: 'Best festival of the year',
  date: new Date('2026-08-15T20:00:00Z'),
  location: 'MSG, New York',
  posterUrl: null,
  status: EventStatus.DRAFT,
  ticketCategories: [],
  createdAt: new Date(),
};

const publishedEvent = { ...mockEvent, status: EventStatus.PUBLISHED };

// Helper para mockear invalidateCache (scan → vacío, no llama del)
const mockEmptyCache = () => {
  mockRedis.scan.mockResolvedValue(['0', []]);
};

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('EventsService', () => {
  let service: EventsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StorageService, useValue: mockStorage },
        { provide: QueuesService, useValue: mockQueuesService },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
    jest.clearAllMocks();
  });

  // ─── findAll ───────────────────────────────────────────────────────────────

  describe('findAll', () => {
    const query = { page: 1, limit: 10 };

    it('should return cached result on cache hit', async () => {
      const cached = {
        data: [publishedEvent],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      };
      // Simula lo que Redis devuelve: JSON serializado (Dates como strings)
      mockRedis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.findAll(query);

      expect(mockRedis.get).toHaveBeenCalledWith('events:list:1:10');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      // JSON.parse convierte Dates a strings, por eso comparamos con JSON round-trip
      expect(result).toEqual(JSON.parse(JSON.stringify(cached)));
    });

    it('should query DB on cache miss and store result in cache', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.$transaction.mockResolvedValue([[publishedEvent], 1]);

      const result = await service.findAll(query);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'events:list:1:10',
        expect.any(String),
        'EX',
        60,
      );
      expect((result as { data: (typeof publishedEvent)[] }).data).toHaveLength(
        1,
      );
    });

    it('should calculate totalPages correctly', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.$transaction.mockResolvedValue([[], 25]);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect((result as { meta: { totalPages: number } }).meta.totalPages).toBe(
        3,
      );
    });
  });

  // ─── findOne ───────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return event by id', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(publishedEvent);

      const result = await service.findOne('event-uuid-1');

      expect(result).toEqual(publishedEvent);
    });

    it('should throw NotFoundException if event does not exist', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException for DRAFT events when publicOnly=true', async () => {
      mockPrisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        status: EventStatus.DRAFT,
      });

      await expect(service.findOne('event-uuid-1', true)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return DRAFT events when publicOnly=false (admin access)', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(mockEvent);

      const result = await service.findOne('event-uuid-1', false);

      expect(result.status).toBe(EventStatus.DRAFT);
    });
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto = {
      title: 'Rock Festival',
      description: 'Best festival of the year',
      date: '2026-08-15T20:00:00Z',
      location: 'MSG, New York',
    };

    it('should create event in DRAFT status', async () => {
      mockPrisma.event.create.mockResolvedValue(mockEvent);
      mockEmptyCache();

      const result = await service.create(dto);

      expect(mockPrisma.event.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: EventStatus.DRAFT }),
        }),
      );
      expect(result.status).toBe(EventStatus.DRAFT);
    });

    it('should upload poster if provided', async () => {
      const mockFile = {
        buffer: Buffer.from(''),
        mimetype: 'image/jpeg',
      } as Express.Multer.File;
      mockStorage.uploadFile.mockResolvedValue(
        'https://cdn.example.com/poster.jpg',
      );
      mockPrisma.event.create.mockResolvedValue({
        ...mockEvent,
        posterUrl: 'https://cdn.example.com/poster.jpg',
      });
      mockEmptyCache();

      await service.create(dto, mockFile);

      expect(mockStorage.uploadFile).toHaveBeenCalledWith(mockFile, 'posters');
    });

    it('should not call storage if no poster is provided', async () => {
      mockPrisma.event.create.mockResolvedValue(mockEvent);
      mockEmptyCache();

      await service.create(dto);

      expect(mockStorage.uploadFile).not.toHaveBeenCalled();
    });

    it('should invalidate cache after creation', async () => {
      mockPrisma.event.create.mockResolvedValue(mockEvent);
      mockRedis.scan.mockResolvedValue(['0', ['events:list:1:10']]);
      mockRedis.del.mockResolvedValue(1);

      await service.create(dto);

      expect(mockRedis.del).toHaveBeenCalledWith('events:list:1:10');
    });
  });

  // ─── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('should update event fields', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(publishedEvent);
      mockPrisma.event.update.mockResolvedValue({
        ...publishedEvent,
        title: 'Updated Title',
      });
      mockEmptyCache();

      const result = await service.update('event-uuid-1', {
        title: 'Updated Title',
      });

      expect(mockPrisma.event.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'event-uuid-1' },
          data: expect.objectContaining({ title: 'Updated Title' }),
        }),
      );
      expect(result.title).toBe('Updated Title');
    });

    it('should replace poster and delete the old one', async () => {
      const eventWithPoster = {
        ...publishedEvent,
        posterUrl: 'https://cdn.example.com/old.jpg',
      };
      mockPrisma.event.findUnique.mockResolvedValue(eventWithPoster);
      mockStorage.uploadFile.mockResolvedValue(
        'https://cdn.example.com/new.jpg',
      );
      mockPrisma.event.update.mockResolvedValue({
        ...eventWithPoster,
        posterUrl: 'https://cdn.example.com/new.jpg',
      });
      mockEmptyCache();

      const mockFile = { buffer: Buffer.from('') } as Express.Multer.File;
      await service.update('event-uuid-1', {}, mockFile);

      expect(mockStorage.deleteFile).toHaveBeenCalledWith(
        'https://cdn.example.com/old.jpg',
      );
      expect(mockStorage.uploadFile).toHaveBeenCalledWith(mockFile, 'posters');
    });

    it('should throw NotFoundException if event does not exist', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(null);

      await expect(
        service.update('nonexistent', { title: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── updateStatus ──────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    it('should update status to PUBLISHED', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(mockEvent);
      mockPrisma.event.update.mockResolvedValue({
        ...mockEvent,
        status: EventStatus.PUBLISHED,
      });
      mockEmptyCache();

      const result = await service.updateStatus(
        'event-uuid-1',
        EventStatus.PUBLISHED,
      );

      expect(result.status).toBe(EventStatus.PUBLISHED);
    });

    it('should cancel PAID orders and send emails when status=CANCELLED', async () => {
      const paidOrder = {
        id: 'order-uuid-1',
        user: { email: 'john@example.com', name: 'John' },
      };
      mockPrisma.event.findUnique.mockResolvedValue(publishedEvent);
      mockPrisma.order.findMany.mockResolvedValue([paidOrder]);
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<unknown>) =>
          fn(mockPrisma),
      );
      mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.event.update.mockResolvedValue({
        ...publishedEvent,
        status: EventStatus.CANCELLED,
      });
      mockEmptyCache();

      await service.updateStatus('event-uuid-1', EventStatus.CANCELLED);

      expect(mockPrisma.order.updateMany).toHaveBeenCalledWith({
        where: { eventId: 'event-uuid-1', status: OrderStatus.PAID },
        data: { status: OrderStatus.CANCELLED },
      });
      expect(mockQueuesService.addEmailJob).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'cancelled',
          to: paidOrder.user.email,
        }),
      );
    });

    it('should throw BadRequestException if event is already CANCELLED', async () => {
      mockPrisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        status: EventStatus.CANCELLED,
      });

      await expect(
        service.updateStatus('event-uuid-1', EventStatus.CANCELLED),
      ).rejects.toThrow(BadRequestException);
    });

    it('should send one email per affected PAID order when cancelled', async () => {
      const affectedOrders = [
        { id: 'order-1', user: { email: 'a@example.com', name: 'Alice' } },
        { id: 'order-2', user: { email: 'b@example.com', name: 'Bob' } },
      ];
      mockPrisma.event.findUnique.mockResolvedValue(publishedEvent);
      mockPrisma.order.findMany.mockResolvedValue(affectedOrders);
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<unknown>) =>
          fn(mockPrisma),
      );
      mockPrisma.order.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.event.update.mockResolvedValue({
        ...publishedEvent,
        status: EventStatus.CANCELLED,
      });
      mockEmptyCache();

      await service.updateStatus('event-uuid-1', EventStatus.CANCELLED);

      expect(mockQueuesService.addEmailJob).toHaveBeenCalledTimes(2);
    });
  });

  // ─── remove ────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('should delete the event and return success message', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(mockEvent);
      mockPrisma.order.count.mockResolvedValue(0);
      mockPrisma.event.delete.mockResolvedValue(mockEvent);
      mockEmptyCache();

      const result = await service.remove('event-uuid-1');

      expect(mockPrisma.event.delete).toHaveBeenCalledWith({
        where: { id: 'event-uuid-1' },
      });
      expect(result).toHaveProperty('message');
    });

    it('should throw BadRequestException if event has active PENDING or PAID orders', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(publishedEvent);
      mockPrisma.order.count.mockResolvedValue(3);

      await expect(service.remove('event-uuid-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.event.delete).not.toHaveBeenCalled();
    });

    it('should delete poster from storage if exists', async () => {
      const eventWithPoster = {
        ...mockEvent,
        posterUrl: 'https://cdn.example.com/poster.jpg',
      };
      mockPrisma.event.findUnique.mockResolvedValue(eventWithPoster);
      mockPrisma.order.count.mockResolvedValue(0);
      mockPrisma.event.delete.mockResolvedValue(eventWithPoster);
      mockEmptyCache();

      await service.remove('event-uuid-1');

      expect(mockStorage.deleteFile).toHaveBeenCalledWith(
        'https://cdn.example.com/poster.jpg',
      );
    });

    it('should throw NotFoundException if event does not exist', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(null);

      await expect(service.remove('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
