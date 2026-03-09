import { EmailPayload } from '../email.types';
import { baseLayout } from './base.layout';

export function refundTemplate(
  p: Extract<EmailPayload, { type: 'refund' }>,
): string {
  return baseLayout(`
    <h2 style="margin:0 0 8px;font-size:22px;color:#111827">Reembolso procesado ✅</h2>
    <p style="margin:0 0 24px;color:#6b7280">Hola ${p.userName}, hemos procesado tu reembolso exitosamente.</p>
    <table width="100%" cellpadding="12" cellspacing="0" style="background:#f9fafb;border-radius:6px;margin-bottom:24px">
      <tr><td style="border-bottom:1px solid #e5e7eb">
        <p style="margin:0;font-size:12px;color:#9ca3af;text-transform:uppercase;font-weight:600">Evento</p>
        <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#111827">${p.eventTitle}</p>
      </td></tr>
      <tr><td style="border-bottom:1px solid #e5e7eb">
        <p style="margin:0;font-size:12px;color:#9ca3af;text-transform:uppercase;font-weight:600">Monto reembolsado</p>
        <p style="margin:4px 0 0;font-size:20px;font-weight:700;color:#16a34a">$${p.refundAmount.toFixed(2)} (${p.refundPercentage}%)</p>
      </td></tr>
      <tr><td>
        <p style="margin:0;font-size:12px;color:#9ca3af;text-transform:uppercase;font-weight:600">ID de orden</p>
        <p style="margin:4px 0 0;font-size:14px;color:#374151"><code>${p.orderId}</code></p>
      </td></tr>
    </table>
    <p style="margin:0;color:#6b7280;font-size:14px">El monto será acreditado en tu método de pago original en 5-10 días hábiles.</p>
  `);
}
