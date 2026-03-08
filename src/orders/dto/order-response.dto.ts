import { OrderStatus } from '../../generated/prisma/client/client';

export class OrderResponseDto {
  id: string;
  userId: string;
  eventId: string;
  quantity: number;
  totalAmount: string;
  status: OrderStatus;
  stripePaymentIntentId: string | null;
  stripeClientSecret: string | null;
  createdAt: Date;
}
