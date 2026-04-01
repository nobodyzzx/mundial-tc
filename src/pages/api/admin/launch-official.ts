import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getAdminUser } from '@/lib/auth-helpers';

export const POST: APIRoute = async ({ cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  // Borrar todos los pronósticos
  await supabaseAdmin.from('predictions').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  // Resetear puntos y sanciones de todos los perfiles
  await supabaseAdmin.from('profiles').update({
    puntos_totales: 0,
    puntos_fase_grupos: 0,
    puntos_octavos: 0,
    puntos_cuartos: 0,
    puntos_semis: 0,
    puntos_final: 0,
    tarjetas_amarillas: 0,
    tarjetas_rojas: 0,
    expulsado: false,
  }).neq('id', '00000000-0000-0000-0000-000000000000');

  // Resetear marcadores de partidos ya finalizados a pendiente
  await supabaseAdmin.from('matches').update({
    home_score: null,
    away_score: null,
    home_score_pen: null,
    away_score_pen: null,
    winner_penalties: null,
    is_finished: false,
  }).eq('is_finished', true);

  return redirect('/admin?msg=Versión+oficial+lanzada.+Todos+los+pronósticos+y+puntos+han+sido+reseteados.+Cambiá+PUBLIC_BETA%3Dfalse+en+.env+y+redeploy.');
};
