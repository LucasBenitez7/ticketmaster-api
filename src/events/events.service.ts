import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { PaginateEventsDto } from './dto/paginate-events.dto';

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
        price: dto.price.toString(),
        totalTickets: dto.totalTickets,
        availableTickets: dto.totalTickets,
        posterUrl,
      },
    });
  }

  async findAll(query: PaginateEventsDto) {
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        skip,
        take: limit,
        orderBy: { date: 'asc' },
      }),
      this.prisma.event.count(),
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
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) throw new NotFoundException(`Event ${id} not found`);
    return event;
  }

  async update(id: string, dto: UpdateEventDto, poster?: Express.Multer.File) {
    const event = await this.findOne(id);

    let posterUrl: string | undefined = event.posterUrl ?? undefined;

    if (poster) {
      if (event.posterUrl) {
        await this.storage.deleteFile(event.posterUrl);
      }
      posterUrl = await this.storage.uploadFile(poster, 'posters');
    }

    return this.prisma.event.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.date !== undefined && { date: new Date(dto.date) }),
        ...(dto.location !== undefined && { location: dto.location }),
        ...(dto.price !== undefined && { price: dto.price.toString() }),
        ...(dto.totalTickets !== undefined && {
          totalTickets: dto.totalTickets,
        }),
        posterUrl,
      },
    });
  }

  async remove(id: string) {
    const event = await this.findOne(id);

    if (event.posterUrl) {
      await this.storage.deleteFile(event.posterUrl);
    }

    await this.prisma.event.delete({ where: { id } });
    return { message: 'Event deleted successfully' };
  }
}
