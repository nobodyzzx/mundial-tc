import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { betaNowMs } from '@/lib/betaTime';
import { getAdminUser } from '@/lib/auth-helpers';

export const POST: APIRoute = async ({ cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  const { data: matches } = await supabaseAdmin
    .from('matches')
    .select('id')
    .order('match_date', { ascending: true });

  if (!matches?.length) {
    return redirect(`/admin?err=${encodeURIComponent('No hay partidos cargados')}`);
  }

  // Distribuir todos los partidos en el pasado:
  // el primero fue hace ~480h (20 días), el último hace 2h
  const now = betaNowMs();
  const total = matches.length;
  const span = 478; // horas entre el primer y último partido

  for (let i = 0; i < total; i++) {
    const hoursAgo = 480 - Math.round((i / Math.max(total - 1, 1)) * span);
    const newDate = new Date(now - hoursAgo * 3_600_000).toISOString();
    await supabaseAdmin
      .from('matches')
      .update({ match_date: newDate, is_finished: false, home_score: null, away_score: null, home_pen: null, away_pen: null, winner_penalties: null })
      .eq('id', matches[i].id);
  }

  return redirect(`/admin?msg=${encodeURIComponent(`${total} partidos adelantados al pasado — ahora simulá juego y resultados`)}`);
};
