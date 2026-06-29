/**
 * GET /api/cron/payment-message?secret=CRON_SECRET
 *
 * Devuelve el texto del mensaje de estado de pagos listo para enviar por WhatsApp.
 * Pensado para ser llamado desde n8n u otro automatizador externo.
 * Autenticación por Bearer token o query param ?secret=
 */
import type { APIRoute } from 'astro';
import { checkCronSecret, json } from '@/lib/cron';
import { supabaseAdmin } from '@/lib/supabase';
import { estadoPago, resumenPozo, PAGO_COMPLETO_BS } from '@/lib/payments';
import { fmtFecha } from '@/lib/fechas';

export const GET: APIRoute = async ({ url, request }) => {
  if (!(await checkCronSecret(url, request))) {
    return json({ error: 'Unauthorized' }, 401);
  }

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

  const all = players ?? [];
  const completos  = all.filter(p => estadoPago(p.monto_pagado) === 'completo');
  const parciales  = all.filter(p => estadoPago(p.monto_pagado) === 'parcial');
  const pendientes = all.filter(p => estadoPago(p.monto_pagado) === 'pendiente');

  const deadlines: string[] = [];
  if (deadline70) deadlines.push(`_⏰ 70 Bs: hasta ${fmtIso(deadline70)}_`);
  if (deadline50) deadlines.push(`_⏰ 50 Bs: hasta ${fmtIso(deadline50)}_`);

  const lines: string[] = [];
  completos.forEach(p => {
    lines.push(`✅ ${p.username} — PAGADO ${PAGO_COMPLETO_BS} Bs ✔`);
  });
  parciales.forEach(p => {
    const m = p.monto_pagado ?? 0;
    lines.push(`⏳ ${p.username} — ${m} Bs dep. · faltan ${PAGO_COMPLETO_BS - m} Bs`);
  });
  pendientes.forEach(p => lines.push(`❌ ${p.username} — sigue sin pagar 👀`));

  const resumen = resumenPozo(all.map(p => p.monto_pagado));

  const header = ['💰 *ESTADO DE PAGOS*', '_Polla Mundial 2026_', ...deadlines];
  const footer = [
    '',
    `💰 Pozo: ${resumen.pozo} Bs de ${resumen.pozo + resumen.referi} posibles \u2502 ⚖️ Réferi: ${resumen.referi} Bs`,
    '🔗 mundial.tecnocondor.dev/pago',
  ];

  const text = [...header, '', ...lines, ...footer].join('\n');

  return json({
    text,
    stats: {
      total: all.length,
      completos: resumen.completos,
      parciales: resumen.parciales,
      pendientes: resumen.pendientes,
      pozo: resumen.pozo,
      metaTotal: resumen.pozo + resumen.referi,
    },
  });
};
