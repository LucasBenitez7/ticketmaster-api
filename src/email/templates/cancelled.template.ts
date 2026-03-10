import { EmailPayload } from '../email.types';
import { baseLayout } from './base.layout';

export function cancelledTemplate(
  p: Extract<EmailPayload, { type: 'cancelled' }>,
): string {
  const date = new Date(p.eventDate).toLocaleDateString('es-ES', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return baseLayout(`
    <h2 style="margin:0 0 8px;font-size:22px;color:#111827">Evento cancelado 😔</h2>
    <p style="margin:0 0 24px;color:#6b7280">Hola ${p.userName}, lamentamos informarte que el siguiente evento ha sido cancelado.</p>
    <table width="100%" cellpadding="12" cellspacing="0" style="background:#fef2f2;border-radius:6px;margin-bottom:24px;border:1px solid #fecaca">
      <tr><td style="border-bottom:1px solid #fecaca">
        <p style="margin:0;font-size:12px;color:#9ca3af;text-transform:uppercase;font-weight:600">Evento</p>
        <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#111827">${p.eventTitle}</p>
      </td></tr>
      <tr><td>
        <p style="margin:0;font-size:12px;color:#9ca3af;text-transform:uppercase;font-weight:600">Fecha original</p>
        <p style="margin:4px 0 0;font-size:14px;color:#374151">${date}</p>
      </td></tr>
    </table>
    <p style="margin:0;color:#6b7280;font-size:14px">Tu orden ha sido cancelada automáticamente. El reembolso será procesado en los próximos días hábiles.</p>
  `);
}
