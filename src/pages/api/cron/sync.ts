/**
 * GET /api/cron/sync?secret=CRON_SECRET
 *
 * Endpoint para automatización externa (cron-job.org, uptime monitors, etc.)
 * No requiere sesión — autenticación por secret en query param.
 * Sincroniza el torneo configurado en TOURNAMENT_CODE / TOURNAMENT_SEASON.
 */
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@/lib/supabase';
import { getFixtures, deriveWinnerPenalties } from '@/lib/football-api';
import { linkMatches, isPlaceholderName } from '@/lib/match-link';
import { logEvent } from '@/lib/system-log';

const PROVIDER = (import.meta.env.MATCH_PROVIDER ?? 'football-data').toLowerCase();

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

  // Gate (api-football): la cuota free es 100/día. Solo se llama a la API si hay un
  // partido en ventana de juego (chequeo gratis en la BD). Evita gastar requests las
  // ~20h sin partidos. football-data no tiene cuota diaria → no se gatea.
  if (PROVIDER === 'api-football') {
    const nowIso = new Date().toISOString();
    const sinceIso = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
    const { data: active } = await supabaseAdmin
      .from('matches')
      .select('id')
      .eq('is_finished', false)
      .gte('match_date', sinceIso)
      .lte('match_date', nowIso)
      .limit(1);
    if (!active?.length) {
      return json({ ok: true, provider: PROVIDER, skipped: true, reason: 'Sin partido en ventana de juego', namesUpdated: 0, scoresUpdated: 0 });
    }
  }

  // Una sola llamada: trae todos los partidos (en vivo/terminados/programados).
  // Los terminados se derivan filtrando status (evita una segunda request).
  let allFixtures;
  try {
    allFixtures = await getFixtures(code, season);
  } catch (e: any) {
    return json({ error: 'Error API fútbol: ' + e.message }, 502);
  }
  const finished = allFixtures.filter(f => f.status === 'FINISHED');

  // DB: partidos no terminados (candidatos para nombres y resultados).
  const { data: dbMatchesRaw } = await supabaseAdmin
    .from('matches')
    .select('id, external_id, match_date, home_team, away_team')
    .eq('is_finished', false);
  const dbRows = dbMatchesRaw ?? [];
  const dbById = new Map(dbRows.map(d => [d.id, d]));

  // ── 1. Rellenar nombres de placeholders de bracket ya definidos ──
  const pending = allFixtures.filter(f =>
    f.status !== 'FINISHED' && f.homeTeam?.name && f.awayTeam?.name
    && f.homeTeam.name !== 'TBD' && f.awayTeam.name !== 'TBD');
  const pendingLink = linkMatches(pending, dbRows, PROVIDER);

  let namesUpdated = 0;
  for (const f of pending) {
    const id = pendingLink.get(f);
    if (!id) continue;
    const db = dbById.get(id)!;
    // Solo rellenar lados que siguen siendo placeholder; no renombrar equipos reales
    // (los nombres difieren entre proveedores y romperían flags/nombres en español).
    const newHome = isPlaceholderName(db.home_team) ? f.homeTeam.name : db.home_team;
    const newAway = isPlaceholderName(db.away_team) ? f.awayTeam.name : db.away_team;
    if (newHome === db.home_team && newAway === db.away_team) continue;
    await supabaseAdmin.from('matches').update({ home_team: newHome, away_team: newAway }).eq('id', id);
    namesUpdated++;
  }

  // ── 2. Sincronizar resultados terminados ────────────────────────
  if (!finished.length) {
    return json({ ok: true, provider: PROVIDER, namesUpdated, scoresUpdated: 0, message: 'Sin partidos terminados nuevos' });
  }

  const finishedLink = linkMatches(finished, dbRows, PROVIDER);

  let scoresUpdated = 0;
  const toCalculate: string[] = [];

  for (const f of finished) {
    const matchId = finishedLink.get(f);
    if (!matchId) continue;

    // La API a veces marca FINISHED sin marcador cargado aún: no escribir null.
    if (f.score.fullTime.home === null || f.score.fullTime.away === null) continue;

    const db = dbById.get(matchId);
    const update: Record<string, any> = {
      home_score:       f.score.fullTime.home,
      away_score:       f.score.fullTime.away,
      home_pen:         f.score.penalties?.home ?? null,
      away_pen:         f.score.penalties?.away ?? null,
      winner_penalties: deriveWinnerPenalties(f.score),
      is_finished:      true,
    };
    // Rellenar nombres solo si el lado sigue siendo placeholder (knockouts).
    if (db && isPlaceholderName(db.home_team) && f.homeTeam?.name) update.home_team = f.homeTeam.name;
    if (db && isPlaceholderName(db.away_team) && f.awayTeam?.name) update.away_team = f.awayTeam.name;

    const { error } = await supabaseAdmin.from('matches').update(update).eq('id', matchId);

    if (!error) {
      scoresUpdated++;
      toCalculate.push(matchId);
      await logEvent({
        category: 'marcador',
        event: 'sync',
        actor: PROVIDER,
        summary: `${db?.home_team ?? '?'} ${update.home_score}-${update.away_score} ${db?.away_team ?? '?'}`,
      });
    }
  }

  for (const matchId of toCalculate) {
    await supabaseAdmin.rpc('calculate_match_points_safe', { p_match_id: matchId });
  }

  return json({ ok: true, provider: PROVIDER, namesUpdated, scoresUpdated, message: `${scoresUpdated} partido(s) sincronizado(s)` });
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
