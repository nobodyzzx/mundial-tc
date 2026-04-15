/**
 * GET /api/cron/payment-message?secret=CRON_SECRET
 *
 * Devuelve el texto del mensaje de estado de pagos listo para enviar por WhatsApp.
 * Pensado para ser llamado desde n8n u otro automatizador externo.
 * Autenticación por Bearer token o query param ?secret=
 */
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@/lib/supabase';

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
      .select('username, pago_70, pago_50, monto_pagado')
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

  function efectivo(p: any): number {
    const m = p.monto_pagado ?? 0;
    if (m > 0) return m;
    if (p.pago_50) return 120;
    if (p.pago_70) return 70;
    return 0;
  }

  const all = players ?? [];
  const completos  = all.filter(p => (p.monto_pagado ?? 0) >= 120 || p.pago_50);
  const parciales  = all.filter(p => !completos.includes(p) && ((p.monto_pagado ?? 0) >= 70 || p.pago_70));
  const pendientes = all.filter(p => !completos.includes(p) && !parciales.includes(p));

  const deadlines: string[] = [];
  if (deadline70) deadlines.push(`_⏰ 70 Bs: hasta ${fmtIso(deadline70)}_`);
  if (deadline50) deadlines.push(`_⏰ 50 Bs: hasta ${fmtIso(deadline50)}_`);

  const lines: string[] = [];
  completos.forEach(p => {
    lines.push(`✅ ${p.username} — PAGADO 120 Bs ✔`);
  });
  parciales.forEach(p => {
    const m = efectivo(p);
    lines.push(`⏳ ${p.username} — ${m} Bs dep. · faltan ${120 - m} Bs`);
  });
  pendientes.forEach(p => lines.push(`❌ ${p.username} — sin pago`));

  const participantes = [...completos, ...parciales];
  const pozo      = participantes.reduce((s, p) => s + Math.min(efectivo(p) - 20, 100), 0);
  const referi    = participantes.length * 20;
  const metaTotal = participantes.length * 100;

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
