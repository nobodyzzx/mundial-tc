/**
 * Envío de mensajes al grupo de WhatsApp vía Green API.
 * Las credenciales (GREEN_API_*) viven en el dashboard de Vercel, no en el repo.
 */
import { logEvent } from './system-log';
import { supabaseAdmin } from './supabase';
import { fmtDiaKey } from './fechas';

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

/**
 * Publica un AVISO DE ERROR en el grupo de la polla cuando la automatización
 * falla (sync caído, proveedor de marcadores con error, excepción inesperada),
 * para que un fallo no pase desapercibido. Incluye una línea para que la referí,
 * que está en el grupo, ingrese pronósticos/resultados a mano si hace falta.
 *
 * Best-effort y NO directo: solo va al grupo (mismo canal que los mensajes
 * normales). Deduplicado por día y fuente vía sync_logs (source 'alert') para
 * no spamear si un cron que corre cada pocos minutos sigue fallando. Nunca
 * lanza: un fallo al avisar jamás debe romper el cron que lo invoca.
 */
export async function alertGroupError(opts: {
  /** Cron/flujo que falló (p.ej. 'sync', 'resumen-dia'). */
  source: string;
  /** Detalle técnico corto del error. */
  detail: string;
}): Promise<void> {
  try {
    // Dedupe: un solo aviso por fuente y día. La clave usa el día Bolivia.
    const dedupeKey = `${opts.source}:${fmtDiaKey(Date.now())}`;
    const { data: already } = await supabaseAdmin
      .from('sync_logs')
      .select('id')
      .eq('source', 'alert')
      .eq('endpoint', dedupeKey)
      .is('error', null)
      .limit(1);
    if (already?.length) return;

    const text = [
      `🚨 *Problema en la app · ${opts.source}*`,
      opts.detail.slice(0, 300),
      '',
      '⚖️ Referí: si hace falta, ingresa los pronósticos/resultados a mano desde el panel.',
      '👉 mundial.tecnocondor.dev/admin',
    ].join('\n');

    const res = await sendWhatsApp(text, 'alert');
    // Sella el dedupe solo si se envió (si WhatsApp también está caído, se
    // reintentará en la próxima corrida del cron).
    if (res.ok) {
      await supabaseAdmin.from('sync_logs').insert({
        source: 'alert',
        endpoint: dedupeKey,
        response_status: 200,
        matches_updated: 0,
        error: null,
      });
    }
  } catch { /* avisar nunca debe romper el cron que llama */ }
}

/**
 * Avisa al grupo (donde está la referí) que la BD falló al guardar el pronóstico
 * de un jugador DENTRO de la ventana, para que se valide a mano. NO incluye los
 * marcadores: el pronóstico es secreto hasta el cierre y filtrarlo al grupo lo
 * revelaría. Los marcadores sí quedan en system_log (privado, panel admin), que
 * es de donde la referí los valida. Deduplicado por jugador y día para no spamear
 * si la BD tiene un bache que afecta a varios. Best-effort: nunca rompe el envío.
 */
export async function alertReferiPredictionFail(username: string): Promise<void> {
  try {
    const dedupeKey = `predfail:${username}:${fmtDiaKey(Date.now())}`;
    const { data: already } = await supabaseAdmin
      .from('sync_logs')
      .select('id')
      .eq('source', 'alert')
      .eq('endpoint', dedupeKey)
      .is('error', null)
      .limit(1);
    if (already?.length) return;

    const hora = new Date().toLocaleTimeString('es-BO', {
      timeZone: 'America/La_Paz', hour12: false,
    });
    const text = [
      '⚠️ *Fallo al guardar un pronóstico*',
      `La base falló al registrar el pronóstico de *${username}* dentro de la ventana (${hora}).`,
      'Sus marcadores quedaron registrados para validación.',
      '',
      '⚖️ Referí: valídalo / ingrésalo a mano desde el panel.',
      '👉 mundial.tecnocondor.dev/admin',
    ].join('\n');

    const res = await sendWhatsApp(text, 'alert');
    if (res.ok) {
      await supabaseAdmin.from('sync_logs').insert({
        source: 'alert',
        endpoint: dedupeKey,
        response_status: 200,
        matches_updated: 0,
        error: null,
      });
    }
  } catch { /* avisar nunca debe romper el envío del pronóstico */ }
}
