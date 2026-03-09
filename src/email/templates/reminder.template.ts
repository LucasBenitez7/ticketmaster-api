import { EmailPayload } from '../email.types';
import { baseLayout } from './base.layout';

export function reminderTemplate(
  p: Extract<EmailPayload, { type: 'reminder' }>,
): string {
  const date = new Date(p.eventDate).toLocaleDateString('es-ES', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return baseLayout(`
    <h2 style="margin:0 0 8px;font-size:22px;color:#111827">¡Tu evento es mañana! 🎶</h2>
    <p style="margin:0 0 24px;color:#6b7280">Hola ${p.userName}, te recordamos que mañana tienes un evento.</p>
    <table width="100%" cellpadding="12" cellspacing="0" style="background:#f0fdf4;border-radius:6px;margin-bottom:24px;border:1px solid #bbf7d0">
      <tr><td style="border-bottom:1px solid #bbf7d0">
        <p style="margin:0;font-size:12px;color:#9ca3af;text-transform:uppercase;font-weight:600">Evento</p>
        <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#111827">${p.eventTitle}</p>
      </td></tr>
      <tr><td style="border-bottom:1px solid #bbf7d0">
        <p style="margin:0;font-size:12px;color:#9ca3af;text-transform:uppercase;font-weight:600">Fecha</p>
        <p style="margin:4px 0 0;font-size:14px;color:#374151">${date}</p>
      </td></tr>
      <tr><td>
        <p style="margin:0;font-size:12px;color:#9ca3af;text-transform:uppercase;font-weight:600">Lugar</p>
        <p style="margin:4px 0 0;font-size:14px;color:#374151">${p.eventLocation}</p>
      </td></tr>
    </table>
    <p style="margin:0;color:#6b7280;font-size:14px">¡Que lo disfrutes! 🎉</p>
  `);
}
