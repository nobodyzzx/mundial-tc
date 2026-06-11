/**
 * GET /api/cron/sync?secret=CRON_SECRET
 *
 * Endpoint para automatización externa (cron-job.org, uptime monitors, etc.)
 * No requiere sesión — autenticación por secret en query param.
 * Sincroniza el torneo configurado en TOURNAMENT_CODE / TOURNAMENT_SEASON.
 */
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@/lib/supabase';
import { getFixtures, getFinishedMatches, deriveWinnerPenalties } from '@/lib/football-api';

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  try {
    const enc = new TextEncoder();
    const ab = enc.encode(a);
    const bb = enc.encode(b);
    // Longitudes distintas → falso, pero seguimos para no filtrar por timing
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

  // Aceptar secret en Authorization header (preferido) o query param (legacy)
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

  let allFixtures, finished;
  try {
    [allFixtures, finished] = await Promise.all([
      getFixtures(code, season),
      getFinishedMatches(code, season),
    ]);
  } catch (e: any) {
    return json({ error: 'Error API fútbol: ' + e.message }, 502);
  }

  // ── 1. Actualizar nombres TBD en partidos pendientes ────────────
  const pendingIds = allFixtures
    .filter(f => f.status !== 'FINISHED' && f.homeTeam?.name && f.awayTeam?.name
                 && f.homeTeam.name !== 'TBD' && f.awayTeam.name !== 'TBD')
    .map(f => f.id);

  let namesUpdated = 0;
  if (pendingIds.length) {
    const { data: pendingDb } = await supabaseAdmin
      .from('matches')
      .select('id, external_id, home_team, away_team')
      .in('external_id', pendingIds)
      .eq('is_finished', false);

    const fixtureMap = new Map(allFixtures.map(f => [f.id, f]));
    for (const dbMatch of pendingDb ?? []) {
      const api = fixtureMap.get(dbMatch.external_id);
      if (!api) continue;
      const newHome = api.homeTeam?.name;
      const newAway = api.awayTeam?.name;
      if (!newHome || !newAway) continue;
      if (newHome === dbMatch.home_team && newAway === dbMatch.away_team) continue;
      await supabaseAdmin.from('matches').update({ home_team: newHome, away_team: newAway }).eq('id', dbMatch.id);
      namesUpdated++;
    }
  }

  // ── 2. Sincronizar resultados terminados ────────────────────────
  if (!finished.length) {
    return json({ ok: true, namesUpdated, scoresUpdated: 0, message: 'Sin partidos terminados nuevos' });
  }

  const externalIds = finished.map(f => f.id);
  const { data: dbMatches } = await supabaseAdmin
    .from('matches')
    .select('id, external_id')
    .in('external_id', externalIds)
    .eq('is_finished', false);

  const dbMap = new Map((dbMatches ?? []).map(m => [m.external_id, m.id]));

  let scoresUpdated = 0;
  const toCalculate: string[] = [];

  for (const f of finished) {
    const matchId = dbMap.get(f.id);
    if (!matchId) continue;

    // La API a veces marca FINISHED sin marcador cargado aún: no escribir null.
    if (f.score.fullTime.home === null || f.score.fullTime.away === null) continue;

    const { error } = await supabaseAdmin
      .from('matches')
      .update({
        home_team:        f.homeTeam?.name || undefined,
        away_team:        f.awayTeam?.name || undefined,
        home_score:       f.score.fullTime.home,
        away_score:       f.score.fullTime.away,
        home_pen:         f.score.penalties?.home ?? null,
        away_pen:         f.score.penalties?.away ?? null,
        winner_penalties: deriveWinnerPenalties(f.score),
        is_finished:      true,
      })
      .eq('id', matchId);

    if (!error) {
      scoresUpdated++;
      toCalculate.push(matchId);
    }
  }

  for (const matchId of toCalculate) {
    await supabaseAdmin.rpc('calculate_match_points_safe', { p_match_id: matchId });
  }

  return json({ ok: true, namesUpdated, scoresUpdated, message: `${scoresUpdated} partido(s) sincronizado(s)` });
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
