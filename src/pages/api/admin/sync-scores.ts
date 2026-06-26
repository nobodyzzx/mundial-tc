import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getFixtures, deriveWinnerPenalties } from '@/lib/football-api';
import { linkMatches, isPlaceholderName, canonicalTeamName } from '@/lib/match-link';
import { getAdminUser } from '@/lib/auth-helpers';

const PROVIDER = (import.meta.env.MATCH_PROVIDER ?? 'football-data').toLowerCase();

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  const form = await request.formData();
  const code   = form.get('code')?.toString().trim().toUpperCase();
  const season = parseInt(form.get('season')?.toString() ?? '');

  if (!code || isNaN(season)) {
    return redirect(`/admin?err=${encodeURIComponent('Código de torneo y temporada son obligatorios')}`);
  }

  let allFixtures;
  try {
    allFixtures = await getFixtures(code, season);
  } catch (e: any) {
    return redirect(`/admin?err=${encodeURIComponent('Error API: ' + e.message)}`);
  }
  const finished = allFixtures.filter(f => f.status === 'FINISHED');

  // DB: partidos no terminados (candidatos para nombres y resultados).
  const { data: dbMatchesRaw } = await supabaseAdmin
    .from('matches')
    .select('id, external_id, match_date, home_team, away_team')
    .eq('is_finished', false);
  const dbRows = dbMatchesRaw ?? [];
  const dbById = new Map(dbRows.map(d => [d.id, d]));

  // Nombres canónicos reales (no placeholder) de todos los partidos en BD.
  const { data: allNames } = await supabaseAdmin.from('matches').select('home_team, away_team');
  const knownNames: string[] = [];
  for (const row of allNames ?? []) {
    if (!isPlaceholderName(row.home_team)) knownNames.push(row.home_team);
    if (!isPlaceholderName(row.away_team)) knownNames.push(row.away_team);
  }

  // ── 1. Rellenar nombres de placeholders de bracket ya definidos ──
  const pending = allFixtures.filter(f =>
    f.status !== 'FINISHED' && f.homeTeam?.name && f.awayTeam?.name
    && f.homeTeam.name !== 'TBD' && f.awayTeam.name !== 'TBD');
  const pendingLink = linkMatches(pending, dbRows, PROVIDER);

  for (const f of pending) {
    const id = pendingLink.get(f);
    if (!id) continue;
    const db = dbById.get(id)!;
    const newHome = isPlaceholderName(db.home_team) ? canonicalTeamName(f.homeTeam.name, knownNames) : db.home_team;
    const newAway = isPlaceholderName(db.away_team) ? canonicalTeamName(f.awayTeam.name, knownNames) : db.away_team;
    if (newHome === db.home_team && newAway === db.away_team) continue;
    await supabaseAdmin.from('matches').update({ home_team: newHome, away_team: newAway }).eq('id', id);
  }

  // ── 2. Sincronizar resultados de partidos terminados ──
  if (!finished.length) {
    return redirect(`/admin?msg=${encodeURIComponent('Equipos sincronizados. No hay partidos terminados aún.')}`);
  }

  const finishedLink = linkMatches(finished, dbRows, PROVIDER);

  let updated = 0;
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
    if (db && isPlaceholderName(db.home_team) && f.homeTeam?.name) update.home_team = canonicalTeamName(f.homeTeam.name, knownNames);
    if (db && isPlaceholderName(db.away_team) && f.awayTeam?.name) update.away_team = canonicalTeamName(f.awayTeam.name, knownNames);

    const { error } = await supabaseAdmin.from('matches').update(update).eq('id', matchId);

    if (!error) {
      updated++;
      toCalculate.push(matchId);
    }
  }

  for (const matchId of toCalculate) {
    await supabaseAdmin.rpc('calculate_match_points_safe', { p_match_id: matchId });
  }

  const msg = updated > 0
    ? `${updated} partido(s) sincronizado(s) y puntos calculados`
    : 'Equipos actualizados · Sin resultados nuevos';

  return redirect(`/admin?msg=${encodeURIComponent(msg)}`);
};
