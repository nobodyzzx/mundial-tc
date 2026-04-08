/**
 * GET /api/cron/send-payment-reminder
 *
 * Llamado por Vercel Cron a las 9:00 AM (hora Bolivia, UTC-4 = 13:00 UTC).
 * Genera el mensaje de estado de pagos y lo envía al grupo de WhatsApp via Green API.
 */
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@/lib/supabase';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request }) => {
  // Vercel Cron envía este header automáticamente — lo usamos para autenticar
  const authHeader = request.headers.get('authorization') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const expected = import.meta.env.CRON_SECRET;
  if (expected && bearer !== expected) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const instanceId = import.meta.env.GREEN_API_INSTANCE;
  const apiToken   = import.meta.env.GREEN_API_TOKEN;
  const chatId     = import.meta.env.GREEN_API_CHAT_ID;

  if (!instanceId || !apiToken || !chatId) {
    return json({ error: 'Green API env vars not configured' }, 500);
  }

  // Obtener datos de pagos y settings en paralelo
  const [{ data: players }, { data: settingsRows }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('username, pago_70, pago_50')
      .eq('participa', true)
      .eq('expulsado', false)
      .order('username', { ascending: true }),
    supabaseAdmin.from('settings').select('key, value'),
  ]);

  const sMap = new Map((settingsRows ?? []).map((r: any) => [r.key, r.value as string]));
  const deadline70 = sMap.get('pagos_deadline_70') ?? '';
  const deadline50 = sMap.get('pagos_deadline_50') ?? '';

  function fmtIso(iso: string) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('es-BO', {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'America/La_Paz',
    hour12: false
    });
  }

  const all        = players ?? [];
  const completos  = all.filter(p => p.pago_70 && p.pago_50);
  const parciales  = all.filter(p => p.pago_70 && !p.pago_50);
  const pendientes = all.filter(p => !p.pago_70);

  // Si todos pagaron completo no tiene sentido mandar el recordatorio
  if (pendientes.length === 0 && parciales.length === 0) {
    return json({ skipped: true, reason: 'Todos los jugadores han pagado completo' });
  }

  const deadlines: string[] = [];
  if (deadline70) deadlines.push(`_⏰ 70 Bs: hasta ${fmtIso(deadline70)}_`);
  if (deadline50) deadlines.push(`_⏰ 50 Bs: hasta ${fmtIso(deadline50)}_`);

  const lines: string[] = [];
  completos.forEach(p  => lines.push(`✅ ${p.username} — 120 Bs ✔`));
  parciales.forEach(p  => lines.push(`⏳ ${p.username} — 70 Bs pagados · falta 50 Bs`));
  pendientes.forEach(p => lines.push(`❌ ${p.username} — sin pago`));

  const pozo     = completos.length * 100 + parciales.length * 50;
  const referi   = (completos.length + parciales.length) * 20;
  const premioMax = all.length * 100;

  const text = [
    '💰 *ESTADO DE PAGOS*',
    '_Polla Mundial 2026_',
    ...deadlines,
    '',
    ...lines,
    '',
    `💰 Pozo: ${pozo} Bs | ⚖️ Réferi: ${referi} Bs | Premio máx: ${premioMax} Bs`,
    '🔗 mundial.tecnocondor.dev/pago',
  ].join('\n');

  // Enviar mensaje via Green API
  const apiUrl = `https://api.green-api.com/waInstance${instanceId}/sendMessage/${apiToken}`;
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, message: text }),
  });

  if (!res.ok) {
    const err = await res.text();
    return json({ error: 'Green API error', detail: err }, 502);
  }

  const result = await res.json();
  return json({
    ok: true,
    idMessage: result.idMessage,
    stats: { total: all.length, completos: completos.length, parciales: parciales.length, pendientes: pendientes.length, pozo },
  });
};
