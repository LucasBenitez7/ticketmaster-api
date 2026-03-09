import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { PaginateEventsDto } from './dto/paginate-events.dto';
import { EventStatus, OrderStatus } from '../generated/prisma/client/client';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

const CACHE_TTL = 60;
const CACHE_PREFIX = 'events:list';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private cacheKey(page: number, limit: number) {
    return `${CACHE_PREFIX}:${page}:${limit}`;
  }

  private async invalidateCache() {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, batch] = await this.redis.scan(
        cursor,
        'MATCH',
        `${CACHE_PREFIX}:*`,
        'COUNT',
        100,
      );
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    if (keys.length > 0) {
      await this.redis.del(...keys);
      this.logger.log(`🗑️  Cache invalidated: ${keys.length} key(s)`);
    }
  }

  async create(dto: CreateEventDto, poster?: Express.Multer.File) {
    let posterUrl: string | undefined;
    if (poster) {
      posterUrl = await this.storage.uploadFile(poster, 'posters');
    }

    const event = await this.prisma.event.create({
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

    await this.invalidateCache();
    return event;
  }

  async findAll(query: PaginateEventsDto) {
    const { page, limit } = query;
    const key = this.cacheKey(page, limit);

    // Cache hit
    const cached = await this.redis.get(key);
    if (cached) {
      this.logger.log(`⚡ Cache hit: ${key}`);
      return JSON.parse(cached) as unknown;
    }

    // Cache miss
    const skip = (page - 1) * limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        skip,
        take: limit,
        where: { status: EventStatus.PUBLISHED },
        orderBy: { date: 'asc' },
        include: { ticketCategories: true },
      }),
      this.prisma.event.count({ where: { status: EventStatus.PUBLISHED } }),
    ]);

    const result = {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };

    await this.redis.set(key, JSON.stringify(result), 'EX', CACHE_TTL);
    this.logger.log(`💾 Cache set: ${key} (TTL: ${CACHE_TTL}s)`);

    return result;
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
      const newPosterUrl = await this.storage.uploadFile(poster, 'posters');
      if (event.posterUrl) await this.storage.deleteFile(event.posterUrl);
      posterUrl = newPosterUrl;
    }

    const updated = await this.prisma.event.update({
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

    await this.invalidateCache();
    return updated;
  }

  async updateStatus(id: string, status: EventStatus) {
    const event = await this.findOne(id);

    let result: Awaited<ReturnType<typeof this.prisma.event.update>>;

    if (status === EventStatus.CANCELLED) {
      if (event.status === EventStatus.CANCELLED) {
        throw new BadRequestException('Event is already cancelled');
      }

      result = await this.prisma.$transaction(async (tx) => {
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
    } else {
      result = await this.prisma.event.update({
        where: { id },
        data: { status },
        include: { ticketCategories: true },
      });
    }

    await this.invalidateCache();
    return result;
  }

  async remove(id: string) {
    const event = await this.findOne(id);

    const activeOrders = await this.prisma.order.count({
      where: {
        eventId: id,
        status: { in: [OrderStatus.PENDING, OrderStatus.PAID] },
      },
    });

    if (activeOrders > 0) {
      throw new BadRequestException('Cannot delete event with active orders');
    }

    if (event.posterUrl) await this.storage.deleteFile(event.posterUrl);

    await this.prisma.event.delete({ where: { id } });
    await this.invalidateCache();
    return { message: 'Event deleted successfully' };
  }
}
