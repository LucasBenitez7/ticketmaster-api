import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email.service';

// ─── Resend mock ──────────────────────────────────────────────────────────────

const mockResendEmailsSend = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockResendEmailsSend },
  })),
}));

// ─── Template mocks ───────────────────────────────────────────────────────────

jest.mock('../templates/purchase.template', () => ({
  purchaseTemplate: jest.fn().mockReturnValue('<html>purchase</html>'),
}));
jest.mock('../templates/refund.template', () => ({
  refundTemplate: jest.fn().mockReturnValue('<html>refund</html>'),
}));
jest.mock('../templates/expired.template', () => ({
  expiredTemplate: jest.fn().mockReturnValue('<html>expired</html>'),
}));
jest.mock('../templates/reminder.template', () => ({
  reminderTemplate: jest.fn().mockReturnValue('<html>reminder</html>'),
}));
jest.mock('../templates/cancelled.template', () => ({
  cancelledTemplate: jest.fn().mockReturnValue('<html>cancelled</html>'),
}));

// ─── Dependency mocks ─────────────────────────────────────────────────────────

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'RESEND_API_KEY') return 're_test_mock';
    if (key === 'RESEND_FROM') return 'Test <test@example.com>';
    return undefined;
  }),
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

const basePurchasePayload = {
  type: 'purchase' as const,
  to: 'john@example.com',
  userName: 'John',
  orderId: 'order-uuid-1',
  eventTitle: 'Rock Festival',
  eventDate: futureDate,
  eventLocation: 'MSG',
  quantity: 2,
  totalAmount: 300,
  categoryName: 'VIP',
};

const baseRefundPayload = {
  type: 'refund' as const,
  to: 'john@example.com',
  userName: 'John',
  orderId: 'order-uuid-1',
  eventTitle: 'Rock Festival',
  refundAmount: 240,
  refundPercentage: 80,
};

const baseExpiredPayload = {
  type: 'expired' as const,
  to: 'john@example.com',
  userName: 'John',
  orderId: 'order-uuid-1',
  eventTitle: 'Rock Festival',
};

const baseReminderPayload = {
  type: 'reminder' as const,
  to: 'john@example.com',
  userName: 'John',
  eventTitle: 'Rock Festival',
  eventDate: futureDate,
  eventLocation: 'MSG',
};

const baseCancelledPayload = {
  type: 'cancelled' as const,
  to: 'john@example.com',
  userName: 'John',
  eventTitle: 'Rock Festival',
};

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('EmailService', () => {
  let service: EmailService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
    jest.clearAllMocks();
  });

  // ─── send ──────────────────────────────────────────────────────────────────

  describe('send', () => {
    it('should call resend.emails.send with correct params for purchase email', async () => {
      mockResendEmailsSend.mockResolvedValue({ error: null });

      await service.send(basePurchasePayload);

      expect(mockResendEmailsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'Test <test@example.com>',
          to: basePurchasePayload.to,
          subject: expect.stringContaining(basePurchasePayload.eventTitle),
          html: expect.any(String),
        }),
      );
    });

    it('should use default from address when RESEND_FROM is not configured', async () => {
      const configWithoutFrom = {
        get: jest.fn((key: string) => {
          if (key === 'RESEND_API_KEY') return 're_test_mock';
          return undefined;
        }),
      };

      const moduleNoFrom = await Test.createTestingModule({
        providers: [
          EmailService,
          { provide: ConfigService, useValue: configWithoutFrom },
        ],
      }).compile();

      const serviceNoFrom = moduleNoFrom.get<EmailService>(EmailService);
      mockResendEmailsSend.mockResolvedValue({ error: null });

      await serviceNoFrom.send(basePurchasePayload);

      expect(mockResendEmailsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'TicketMaster <noreply@lsbstack.com>',
        }),
      );
    });

    it('should throw and log error if resend returns an error object', async () => {
      mockResendEmailsSend.mockResolvedValue({
        error: { message: 'Invalid API key' },
      });

      await expect(service.send(basePurchasePayload)).rejects.toThrow(
        'Invalid API key',
      );
    });

    it('should throw and rethrow if resend.emails.send rejects', async () => {
      mockResendEmailsSend.mockRejectedValue(new Error('Network failure'));

      await expect(service.send(basePurchasePayload)).rejects.toThrow(
        'Network failure',
      );
    });
  });

  // ─── buildEmail (via send) ─────────────────────────────────────────────────

  describe('buildEmail — subject and template selection', () => {
    beforeEach(() => {
      mockResendEmailsSend.mockResolvedValue({ error: null });
    });

    it('should use purchaseTemplate and correct subject for type "purchase"', async () => {
      await service.send(basePurchasePayload);

      expect(mockResendEmailsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: `Confirmación de compra — ${basePurchasePayload.eventTitle}`,
          html: '<html>purchase</html>',
        }),
      );
    });

    it('should use refundTemplate and correct subject for type "refund"', async () => {
      await service.send(baseRefundPayload);

      expect(mockResendEmailsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: `Confirmación de reembolso — ${baseRefundPayload.eventTitle}`,
          html: '<html>refund</html>',
        }),
      );
    });

    it('should use expiredTemplate and correct subject for type "expired"', async () => {
      await service.send(baseExpiredPayload);

      expect(mockResendEmailsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: `Tu reserva ha expirado — ${baseExpiredPayload.eventTitle}`,
          html: '<html>expired</html>',
        }),
      );
    });

    it('should use reminderTemplate and correct subject for type "reminder"', async () => {
      await service.send(baseReminderPayload);

      expect(mockResendEmailsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: `¡Tu evento es mañana! — ${baseReminderPayload.eventTitle}`,
          html: '<html>reminder</html>',
        }),
      );
    });

    it('should use cancelledTemplate and correct subject for type "cancelled"', async () => {
      await service.send({ ...baseCancelledPayload, eventDate: new Date() });

      expect(mockResendEmailsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: `Evento cancelado — ${baseCancelledPayload.eventTitle}`,
          html: '<html>cancelled</html>',
        }),
      );
    });
  });
});
