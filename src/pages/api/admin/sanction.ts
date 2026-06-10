import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getAdminUser } from '@/lib/auth-helpers';
import { boliviaDayStart } from '@/lib/jornada';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  const form = await request.formData();
  const userId = form.get('userId')?.toString();
  const type   = form.get('type')?.toString();
  const reason = form.get('reason')?.toString() ?? '';

  if (!userId || !type) return redirect('/admin?err=Datos+incompletos');
  if (!['yellow', 'red', 'double_red'].includes(type)) return redirect('/admin?err=Tipo+de+sanción+no+válido');

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

  // ROJA o DOBLE ROJA: anular puntos del DÍA de juego activo (frontera 03:00 BOT,
  // igual que calculate_match_points y el cierre de jornada).
  if (type === 'red' || type === 'double_red') {
    const dayStart = boliviaDayStart(Date.now());
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

    const { data: dayMatches } = await supabaseAdmin
      .from('matches')
      .select('id')
      .gte('match_date', dayStart.toISOString())
      .lt('match_date', dayEnd.toISOString());
    const matchIds = dayMatches?.map(m => m.id) ?? [];

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
