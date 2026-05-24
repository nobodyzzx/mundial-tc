/**
 * GET /api/cron/sync-live
 *
 * Polling de partidos en vivo (IN_PLAY + PAUSED). Frecuencia recomendada: 1 min.
 * Auth: Authorization: Bearer CRON_SECRET (o ?secret= legacy).
 *
 * Reglas:
 *   • NO toca partidos con manually_edited_by_referee=TRUE — Yeye manda.
 *   • NO marca FINISHED. Esa transición la cubre /api/cron/sync (cada 5 min).
 *   • Loguea cada ciclo en sync_logs (source='cron-live') para auditoría.
 */
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@/lib/supabase';
import { getLiveMatches } from '@/lib/football-api';

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
  const started = Date.now();
  const expected = import.meta.env.CRON_SECRET;

  const authHeader = request.headers.get('authorization') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const querySecret = url.searchParams.get('secret') ?? '';
  const secret = bearer || querySecret;

  if (!expected || !secret || !(await timingSafeEqual(secret, expected))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const code   = import.meta.env.TOURNAMENT_CODE;
  const season = parseInt(import.meta.env.TOURNAMENT_SEASON ?? '');

  if (!code || isNaN(season)) {
    return json({ error: 'TOURNAMENT_CODE o TOURNAMENT_SEASON no configurados' }, 500);
  }

  const endpoint = `/competitions/${code}/matches?season=${season}&status=IN_PLAY,PAUSED`;

  let live;
  try {
    live = await getLiveMatches(code, season);
  } catch (e: any) {
    await logSync(endpoint, 502, 0, Date.now() - started, e.message);
    return json({ error: 'Error API fútbol: ' + e.message }, 502);
  }

  if (!live.length) {
    await logSync(endpoint, 200, 0, Date.now() - started, null);
    return json({ ok: true, updated: 0, skippedManual: 0, totalLive: 0, message: 'Sin partidos en vivo' });
  }

  const externalIds = live.map(m => m.id);
  const { data: dbMatches } = await supabaseAdmin
    .from('matches')
    .select('id, external_id, manually_edited_by_referee')
    .in('external_id', externalIds);

  const dbMap = new Map((dbMatches ?? []).map(m => [m.external_id, m]));

  let updated = 0;
  let skippedManual = 0;
  const now = new Date().toISOString();

  for (const f of live) {
    const dbMatch = dbMap.get(f.id);
    if (!dbMatch) continue;
    if (dbMatch.manually_edited_by_referee) { skippedManual++; continue; }

    const { error } = await supabaseAdmin
      .from('matches')
      .update({
        status:         f.status,
        minute:         f.minute ?? null,
        home_score:     f.score.fullTime.home,
        away_score:     f.score.fullTime.away,
        score_home_ht:  f.score.halfTime?.home ?? null,
        score_away_ht:  f.score.halfTime?.away ?? null,
        last_synced_at: now,
      })
      .eq('id', dbMatch.id);

    if (!error) updated++;
  }

  await logSync(endpoint, 200, updated, Date.now() - started, null);

  return json({
    ok: true,
    updated,
    skippedManual,
    totalLive: live.length,
    message: `${updated} partido(s) actualizado(s) en vivo`,
  });
};

async function logSync(
  endpoint: string,
  responseStatus: number | null,
  matchesUpdated: number,
  durationMs: number,
  error: string | null,
) {
  await supabaseAdmin.from('sync_logs').insert({
    source:          'cron-live',
    endpoint,
    response_status: responseStatus,
    matches_updated: matchesUpdated,
    duration_ms:     durationMs,
    error,
  });
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
