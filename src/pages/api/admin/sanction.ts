import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getAdminUser } from '@/lib/auth-helpers';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  const form = await request.formData();
  const userId = form.get('userId')?.toString();
  const type   = form.get('type')?.toString();
  const reason = form.get('reason')?.toString() ?? '';

  if (!userId || !type) return redirect('/admin?err=Datos+incompletos');

  // Prevenir doble sanción roja activa
  if (type === 'red' || type === 'double_red') {
    const { data: existing } = await supabaseAdmin
      .from('sanctions')
      .select('id, type')
      .eq('user_id', userId)
      .in('type', ['red', 'double_red'])
      .eq('active', true);

    if (existing && existing.length > 0) {
      const label = existing[0].type === 'double_red' ? 'ya está expulsado' : 'ya tiene tarjeta roja activa';
      return redirect(`/admin?err=${encodeURIComponent('El usuario ' + label)}`);
    }
  }

  // Registrar sanción
  await supabaseAdmin.from('sanctions').insert({
    user_id: userId,
    type,
    reason,
    created_by: admin.user.id,
    active: true,
  });

  // ROJA o DOBLE ROJA: anular puntos de la jornada activa
  if (type === 'red' || type === 'double_red') {
    const now = Date.now();
    const windowStart = new Date(now - 3600 * 1000).toISOString();
    const nowIso = new Date(now).toISOString();

    const { data: recentMatch } = await supabaseAdmin
      .from('matches')
      .select('id, jornada')
      .gte('match_date', windowStart)
      .lte('match_date', nowIso)
      .order('match_date', { ascending: false })
      .limit(1)
      .single();

    let matchIds: string[] = [];

    if (recentMatch?.jornada) {
      const { data: jornadaMatches } = await supabaseAdmin
        .from('matches')
        .select('id')
        .eq('jornada', recentMatch.jornada);
      matchIds = jornadaMatches?.map(m => m.id) ?? [];
    } else {
      const shifted = new Date(now - 4 * 3600 * 1000);
      const dayStart = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) + 4 * 3600 * 1000);
      const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
      const { data: dayMatches } = await supabaseAdmin
        .from('matches')
        .select('id')
        .gte('match_date', dayStart.toISOString())
        .lt('match_date', dayEnd.toISOString());
      matchIds = dayMatches?.map(m => m.id) ?? [];
    }

    if (matchIds.length > 0) {
      await supabaseAdmin
        .from('predictions')
        .update({ points_earned: 0 })
        .eq('user_id', userId)
        .in('match_id', matchIds);

      // Recalcular puntos totales
      const { data: allPoints } = await supabaseAdmin
        .from('predictions')
        .select('points_earned')
        .eq('user_id', userId)
        .not('points_earned', 'is', null);

      const total = allPoints?.reduce((sum, p) => sum + (p.points_earned ?? 0), 0) ?? 0;
      await supabaseAdmin
        .from('profiles')
        .update({ puntos_totales: total })
        .eq('id', userId);
    }
  }

  // DOBLE ROJA: marcar como expulsado — desaparece de standings
  if (type === 'double_red') {
    await supabaseAdmin
      .from('profiles')
      .update({ expulsado: true })
      .eq('id', userId);
  }

  const typeLabel = type === 'yellow'
    ? 'Amarilla'
    : type === 'red'
    ? 'Roja (jornada anulada)'
    : 'Doble Roja (expulsado permanentemente)';

  return redirect(`/admin?msg=${encodeURIComponent('Sanción aplicada: ' + typeLabel)}`);
};
