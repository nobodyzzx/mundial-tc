/**
 * Envío de mensajes al grupo de WhatsApp vía Green API.
 * Las credenciales (GREEN_API_*) viven en el dashboard de Vercel, no en el repo.
 */
export type WhatsAppResult = { ok: boolean; detail: string; configured: boolean };

export async function sendWhatsApp(message: string): Promise<WhatsAppResult> {
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
    return { ok: res.ok, detail: await res.text(), configured: true };
  } catch (e: any) {
    return { ok: false, detail: e?.message ?? 'fetch failed', configured: true };
  }
}
