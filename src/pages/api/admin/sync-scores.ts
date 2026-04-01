import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getFixtures, getFinishedMatches, deriveWinnerPenalties } from '@/lib/football-api';
import { getAdminUser } from '@/lib/auth-helpers';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  const form = await request.formData();
  const code   = form.get('code')?.toString().trim().toUpperCase();
  const season = parseInt(form.get('season')?.toString() ?? '');

  if (!code || isNaN(season)) {
    return redirect(`/admin?err=${encodeURIComponent('Código de torneo y temporada son obligatorios')}`);
  }

  let allFixtures, finished;
  try {
    [allFixtures, finished] = await Promise.all([
      getFixtures(code, season),
      getFinishedMatches(code, season),
    ]);
  } catch (e: any) {
    return redirect(`/admin?err=${encodeURIComponent('Error API: ' + e.message)}`);
  }

  // ── 1. Actualizar nombres de equipos para partidos próximos que ya tienen equipo asignado ──
  const pendingIds = allFixtures
    .filter(f => f.status !== 'FINISHED' && f.homeTeam?.name && f.awayTeam?.name
                 && f.homeTeam.name !== 'TBD' && f.awayTeam.name !== 'TBD')
    .map(f => f.id);

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
    }
  }

  // ── 2. Sincronizar resultados de partidos terminados ──
  if (!finished.length) {
    return redirect(`/admin?msg=${encodeURIComponent('Equipos sincronizados. No hay partidos terminados aún.')}`);
  }

  const externalIds = finished.map(f => f.id);
  const { data: dbMatches } = await supabaseAdmin
    .from('matches')
    .select('id, external_id')
    .in('external_id', externalIds)
    .eq('is_finished', false);

  const dbMap = new Map((dbMatches ?? []).map(m => [m.external_id, m.id]));

  let updated = 0;
  const toCalculate: string[] = [];

  for (const f of finished) {
    const matchId = dbMap.get(f.id);
    if (!matchId) continue;

    const { error } = await supabaseAdmin
      .from('matches')
      .update({
        home_team:        f.homeTeam?.name || undefined,
        away_team:        f.awayTeam?.name || undefined,
        home_score:       f.score.fullTime.home,
        away_score:       f.score.fullTime.away,
        home_pen:         f.score.penalties.home,
        away_pen:         f.score.penalties.away,
        winner_penalties: deriveWinnerPenalties(f.score),
        is_finished:      true,
      })
      .eq('id', matchId);

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
