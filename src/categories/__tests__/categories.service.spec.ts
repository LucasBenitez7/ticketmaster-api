import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CategoriesService } from '../categories.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  EventStatus,
  OrderStatus,
  RefundPolicy,
} from '../../generated/prisma/client/client';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  event: { findUnique: jest.fn() },
  ticketCategory: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    delete: jest.fn(),
  },
  order: { count: jest.fn() },
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockEvent = {
  id: 'event-uuid-1',
  title: 'Rock Festival',
  status: EventStatus.PUBLISHED,
};

const mockCategory = {
  id: 'cat-uuid-1',
  eventId: 'event-uuid-1',
  name: 'VIP',
  description: 'Front row access',
  price: '150.00',
  totalStock: 100,
  availableStock: 100,
  maxTicketsPerUser: 4,
  refundPolicy: RefundPolicy.PARTIAL,
  refundPercentage: 80,
  refundDeadlineHours: 48,
};

const createDto = {
  name: 'VIP',
  description: 'Front row access',
  price: 150,
  totalStock: 100,
  maxTicketsPerUser: 4,
  refundPolicy: RefundPolicy.PARTIAL,
  refundPercentage: 80,
  refundDeadlineHours: 48,
};

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('CategoriesService', () => {
  let service: CategoriesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
    jest.clearAllMocks();
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should create category and set availableStock = totalStock', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(mockEvent);
      mockPrisma.ticketCategory.create.mockResolvedValue(mockCategory);

      const result = await service.create('event-uuid-1', createDto);

      expect(mockPrisma.ticketCategory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventId: 'event-uuid-1',
          name: 'VIP',
          totalStock: 100,
          availableStock: 100,
          price: '150',
        }),
      });
      expect(result.availableStock).toBe(mockCategory.availableStock);
    });

    it('should apply defaults when optional fields are omitted', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(mockEvent);
      mockPrisma.ticketCategory.create.mockResolvedValue(mockCategory);

      await service.create('event-uuid-1', {
        name: 'General',
        price: 50,
        totalStock: 200,
      });

      expect(mockPrisma.ticketCategory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          maxTicketsPerUser: 10,
          refundPolicy: RefundPolicy.REFUNDABLE,
          refundPercentage: 100,
          refundDeadlineHours: 48,
        }),
      });
    });

    it('should throw NotFoundException if event does not exist', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(null);

      await expect(service.create('nonexistent', createDto)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.ticketCategory.create).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if event is CANCELLED', async () => {
      mockPrisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        status: EventStatus.CANCELLED,
      });

      await expect(service.create('event-uuid-1', createDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.ticketCategory.create).not.toHaveBeenCalled();
    });

    it('should allow creating category for DRAFT and PUBLISHED events', async () => {
      for (const status of [EventStatus.DRAFT, EventStatus.PUBLISHED]) {
        mockPrisma.event.findUnique.mockResolvedValue({ ...mockEvent, status });
        mockPrisma.ticketCategory.create.mockResolvedValue(mockCategory);

        await expect(
          service.create('event-uuid-1', createDto),
        ).resolves.not.toThrow();
      }
    });
  });

  // ─── findByEvent ───────────────────────────────────────────────────────────

  describe('findByEvent', () => {
    it('should return categories ordered by price', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(mockEvent);
      mockPrisma.ticketCategory.findMany.mockResolvedValue([mockCategory]);

      const result = await service.findByEvent('event-uuid-1');

      expect(mockPrisma.ticketCategory.findMany).toHaveBeenCalledWith({
        where: { eventId: 'event-uuid-1' },
        orderBy: { price: 'asc' },
      });
      expect(result).toHaveLength(1);
    });

    it('should return empty array if event has no categories', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(mockEvent);
      mockPrisma.ticketCategory.findMany.mockResolvedValue([]);

      const result = await service.findByEvent('event-uuid-1');

      expect(result).toEqual([]);
    });

    it('should throw NotFoundException if event does not exist', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(null);

      await expect(service.findByEvent('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── remove ────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('should delete category and return success message', async () => {
      mockPrisma.ticketCategory.findFirst.mockResolvedValue(mockCategory);
      mockPrisma.order.count.mockResolvedValue(0);
      mockPrisma.ticketCategory.delete.mockResolvedValue(mockCategory);

      const result = await service.remove('event-uuid-1', 'cat-uuid-1');

      expect(mockPrisma.ticketCategory.delete).toHaveBeenCalledWith({
        where: { id: 'cat-uuid-1' },
      });
      expect(result).toEqual({ message: 'Category deleted successfully' });
    });

    it('should throw NotFoundException if category not found or does not belong to event', async () => {
      mockPrisma.ticketCategory.findFirst.mockResolvedValue(null);

      await expect(
        service.remove('event-uuid-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.ticketCategory.delete).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if category has active PENDING orders', async () => {
      mockPrisma.ticketCategory.findFirst.mockResolvedValue(mockCategory);
      mockPrisma.order.count.mockResolvedValue(2);

      await expect(
        service.remove('event-uuid-1', 'cat-uuid-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.ticketCategory.delete).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if category has active PAID orders', async () => {
      mockPrisma.ticketCategory.findFirst.mockResolvedValue(mockCategory);
      mockPrisma.order.count.mockResolvedValue(1);

      await expect(
        service.remove('event-uuid-1', 'cat-uuid-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should check orders with both PENDING and PAID statuses', async () => {
      mockPrisma.ticketCategory.findFirst.mockResolvedValue(mockCategory);
      mockPrisma.order.count.mockResolvedValue(0);
      mockPrisma.ticketCategory.delete.mockResolvedValue(mockCategory);

      await service.remove('event-uuid-1', 'cat-uuid-1');

      expect(mockPrisma.order.count).toHaveBeenCalledWith({
        where: {
          categoryId: 'cat-uuid-1',
          status: { in: [OrderStatus.PENDING, OrderStatus.PAID] },
        },
      });
    });
  });
});
