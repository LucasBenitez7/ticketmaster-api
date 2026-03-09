import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
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

  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('checkout')
  @ApiOperation({ summary: 'Checkout and create an order' })
  checkout(@Body() dto: CheckoutDto, @CurrentUser() user: AuthUser) {
    return this.ordersService.checkout(dto, user);
  }

  @Post(':id/refund')
  @ApiOperation({ summary: 'Refund an order based on category refund policy' })
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ordersService.refund(id, user);
  }

  @Get('my-orders')
  @ApiOperation({ summary: 'Get my orders' })
  findMyOrders(@CurrentUser() user: AuthUser) {
    return this.ordersService.findMyOrders(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order by ID' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ordersService.findOne(id, user.id);
  }
}
