import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { UpdateEventStatusDto } from './dto/update-event-status.dto';
import { PaginateEventsDto } from './dto/paginate-events.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../generated/prisma/client/client';

@ApiTags('Events')
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a new event (ADMIN only)',
    description:
      'Creates a new event in DRAFT status. Optionally accepts a poster image (multipart/form-data).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Event created in DRAFT status.' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN role required' })
  @UseInterceptors(FileInterceptor('poster', { storage: memoryStorage() }))
  create(
    @Body() dto: CreateEventDto,
    @UploadedFile() poster?: Express.Multer.File,
  ) {
    return this.eventsService.create(dto, poster);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all published events with pagination',
    description:
      'Returns only PUBLISHED events. Results are cached in Redis for 60 seconds.',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of published events.',
    schema: {
      example: {
        data: [],
        meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
      },
    },
  })
  findAll(@Query() query: PaginateEventsDto) {
    return this.eventsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get event by ID' })
  @ApiParam({ name: 'id', description: 'Event UUID' })
  @ApiResponse({
    status: 200,
    description: 'Event details with ticket categories.',
  })
  @ApiResponse({ status: 404, description: 'Event not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventsService.findOne(id, true);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update an event (ADMIN only)',
    description:
      'Updates event fields. If a new poster is uploaded, the old one is deleted from storage.',
  })
  @ApiParam({ name: 'id', description: 'Event UUID' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 200, description: 'Event updated.' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN role required' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  @UseInterceptors(FileInterceptor('poster', { storage: memoryStorage() }))
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDto,
    @UploadedFile() poster?: Express.Multer.File,
  ) {
    return this.eventsService.update(id, dto, poster);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update event status (ADMIN only)',
    description:
      'Transitions the event status. When set to CANCELLED, all PAID orders are cancelled automatically.',
  })
  @ApiParam({ name: 'id', description: 'Event UUID' })
  @ApiResponse({ status: 200, description: 'Event status updated.' })
  @ApiResponse({
    status: 400,
    description: 'Event is already in the target status',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN role required' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventStatusDto,
  ) {
    return this.eventsService.updateStatus(id, dto.status);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete an event (ADMIN only)',
    description:
      'Deletes an event. Fails if the event has active PENDING or PAID orders.',
  })
  @ApiParam({ name: 'id', description: 'Event UUID' })
  @ApiResponse({ status: 200, description: 'Event deleted.' })
  @ApiResponse({
    status: 400,
    description: 'Cannot delete event with active orders',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN role required' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventsService.remove(id);
  }
}
