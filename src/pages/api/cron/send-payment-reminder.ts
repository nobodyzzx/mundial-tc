/**
 * GET /api/cron/send-payment-reminder
 *
 * Llamado por Vercel Cron a las 9:00 AM (hora Bolivia, UTC-4 = 13:00 UTC).
 * Genera el mensaje de estado de pagos y lo envía al grupo de WhatsApp via Green API.
 */
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@/lib/supabase';
import { estadoPago, aportePozo, CUOTA_REFERI_BS, APORTE_POZO_MAX_BS, PAGO_COMPLETO_BS } from '@/lib/payments';
import { fmtFecha } from '@/lib/fechas';

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

  const apiUrl     = import.meta.env.GREEN_API_URL;
  const instanceId = import.meta.env.GREEN_API_INSTANCE;
  const apiToken   = import.meta.env.GREEN_API_TOKEN;
  const chatId     = import.meta.env.GREEN_API_CHAT_ID;

  if (!apiUrl || !instanceId || !apiToken || !chatId) {
    return json({ error: 'Green API env vars not configured' }, 500);
  }

  // Obtener datos de pagos y settings en paralelo
  const [{ data: players }, { data: settingsRows }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('username, monto_pagado')
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
    return fmtFecha(iso, {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit',
    });
  }

  const all        = players ?? [];
  const completos  = all.filter(p => estadoPago(p.monto_pagado) === 'completo');
  const parciales  = all.filter(p => estadoPago(p.monto_pagado) === 'parcial');
  const pendientes = all.filter(p => estadoPago(p.monto_pagado) === 'pendiente');

  // Si todos pagaron completo no tiene sentido mandar el recordatorio
  if (pendientes.length === 0 && parciales.length === 0) {
    return json({ skipped: true, reason: 'Todos los jugadores han pagado completo' });
  }

  const deadlines: string[] = [];
  if (deadline70) deadlines.push(`_⏰ 70 Bs: hasta ${fmtIso(deadline70)}_`);
  if (deadline50) deadlines.push(`_⏰ 50 Bs: hasta ${fmtIso(deadline50)}_`);

  const lines: string[] = [];
  completos.forEach(p => lines.push(`✅ ${p.username} — PAGADO ${PAGO_COMPLETO_BS} Bs ✔`));
  parciales.forEach(p => {
    const m = p.monto_pagado ?? 0;
    lines.push(`⏳ ${p.username} — ${m} Bs dep. · faltan ${PAGO_COMPLETO_BS - m} Bs`);
  });
  pendientes.forEach(p => lines.push(`❌ ${p.username} — sigue sin pagar 👀`));

  const participantes = [...completos, ...parciales];
  const pozo      = participantes.reduce((s, p) => s + aportePozo(p.monto_pagado), 0);
  const referi    = participantes.length * CUOTA_REFERI_BS;
  const metaTotal = participantes.length * APORTE_POZO_MAX_BS;

  const text = [
    '💰 *ESTADO DE PAGOS*',
    '_Polla Mundial 2026_',
    ...deadlines,
    '',
    ...lines,
    '',
    `💰 Pozo: ${pozo} Bs de ${metaTotal} posibles \u2502 ⚖️ Réferi: ${referi} Bs`,
    '🔗 mundial.tecnocondor.dev/pago',
  ].join('\n');

  // Enviar mensaje via Green API
  const sendUrl = `${apiUrl}/waInstance${instanceId}/sendMessage/${apiToken}`;
  const res = await fetch(sendUrl, {
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
    stats: { total: all.length, completos: completos.length, parciales: parciales.length, pendientes: pendientes.length, pozo, metaTotal },
  });
};
