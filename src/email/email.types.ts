export type EmailPayload =
  | {
      type: 'purchase';
      to: string;
      userName: string;
      orderId: string;
      eventTitle: string;
      eventDate: Date;
      eventLocation: string;
      quantity: number;
      totalAmount: number;
      categoryName: string;
    }
  | {
      type: 'refund';
      to: string;
      userName: string;
      orderId: string;
      eventTitle: string;
      refundAmount: number;
      refundPercentage: number;
    }
  | {
      type: 'expired';
      to: string;
      userName: string;
      orderId: string;
      eventTitle: string;
    }
  | {
      type: 'reminder';
      to: string;
      userName: string;
      eventTitle: string;
      eventDate: Date;
      eventLocation: string;
    }
  | {
      type: 'cancelled';
      to: string;
      userName: string;
      eventTitle: string;
      eventDate: Date;
    };
