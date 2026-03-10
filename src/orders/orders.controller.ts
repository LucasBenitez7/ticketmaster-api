import {
  Controller,
  Post,
  Get,
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
import { OrdersService } from './orders.service';
import { CheckoutDto } from './dto/checkout.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthUser } from '../auth/strategies/jwt.strategy';
import { Throttle } from '@nestjs/throttler';

@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Throttle({
    global: {
      ttl: 60000,
      limit: parseInt(process.env.THROTTLE_CHECKOUT_LIMIT || '10', 10),
    },
  })
  @Post('checkout')
  @ApiOperation({
    summary: 'Checkout and create an order',
    description:
      'Creates a PENDING order and a Stripe PaymentIntent. The order expires in 15 minutes if payment is not completed.',
  })
  @ApiResponse({
    status: 201,
    description:
      'Order created successfully. Use stripeClientSecret to confirm payment on the client.',
    schema: {
      example: {
        orderId: 'uuid',
        totalAmount: '300.00',
        status: 'PENDING',
        expiresAt: '2026-01-01T00:15:00.000Z',
        stripePaymentIntentId: 'pi_xxx',
        stripeClientSecret: 'pi_xxx_secret_xxx',
        tickets: [
          { id: 'uuid', orderId: 'uuid', eventId: 'uuid', categoryId: 'uuid' },
        ],
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Not enough stock or max tickets per user exceeded',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid JWT',
  })
  checkout(@Body() dto: CheckoutDto, @CurrentUser() user: AuthUser) {
    return this.ordersService.checkout(dto, user);
  }

  @Post(':id/refund')
  @ApiOperation({
    summary: 'Refund an order',
    description:
      'Processes a refund based on the category refund policy (REFUNDABLE, PARTIAL, NON_REFUNDABLE). Only PAID orders within the refund deadline can be refunded.',
  })
  @ApiParam({ name: 'id', description: 'Order UUID' })
  @ApiResponse({
    status: 201,
    description: 'Refund processed successfully.',
    schema: {
      example: {
        orderId: 'uuid',
        refundAmount: 240,
        refundPercentage: 80,
        status: 'PARTIALLY_REFUNDED',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Order is not PAID, refund deadline passed, or no payment found',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Ticket category is non-refundable',
  })
  @ApiResponse({ status: 404, description: 'Order not found' })
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ordersService.refund(id, user);
  }

  @Get('my-orders')
  @ApiOperation({
    summary: 'Get my orders',
    description:
      'Returns all orders for the authenticated user, ordered by creation date descending.',
  })
  @ApiResponse({ status: 200, description: 'List of orders.' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findMyOrders(@CurrentUser() user: AuthUser) {
    return this.ordersService.findMyOrders(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order by ID' })
  @ApiParam({ name: 'id', description: 'Order UUID' })
  @ApiResponse({ status: 200, description: 'Order details.' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ordersService.findOne(id, user.id);
  }
}
