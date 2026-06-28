/**
 * GET /api/cron/jornada-reminder
 *
 * Aviso de CIERRE de pronósticos por WhatsApp (Green API): "ya no se puede
 * pronosticar". Dispara cuando las apuestas acaban de cerrar — el cierre es 2h
 * antes del primer partido del día Bolivia (JORNADA_CLOSE_MS).
 * Pensado para correr cada ~5–10 min (n8n); envía en la ventana inmediatamente
 * posterior al cierre. Idempotente: registra el envío en sync_logs y no repite
 * el aviso de la misma jornada aunque el cron lo llame varias veces.
 */
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@/lib/supabase';
import { spanishName, teamFlag } from '@/lib/isoFlags';
import { boliviaDayStart, JORNADA_CLOSE_MS } from '@/lib/jornada';
import { betaNowMs } from '@/lib/betaTime';
import { fmtFecha, fmtDiaKey } from '@/lib/fechas';

// Ventana DESPUÉS del cierre en la que aún se manda el aviso. Con el cron cada
// ~5–10 min, garantiza que un tick caiga dentro justo tras el cierre; pasada la
// ventana ya no tiene sentido avisar "recién cerró". La idempotencia evita
// duplicados. (El cierre ocurre 2h antes del primer partido, así que dentro de
// esta ventana los partidos todavía no empezaron.)
const CLOSE_NOTICE_WINDOW_MS = 30 * 60 * 1000; // 30 min tras el cierre

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

function fmtTime(iso: string): string {
  return fmtFecha(iso, {
    hour: '2-digit', minute: '2-digit',
  });
}

// Clave única de jornada: fecha Bolivia (YYYY-MM-DD) del primer partido del día.
function boliviaDateKey(ms: number): string {
  return fmtDiaKey(ms);
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

  // ?preview=1 → arma el mensaje y lo devuelve SIN chequear ventana/idempotencia
  // ni enviarlo. Útil para ver cómo quedaría el aviso (dev/testing).
  const preview = url.searchParams.get('preview') === '1';

  // betaNowMs() = tiempo real en producción (offset 0); en dev respeta el reloj simulado.
  const nowMs = betaNowMs();
  const nowIso = new Date(nowMs).toISOString();

  // 1. Próximo partido no terminado (define la jornada candidata).
  const { data: nextRows } = await supabaseAdmin
    .from('matches')
    .select('match_date')
    .eq('is_finished', false)
    .gt('match_date', nowIso)
    .order('match_date', { ascending: true })
    .limit(1);

  const firstUpcoming = nextRows?.[0];
  if (!firstUpcoming) return json({ skipped: true, reason: 'Sin partidos próximos' });

  // 2. Todos los partidos de ese día Bolivia (incl. terminados) para hallar el primero real.
  const dayStart = boliviaDayStart(new Date(firstUpcoming.match_date).getTime());
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

  const { data: dayMatches } = await supabaseAdmin
    .from('matches')
    .select('id, home_team, away_team, match_date, stage, group_name, round, jornada')
    .gte('match_date', dayStart.toISOString())
    .lt('match_date', dayEnd.toISOString())
    .order('match_date', { ascending: true });

  if (!dayMatches?.length) return json({ skipped: true, reason: 'Sin partidos en la jornada' });

  const firstTime = Math.min(...dayMatches.map(m => new Date(m.match_date).getTime()));
  const cutoffMs = firstTime - JORNADA_CLOSE_MS;
  const remaining = cutoffMs - nowMs;
  const dayKey = boliviaDateKey(firstTime);

  if (!preview) {
    // 3. Ventana: solo en los minutos inmediatamente posteriores al cierre.
    if (remaining > 0) {
      return json({ skipped: true, reason: 'Aún no cierra', minutesToCutoff: Math.round(remaining / 60000) });
    }
    if (-remaining > CLOSE_NOTICE_WINDOW_MS) {
      return json({ skipped: true, reason: 'El cierre fue hace rato', minutesSinceCutoff: Math.round(-remaining / 60000) });
    }

    // 4. Idempotencia: ¿ya se envió el aviso de esta jornada?
    const { data: alreadySent } = await supabaseAdmin
      .from('sync_logs')
      .select('id')
      .eq('source', 'jornada-reminder')
      .eq('endpoint', dayKey)
      .is('error', null)
      .limit(1);

    if (alreadySent?.length) {
      return json({ skipped: true, reason: 'Aviso ya enviado para esta jornada', dayKey });
    }
  }

  // 5. Quién no ha pronosticado todos los partidos del día.
  const isBeta = import.meta.env.PUBLIC_BETA === 'true';
  let pq = supabaseAdmin.from('profiles')
    .select('id, username, pago_70, pago_50')
    .eq('participa', true)
    .eq('expulsado', false)
    .order('username', { ascending: true });
  const { data: participants } = await pq;

  const eligible = (participants ?? []).filter(p => isBeta || (p.pago_70 && p.pago_50));
  const dayIds = dayMatches.map(m => m.id);

  const { data: preds } = await supabaseAdmin
    .from('predictions')
    .select('user_id, match_id')
    .in('match_id', dayIds);

  const countByUser = new Map<string, number>();
  for (const pr of preds ?? []) {
    countByUser.set(pr.user_id, (countByUser.get(pr.user_id) ?? 0) + 1);
  }
  const missing = eligible
    .filter(p => (countByUser.get(p.id) ?? 0) < dayIds.length)
    .map(p => p.username);

  // 6. Construir mensaje.
  const matchLines = dayMatches.map(m =>
    `${teamFlag(m.home_team)} ${spanishName(m.home_team)} vs ${spanishName(m.away_team)} ${teamFlag(m.away_team)} — ${fmtTime(m.match_date)}`
  );

  const text = [
    '🔒 *APUESTAS CERRADAS*',
    '_Polla Mundial 2026_',
    '',
    `⛔ Se acabó. El que no pronosticó, a mirar nomás. Cerró a las *${fmtTime(new Date(cutoffMs).toISOString())}* (2h antes del primer partido).`,
    '',
    '📋 *Partidos de hoy:*',
    ...matchLines,
    '',
    missing.length
      ? `💀 *Se durmieron y no pronosticaron todo:*\n${missing.map(u => `• ${u}`).join('\n')}`
      : '✅ Todos llegaron a tiempo, milagro. Que gane el menos malo ⚽',
    '',
    '👉 mundial.tecnocondor.dev',
  ].join('\n');

  if (preview) {
    return json({ preview: true, dayKey, cutoff: new Date(cutoffMs).toISOString(), matches: dayMatches.length, missing, text });
  }

  // 7. Enviar por Green API.
  const apiUrl     = import.meta.env.GREEN_API_URL;
  const instanceId = import.meta.env.GREEN_API_INSTANCE;
  const apiToken   = import.meta.env.GREEN_API_TOKEN;
  const chatId     = import.meta.env.GREEN_API_CHAT_ID;

  if (!apiUrl || !instanceId || !apiToken || !chatId) {
    return json({ error: 'Green API env vars not configured' }, 500);
  }

  const sendUrl = `${apiUrl}/waInstance${instanceId}/sendMessage/${apiToken}`;
  let sendOk = false;
  let detail = '';
  try {
    const res = await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message: text }),
    });
    sendOk = res.ok;
    detail = await res.text();
  } catch (e: any) {
    detail = e.message;
  }

  // 8. Registrar en sync_logs (con o sin error). El éxito sella la idempotencia.
  await supabaseAdmin.from('sync_logs').insert({
    source: 'jornada-reminder',
    endpoint: dayKey,
    response_status: sendOk ? 200 : 502,
    matches_updated: 0,
    error: sendOk ? null : `Green API: ${detail}`.slice(0, 500),
  });

  if (!sendOk) return json({ error: 'Green API error', detail }, 502);

  return json({
    ok: true,
    dayKey,
    cutoff: new Date(cutoffMs).toISOString(),
    matches: dayMatches.length,
    missing,
  });
};
