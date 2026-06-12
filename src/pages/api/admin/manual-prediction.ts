import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getAdminUser } from '@/lib/auth-helpers';

export const POST: APIRoute = async ({ request, cookies }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Body inválido' }), { status: 400 });
  }

  const { user_id, match_id, user_home, user_away, user_home_pen, user_away_pen } = body;

  if (!user_id || !match_id || user_home == null || user_away == null) {
    return new Response(JSON.stringify({ error: 'Faltan campos obligatorios' }), { status: 400 });
  }
  if (typeof user_home !== 'number' || typeof user_away !== 'number') {
    return new Response(JSON.stringify({ error: 'Marcadores deben ser números' }), { status: 400 });
  }
  if (user_home < 0 || user_home > 20 || user_away < 0 || user_away > 20) {
    return new Response(JSON.stringify({ error: 'Marcador fuera de rango (0-20)' }), { status: 400 });
  }

  const homePen: number | null = user_home_pen ?? null;
  const awayPen: number | null = user_away_pen ?? null;

  if ((homePen !== null || awayPen !== null) && user_home !== user_away) {
    return new Response(JSON.stringify({ error: 'Penales solo válidos en empate' }), { status: 400 });
  }
  if ((homePen !== null) !== (awayPen !== null)) {
    return new Response(JSON.stringify({ error: 'Debes ingresar ambos scores de penales' }), { status: 400 });
  }
  if (homePen !== null && awayPen !== null && homePen === awayPen) {
    return new Response(JSON.stringify({ error: 'Penales no pueden empatar' }), { status: 400 });
  }

  const { data: match } = await supabaseAdmin
    .from('matches')
    .select('is_finished, stage')
    .eq('id', match_id)
    .single();

  if (!match) return new Response(JSON.stringify({ error: 'Partido no encontrado' }), { status: 404 });
  if (match.is_finished) return new Response(JSON.stringify({ error: 'El partido ya está terminado' }), { status: 400 });

  if (match.stage === 'knockout' && user_home === user_away) {
    if (homePen === null || awayPen === null) {
      return new Response(JSON.stringify({ error: 'Empate en eliminatoria requiere score de penales' }), { status: 400 });
    }
  }

  let winnerPen: string | null = null;
  if (homePen !== null && awayPen !== null) {
    winnerPen = homePen > awayPen ? 'home' : 'away';
  }

  const { error } = await supabaseAdmin.from('predictions').upsert(
    {
      user_id,
      match_id,
      user_home,
      user_away,
      user_home_pen: homePen,
      user_away_pen: awayPen,
      user_winner_penalties: winnerPen,
      ingresado_por_referi: true,
    },
    { onConflict: 'user_id,match_id' }
  );

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
