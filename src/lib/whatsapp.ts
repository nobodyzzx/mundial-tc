/**
 * Envío de mensajes al grupo de WhatsApp vía Green API.
 * Las credenciales (GREEN_API_*) viven en el dashboard de Vercel, no en el repo.
 */
import { logEvent } from './system-log';

export type WhatsAppResult = { ok: boolean; detail: string; configured: boolean };

/** Primera línea del mensaje (sin formato WhatsApp) como resumen para la bitácora. */
function firstLine(message: string): string {
  return (message.split('\n')[0] ?? '').replace(/[*_~`]/g, '').trim().slice(0, 120);
}

export async function sendWhatsApp(message: string, source = 'mensaje'): Promise<WhatsAppResult> {
  const apiUrl     = import.meta.env.GREEN_API_URL;
  const instanceId = import.meta.env.GREEN_API_INSTANCE;
  const apiToken   = import.meta.env.GREEN_API_TOKEN;
  const chatId     = import.meta.env.GREEN_API_CHAT_ID;

  if (!apiUrl || !instanceId || !apiToken || !chatId) {
    return { ok: false, detail: 'Green API env vars not configured', configured: false };
  }

  const sendUrl = `${apiUrl}/waInstance${instanceId}/sendMessage/${apiToken}`;
  try {
    const res = await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message }),
    });
    // Bitácora central: registra cada envío exitoso (qué y a qué hora).
    if (res.ok) await logEvent({ category: 'whatsapp', event: source, actor: 'sistema', summary: firstLine(message) });
    return { ok: res.ok, detail: await res.text(), configured: true };
  } catch (e: any) {
    return { ok: false, detail: e?.message ?? 'fetch failed', configured: true };
  }
}
