import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { QueuesService } from '../queues/queues.service';
import { OrderStatus } from '../generated/prisma/client/client';
import { WebsocketGateway } from '../websocket/websocket.gateway';

@Injectable()
export class WebhooksService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly queuesService: QueuesService,
    private readonly wsGateway: WebsocketGateway,
  ) {
    this.stripe = new Stripe(
      this.config.get<string>('STRIPE_SECRET_KEY') ?? '',
    );
  }

  async handleStripeWebhook(rawBody: Buffer, signature: string) {
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret)
      throw new BadRequestException('Stripe webhook secret not configured');

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret,
      );
    } catch (err) {
      this.logger.error('Stripe webhook signature verification failed', err);
      throw new BadRequestException('Invalid Stripe webhook signature');
    }

    this.logger.log(`Stripe event received: ${event.type}`);

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentSucceeded(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await this.handlePaymentFailed(event.data.object);
        break;
      default:
        this.logger.log(`Unhandled Stripe event type: ${event.type}`);
    }

    return { received: true };
  }

  private async emitStockForEvent(eventId: string) {
    const categories = await this.prisma.ticketCategory.findMany({
      where: { eventId },
      select: { id: true, name: true, availableStock: true },
    });
    this.wsGateway.emitStockUpdate(eventId, categories);
  }

  private async handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent) {
    const order = await this.prisma.order.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
      include: {
        user: { select: { email: true, name: true } },
        event: { select: { title: true, date: true, location: true } },
        category: { select: { name: true } },
        tickets: true,
      },
    });

    if (!order) {
      this.logger.warn(
        `Order not found for paymentIntent: ${paymentIntent.id}`,
      );
      return;
    }

    if (order.status === OrderStatus.PAID) {
      this.logger.warn(`Order ${order.id} already PAID, skipping`);
      return;
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.PAID },
    });

    this.logger.log(
      `✅ Order ${order.id} marked as PAID (paymentIntent: ${paymentIntent.id})`,
    );

    await this.queuesService.addEmailJob({
      type: 'purchase',
      to: order.user.email,
      userName: order.user.name,
      orderId: order.id,
      eventTitle: order.event.title,
      eventDate: order.event.date,
      eventLocation: order.event.location,
      quantity: order.quantity,
      totalAmount: Number(order.totalAmount),
      categoryName: order.category.name,
    });

    // Emitir stock actualizado
    await this.emitStockForEvent(order.eventId);
  }

  private async handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
    const order = await this.prisma.order.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (!order) {
      this.logger.warn(
        `Order not found for paymentIntent: ${paymentIntent.id}`,
      );
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.FAILED },
      });
      await tx.ticketCategory.update({
        where: { id: order.categoryId },
        data: { availableStock: { increment: order.quantity } },
      });
    });

    this.logger.log(`❌ Order ${order.id} marked as FAILED, stock restored`);

    // Emitir stock actualizado
    await this.emitStockForEvent(order.eventId);
  }
}
