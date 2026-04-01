import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { sanitizeError, getAdminUser } from '@/lib/auth-helpers';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  const form = await request.formData();
  const matchId   = form.get('matchId')?.toString();
  const homeScore = parseInt(form.get('homeScore')?.toString() ?? '');
  const awayScore = parseInt(form.get('awayScore')?.toString() ?? '');
  const penHomeStr = form.get('homePen')?.toString() ?? '';
  const penAwayStr = form.get('awayPen')?.toString() ?? '';
  const homePen = penHomeStr !== '' ? parseInt(penHomeStr) : null;
  const awayPen = penAwayStr !== '' ? parseInt(penAwayStr) : null;

  if (!matchId || isNaN(homeScore) || isNaN(awayScore)) {
    return redirect('/admin?err=Datos+incompletos');
  }

  // Scores en rango válido
  if (homeScore < 0 || awayScore < 0) {
    return redirect('/admin?err=El+marcador+no+puede+ser+negativo');
  }
  if (homeScore > 25 || awayScore > 25) {
    return redirect('/admin?err=Marcador+inválido+(máximo+25+goles)');
  }

  // Penales solo válidos si hubo empate
  if ((homePen !== null || awayPen !== null) && homeScore !== awayScore) {
    return redirect('/admin?err=Los+penales+solo+aplican+si+hubo+empate+en+120+minutos');
  }

  // Si se ingresa un score de penales, ambos campos son obligatorios y no puede ser empate
  if (homePen !== null || awayPen !== null) {
    if (homePen === null || awayPen === null) {
      return redirect('/admin?err=Debes+ingresar+ambos+scores+de+penales');
    }
    if (homePen === awayPen) {
      return redirect('/admin?err=El+score+de+penales+no+puede+ser+empate');
    }
  }

  // Verificar que el partido no esté ya finalizado
  const { data: existing } = await supabaseAdmin
    .from('matches')
    .select('is_finished')
    .eq('id', matchId)
    .single();

  if (existing?.is_finished) {
    return redirect('/admin?err=Este+partido+ya+tiene+resultado+cargado');
  }

  // Derivar winner_penalties del score de penales
  let winnerPenalties: string | null = null;
  if (homePen !== null && awayPen !== null) {
    winnerPenalties = homePen > awayPen ? 'home' : 'away';
  }

  const { error: matchError } = await supabaseAdmin
    .from('matches')
    .update({
      home_score: homeScore,
      away_score: awayScore,
      home_pen: homePen,
      away_pen: awayPen,
      winner_penalties: winnerPenalties,
      is_finished: true,
    })
    .eq('id', matchId);

  if (matchError) {
    return redirect('/admin?err=' + encodeURIComponent(sanitizeError(matchError)));
  }

  const { error: calcError } = await supabaseAdmin.rpc('calculate_match_points_safe', {
    p_match_id: matchId,
  });

  if (calcError) {
    return redirect('/admin?err=' + encodeURIComponent('Resultado guardado pero error al calcular puntos'));
  }

  return redirect('/admin?msg=Resultado+cargado+y+puntos+calculados+correctamente');
};
