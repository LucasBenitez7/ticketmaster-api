import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { PaginateEventsDto } from './dto/paginate-events.dto';
import { EventStatus, OrderStatus } from '../generated/prisma/client/client';

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async create(dto: CreateEventDto, poster?: Express.Multer.File) {
    let posterUrl: string | undefined;

    if (poster) {
      posterUrl = await this.storage.uploadFile(poster, 'posters');
    }

    return this.prisma.event.create({
      data: {
        title: dto.title,
        description: dto.description,
        date: new Date(dto.date),
        location: dto.location,
        posterUrl,
        status: EventStatus.DRAFT,
      },
      include: { ticketCategories: true },
    });
  }

  async findAll(query: PaginateEventsDto) {
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        skip,
        take: limit,
        where: { status: EventStatus.PUBLISHED },
        orderBy: { date: 'asc' },
        include: { ticketCategories: true },
      }),
      this.prisma.event.count({
        where: { status: EventStatus.PUBLISHED },
      }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: { ticketCategories: true },
    });
    if (!event) throw new NotFoundException(`Event ${id} not found`);
    return event;
  }

  async update(id: string, dto: UpdateEventDto, poster?: Express.Multer.File) {
    const event = await this.findOne(id);

    let posterUrl: string | undefined = event.posterUrl ?? undefined;

    if (poster) {
      // Primero subir la nueva imagen, luego borrar la vieja
      const newPosterUrl = await this.storage.uploadFile(poster, 'posters');
      if (event.posterUrl) {
        await this.storage.deleteFile(event.posterUrl);
      }
      posterUrl = newPosterUrl;
    }

    return this.prisma.event.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.date !== undefined && { date: new Date(dto.date) }),
        ...(dto.location !== undefined && { location: dto.location }),
        posterUrl,
      },
      include: { ticketCategories: true },
    });
  }

  async updateStatus(id: string, status: EventStatus) {
    const event = await this.findOne(id);

    if (status === EventStatus.CANCELLED) {
      if (event.status === EventStatus.CANCELLED) {
        throw new BadRequestException('Event is already cancelled');
      }

      return this.prisma.$transaction(async (tx) => {
        await tx.order.updateMany({
          where: { eventId: id, status: OrderStatus.PAID },
          data: { status: OrderStatus.CANCELLED },
        });

        return tx.event.update({
          where: { id },
          data: { status },
          include: { ticketCategories: true },
        });
      });
    }

    return this.prisma.event.update({
      where: { id },
      data: { status },
      include: { ticketCategories: true },
    });
  }

  async remove(id: string) {
    const event = await this.findOne(id);

    // Verificar que no hay órdenes activas antes de eliminar
    const activeOrders = await this.prisma.order.count({
      where: {
        eventId: id,
        status: { in: [OrderStatus.PENDING, OrderStatus.PAID] },
      },
    });

    if (activeOrders > 0) {
      throw new BadRequestException('Cannot delete event with active orders');
    }

    if (event.posterUrl) {
      await this.storage.deleteFile(event.posterUrl);
    }

    await this.prisma.event.delete({ where: { id } });
    return { message: 'Event deleted successfully' };
  }
}
