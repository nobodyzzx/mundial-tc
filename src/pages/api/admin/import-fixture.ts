import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getFixtures, mapStage, mapGroupName, mapRound, mapJornada, deriveWinnerPenalties } from '@/lib/football-api';
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

  let fixtures;
  try {
    fixtures = await getFixtures(code, season);
  } catch (e: any) {
    return redirect(`/admin?err=${encodeURIComponent('Error API: ' + e.message)}`);
  }

  if (!fixtures.length) {
    return redirect(`/admin?err=${encodeURIComponent('No se encontraron partidos para ese torneo/temporada')}`);
  }

  const rows = fixtures.map(f => ({
    external_id:      f.id,
    home_team:        f.homeTeam?.name || 'TBD',
    away_team:        f.awayTeam?.name || 'TBD',
    match_date:       f.utcDate,
    stage:            mapStage(f.stage),
    group_name:       mapGroupName(f.group),
    round:            mapRound(f.stage),
    jornada:          mapJornada(f.stage, f.matchday),
    home_score:       f.score?.fullTime?.home ?? null,
    away_score:       f.score?.fullTime?.away ?? null,
    home_pen:         f.score?.penalties?.home ?? null,
    away_pen:         f.score?.penalties?.away ?? null,
    winner_penalties: f.score ? deriveWinnerPenalties(f.score) : null,
    is_finished:      f.status === 'FINISHED',
  }));

  const { error } = await supabaseAdmin
    .from('matches')
    .upsert(rows, { onConflict: 'external_id' });

  if (error) {
    return redirect(`/admin?err=${encodeURIComponent('Error DB: ' + error.message)}`);
  }

  return redirect(`/admin?msg=${encodeURIComponent(`Fixture importado: ${rows.length} partidos (${code} ${season})`)}`);
};
