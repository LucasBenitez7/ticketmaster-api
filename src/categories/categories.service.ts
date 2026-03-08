import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import {
  EventStatus,
  OrderStatus,
  RefundPolicy,
} from '../generated/prisma/client/client';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(eventId: string, dto: CreateCategoryDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) throw new NotFoundException('Event not found');

    if (event.status === EventStatus.CANCELLED) {
      throw new BadRequestException(
        'Cannot add categories to a cancelled event',
      );
    }

    return this.prisma.ticketCategory.create({
      data: {
        eventId,
        name: dto.name,
        description: dto.description,
        price: dto.price.toString(),
        totalStock: dto.totalStock,
        availableStock: dto.totalStock,
        maxTicketsPerUser: dto.maxTicketsPerUser ?? 10,
        refundPolicy: dto.refundPolicy ?? RefundPolicy.REFUNDABLE,
        refundPercentage: dto.refundPercentage ?? 100,
        refundDeadlineHours: dto.refundDeadlineHours ?? 48,
      },
    });
  }

  async findByEvent(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException('Event not found');

    return this.prisma.ticketCategory.findMany({
      where: { eventId },
      orderBy: { price: 'asc' },
    });
  }

  async remove(eventId: string, categoryId: string) {
    const category = await this.prisma.ticketCategory.findFirst({
      where: { id: categoryId, eventId },
    });

    if (!category) throw new NotFoundException('Category not found');

    const hasOrders = await this.prisma.order.count({
      where: {
        categoryId,
        status: { in: [OrderStatus.PENDING, OrderStatus.PAID] },
      },
    });

    if (hasOrders > 0) {
      throw new BadRequestException(
        'Cannot delete category with active orders',
      );
    }

    await this.prisma.ticketCategory.delete({ where: { id: categoryId } });
    return { message: 'Category deleted successfully' };
  }
}
