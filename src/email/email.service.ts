import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { EmailPayload } from './email.types';
import { purchaseTemplate } from './templates/purchase.template';
import { refundTemplate } from './templates/refund.template';
import { expiredTemplate } from './templates/expired.template';
import { reminderTemplate } from './templates/reminder.template';
import { cancelledTemplate } from './templates/cancelled.template';

@Injectable()
export class EmailService {
  private readonly resend: Resend;
  private readonly from: string;
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {
    this.resend = new Resend(this.config.get<string>('RESEND_API_KEY'));
    this.from =
      this.config.get<string>('RESEND_FROM') ??
      'TicketMaster <noreply@lsbstack.com>';
  }

  async send(payload: EmailPayload): Promise<void> {
    const { subject, html } = this.buildEmail(payload);

    try {
      const { error } = await this.resend.emails.send({
        from: this.from,
        to: payload.to,
        subject,
        html,
      });

      if (error) {
        this.logger.error(
          `Resend error sending ${payload.type} email to ${payload.to}`,
          error,
        );
        throw new Error(error.message);
      }

      this.logger.log(`📧 Email sent [${payload.type}] → ${payload.to}`);
    } catch (err) {
      this.logger.error(
        `Failed to send ${payload.type} email to ${payload.to}`,
        err,
      );
      throw err;
    }
  }

  private buildEmail(payload: EmailPayload): { subject: string; html: string } {
    switch (payload.type) {
      case 'purchase':
        return {
          subject: `Confirmación de compra — ${payload.eventTitle}`,
          html: purchaseTemplate(payload),
        };
      case 'refund':
        return {
          subject: `Confirmación de reembolso — ${payload.eventTitle}`,
          html: refundTemplate(payload),
        };
      case 'expired':
        return {
          subject: `Tu reserva ha expirado — ${payload.eventTitle}`,
          html: expiredTemplate(payload),
        };
      case 'reminder':
        return {
          subject: `¡Tu evento es mañana! — ${payload.eventTitle}`,
          html: reminderTemplate(payload),
        };
      case 'cancelled':
        return {
          subject: `Evento cancelado — ${payload.eventTitle}`,
          html: cancelledTemplate(payload),
        };
    }
  }
}
