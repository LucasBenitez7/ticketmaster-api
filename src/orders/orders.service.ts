import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { CheckoutDto } from './dto/checkout.dto';
import { AuthUser } from '../auth/strategies/jwt.strategy';
import {
  OrderStatus,
  EventStatus,
  RefundPolicy,
} from '../generated/prisma/client/client';
import { QueuesService } from '../queues/queues.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';

const ORDER_EXPIRY_MINUTES = 15;
const REMINDER_HOURS_BEFORE = 24;

@Injectable()
export class OrdersService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly queuesService: QueuesService,
    private readonly wsGateway: WebsocketGateway,
  ) {
    const stripeKey = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!stripeKey) throw new Error('STRIPE_SECRET_KEY is not defined');
    this.stripe = new Stripe(stripeKey);
  }

  async checkout(dto: CheckoutDto, user: AuthUser) {
    const { categoryId, quantity } = dto;

    const category = await this.prisma.ticketCategory.findUnique({
      where: { id: categoryId },
      include: { event: true },
    });

    if (!category) throw new NotFoundException('Ticket category not found');

    if (category.event.status !== EventStatus.PUBLISHED) {
      throw new BadRequestException('Event is not available for purchase');
    }

    const expiresAt = new Date(Date.now() + ORDER_EXPIRY_MINUTES * 60 * 1000);

    const order = await this.prisma.$transaction(async (tx) => {
      const freshCategory = await tx.ticketCategory.findUnique({
        where: { id: categoryId },
      });

      if (!freshCategory)
        throw new NotFoundException('Ticket category not found');

      const userTickets = await tx.order.aggregate({
        where: {
          userId: user.id,
          categoryId,
          status: { in: [OrderStatus.PENDING, OrderStatus.PAID] },
        },
        _sum: { quantity: true },
      });

      const alreadyOwned = userTickets._sum.quantity ?? 0;

      if (alreadyOwned + quantity > freshCategory.maxTicketsPerUser) {
        throw new BadRequestException(
          `Max tickets per user for this category is ${freshCategory.maxTicketsPerUser}. You already have ${alreadyOwned}.`,
        );
      }

      // Atomic decrement: solo actualiza si hay stock suficiente (evita sobreventa)
      const updated = await tx.$executeRaw`
        UPDATE ticket_categories
        SET "availableStock" = "availableStock" - ${quantity}
        WHERE id = ${categoryId} AND "availableStock" >= ${quantity}
      `;

      if (updated === 0) {
        const current = await tx.ticketCategory.findUnique({
          where: { id: categoryId },
          select: { availableStock: true },
        });
        throw new BadRequestException(
          `Not enough tickets. Requested: ${quantity}, Available: ${current?.availableStock ?? 0}`,
        );
      }

      const totalAmount = Number(freshCategory.price) * quantity;

      const newOrder = await tx.order.create({
        data: {
          userId: user.id,
          eventId: category.event.id,
          categoryId,
          quantity,
          totalAmount: totalAmount.toString(),
          status: OrderStatus.PENDING,
          expiresAt,
          tickets: {
            create: Array.from({ length: quantity }).map(() => ({
              eventId: category.event.id,
              categoryId,
            })),
          },
        },
        include: { tickets: true },
      });

      return newOrder;
    });

    let paymentIntent: Stripe.PaymentIntent;

    try {
      paymentIntent = await this.stripe.paymentIntents.create({
        amount: Math.round(Number(order.totalAmount) * 100),
        currency: 'usd',
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        metadata: {
          orderId: order.id,
          userId: user.id,
          categoryId,
          eventId: category.event.id,
        },
      });
    } catch (error) {
      this.logger.error(
        'Stripe PaymentIntent creation failed, reverting order',
        error,
      );

      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.ticket.deleteMany({ where: { orderId: order.id } });
          await tx.order.update({
            where: { id: order.id },
            data: { status: OrderStatus.FAILED },
          });
          await tx.ticketCategory.update({
            where: { id: categoryId },
            data: { availableStock: { increment: quantity } },
          });
        });
      } catch (rollbackError) {
        this.logger.error(
          `CRITICAL: Failed to revert order ${order.id} after Stripe failure.`,
          rollbackError,
        );
      }

      throw new BadRequestException(
        'Payment initialization failed, please try again',
      );
    }

    if (!paymentIntent.client_secret) {
      this.logger.error(
        `Stripe PaymentIntent ${paymentIntent.id} returned null client_secret`,
      );
      throw new BadRequestException(
        'Payment initialization incomplete, please try again',
      );
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { stripePaymentIntentId: paymentIntent.id },
    });

    // Job de expiración
    const ORDER_EXPIRY_MS = ORDER_EXPIRY_MINUTES * 60 * 1000;
    await this.queuesService.addOrderExpiryJob(order.id, ORDER_EXPIRY_MS);

    // Job de recordatorio 24h antes del evento
    const reminderDelay =
      new Date(category.event.date).getTime() -
      Date.now() -
      REMINDER_HOURS_BEFORE * 60 * 60 * 1000;

    if (reminderDelay > 0) {
      await this.queuesService.addEmailJob(
        {
          type: 'reminder',
          to: user.email,
          userName: user.name,
          eventTitle: category.event.title,
          eventDate: category.event.date,
          eventLocation: category.event.location,
        },
        reminderDelay,
      );
    }

    return {
      orderId: order.id,
      totalAmount: order.totalAmount,
      status: order.status,
      expiresAt: order.expiresAt,
      stripePaymentIntentId: paymentIntent.id,
      stripeClientSecret: paymentIntent.client_secret,
      tickets: order.tickets,
    };
  }

  async refund(orderId: string, user: AuthUser) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId: user.id },
      include: { category: true, event: true },
    });

    if (!order) throw new NotFoundException('Order not found');

    if (order.status !== OrderStatus.PAID) {
      throw new BadRequestException('Only paid orders can be refunded');
    }

    if (order.category.refundPolicy === RefundPolicy.NON_REFUNDABLE) {
      throw new ForbiddenException('This ticket category is non-refundable');
    }

    const eventDate = new Date(order.event.date);
    const deadlineMs = order.category.refundDeadlineHours * 60 * 60 * 1000;
    const refundDeadline = new Date(eventDate.getTime() - deadlineMs);

    if (new Date() > refundDeadline) {
      throw new BadRequestException(
        `Refund deadline has passed. Refunds are only allowed up to ${order.category.refundDeadlineHours}h before the event.`,
      );
    }

    if (!order.stripePaymentIntentId) {
      throw new BadRequestException('No payment found for this order');
    }

    const refundPercentage = order.category.refundPercentage;
    const refundAmount = (Number(order.totalAmount) * refundPercentage) / 100;
    const isPartial = refundPercentage < 100;

    try {
      await this.stripe.refunds.create({
        payment_intent: order.stripePaymentIntentId,
        amount: Math.round(refundAmount * 100),
      });
    } catch (error) {
      this.logger.error(`Stripe refund failed for order ${orderId}`, error);
      throw new BadRequestException(
        'Refund processing failed, please try again',
      );
    }

    let updatedOrder: Awaited<ReturnType<typeof this.prisma.order.update>>;

    try {
      updatedOrder = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.order.update({
          where: { id: orderId },
          data: {
            status: isPartial
              ? OrderStatus.PARTIALLY_REFUNDED
              : OrderStatus.REFUNDED,
            refundAmount: refundAmount.toString(),
          },
        });

        await tx.ticketCategory.update({
          where: { id: order.categoryId },
          data: { availableStock: { increment: order.quantity } },
        });

        return updated;
      });
    } catch (error) {
      this.logger.error(
        `CRITICAL: Stripe refund processed for order ${orderId} but DB update failed. Manual reconciliation required.`,
        error,
      );
      throw new BadRequestException(
        'Order status update failed after refund. Contact support.',
      );
    }

    await this.queuesService.addEmailJob({
      type: 'refund',
      to: user.email,
      userName: user.name,
      orderId,
      eventTitle: order.event.title,
      refundAmount,
      refundPercentage,
    });

    await this.wsGateway.emitStockForEvent(order.eventId);

    return {
      orderId: updatedOrder.id,
      refundAmount,
      refundPercentage,
      status: updatedOrder.status,
    };
  }

  async expireOrder(orderId: string): Promise<boolean> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: { select: { email: true, name: true } },
        event: { select: { title: true } },
      },
    });

    if (!order || order.status !== OrderStatus.PENDING) return false;

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.EXPIRED },
      });
      await tx.ticketCategory.update({
        where: { id: order.categoryId },
        data: { availableStock: { increment: order.quantity } },
      });
    });

    await this.queuesService.addEmailJob({
      type: 'expired',
      to: order.user.email,
      userName: order.user.name,
      orderId,
      eventTitle: order.event.title,
    });

    await this.wsGateway.emitStockForEvent(order.eventId);

    return true;
  }

  async findMyOrders(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            date: true,
            location: true,
            posterUrl: true,
            status: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
            price: true,
            refundPolicy: true,
            refundPercentage: true,
            refundDeadlineHours: true,
          },
        },
        tickets: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, userId },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            date: true,
            location: true,
            posterUrl: true,
            status: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
            price: true,
            refundPolicy: true,
            refundPercentage: true,
            refundDeadlineHours: true,
          },
        },
        tickets: true,
      },
    });

    if (!order) throw new NotFoundException('Order not found');
    return order;
  }
}
