import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Categories')
@Controller('events/:eventId/categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a ticket category for an event',
    description:
      'Adds a new ticket category (e.g. VIP, General) to an existing event. ADMIN only.',
  })
  @ApiParam({ name: 'eventId', description: 'Event UUID' })
  @ApiResponse({
    status: 201,
    description: 'Category created successfully.',
    schema: {
      example: {
        id: 'uuid',
        eventId: 'uuid',
        name: 'VIP',
        description: 'Acceso VIP con vista al escenario',
        price: '150.00',
        totalStock: 100,
        availableStock: 100,
        maxTicketsPerUser: 4,
        refundPolicy: 'PARTIAL',
        refundPercentage: 80,
        refundDeadlineHours: 48,
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN role required' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  create(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.categoriesService.create(eventId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all categories for an event',
    description:
      'Returns all ticket categories associated with the given event.',
  })
  @ApiParam({ name: 'eventId', description: 'Event UUID' })
  @ApiResponse({ status: 200, description: 'List of ticket categories.' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  findByEvent(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.categoriesService.findByEvent(eventId);
  }

  @Delete(':categoryId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete a category',
    description: 'Deletes a ticket category. ADMIN only.',
  })
  @ApiParam({ name: 'eventId', description: 'Event UUID' })
  @ApiParam({ name: 'categoryId', description: 'Category UUID' })
  @ApiResponse({ status: 200, description: 'Category deleted.' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN role required' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  remove(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ) {
    return this.categoriesService.remove(eventId, categoryId);
  }
}
