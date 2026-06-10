/**
 * GET /api/cron/payment-message?secret=CRON_SECRET
 *
 * Devuelve el texto del mensaje de estado de pagos listo para enviar por WhatsApp.
 * Pensado para ser llamado desde n8n u otro automatizador externo.
 * Autenticación por Bearer token o query param ?secret=
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

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  try {
    const enc = new TextEncoder();
    const ab = enc.encode(a);
    const bb = enc.encode(b);
    const key = await crypto.subtle.importKey('raw', ab, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const [sigA, sigB] = await Promise.all([
      crypto.subtle.sign('HMAC', key, ab),
      crypto.subtle.sign('HMAC', key, bb),
    ]);
    const da = new Uint8Array(sigA);
    const db = new Uint8Array(sigB);
    let diff = da.length ^ db.length;
    for (let i = 0; i < Math.min(da.length, db.length); i++) diff |= da[i] ^ db[i];
    return diff === 0 && ab.byteLength === bb.byteLength;
  } catch {
    return false;
  }
}

export const GET: APIRoute = async ({ url, request }) => {
  const expected = import.meta.env.CRON_SECRET;

  const authHeader = request.headers.get('authorization') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const querySecret = url.searchParams.get('secret') ?? '';
  const secret = bearer || querySecret;

  if (!expected || !secret || !(await timingSafeEqual(secret, expected))) {
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
  pendientes.forEach(p => lines.push(`❌ ${p.username} — sin pago`));

  const participantes = [...completos, ...parciales];
  const pozo      = participantes.reduce((s, p) => s + aportePozo(p.monto_pagado), 0);
  const referi    = participantes.length * CUOTA_REFERI_BS;
  const metaTotal = participantes.length * APORTE_POZO_MAX_BS;

  const header = ['💰 *ESTADO DE PAGOS*', '_Polla Mundial 2026_', ...deadlines];
  const footer = [
    '',
    `💰 Pozo: ${pozo} Bs de ${metaTotal} posibles \u2502 ⚖️ Réferi: ${referi} Bs`,
    '🔗 mundial.tecnocondor.dev/pago',
  ];

  const text = [...header, '', ...lines, ...footer].join('\n');

  return json({
    text,
    stats: {
      total: all.length,
      completos: completos.length,
      parciales: parciales.length,
      pendientes: pendientes.length,
      pozo,
      metaTotal,
    },
  });
};
