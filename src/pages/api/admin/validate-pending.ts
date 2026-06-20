import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getAdminUser } from '@/lib/auth-helpers';
import { logEvent } from '@/lib/system-log';

/**
 * Valida un pronóstico que falló al guardarse (BD caída) dentro de la ventana.
 * Toma la fila de `pending_predictions` (user_id + marcadores en jsonb) y la
 * inserta como pronóstico real, marcando la sanción del intento como resuelta.
 * Reusa la misma lógica que el ingreso manual del réferi (upsert + winner_pen).
 *
 * Es POST-form desde el panel (vuelve a /admin con ?msg/?err), como el resto de
 * acciones del réferi. NO reescribe los números: respeta lo que el jugador envió.
 */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  const form = await request.formData();
  const id = form.get('id')?.toString();
  if (!id) return redirect('/admin?err=' + encodeURIComponent('Falta el id del pendiente'));

  const { data: pending } = await supabaseAdmin
    .from('pending_predictions')
    .select('id, user_id, entries, resolved')
    .eq('id', id)
    .single();

  if (!pending) return redirect('/admin?err=' + encodeURIComponent('Pendiente no encontrado'));
  if (pending.resolved) return redirect('/admin?msg=' + encodeURIComponent('Ese pendiente ya estaba validado'));

  const entries = Array.isArray(pending.entries) ? (pending.entries as any[]) : [];
  if (!entries.length) return redirect('/admin?err=' + encodeURIComponent('El pendiente no tiene marcadores'));

  // Estado de los partidos: no se puede validar uno ya terminado (su puntaje ya
  // se calculó). Se valida lo que aún se pueda; se reporta lo que no.
  const matchIds = entries.map(e => e.match_id);
  const { data: matchRows } = await supabaseAdmin
    .from('matches')
    .select('id, is_finished, stage')
    .in('id', matchIds);
  const matchMap = new Map((matchRows ?? []).map(m => [m.id, m]));

  const toInsert: any[] = [];
  let skippedFinished = 0;
  for (const e of entries) {
    const m = matchMap.get(e.match_id);
    if (!m || m.is_finished) { skippedFinished++; continue; }

    const homePen = e.user_home_pen ?? null;
    const awayPen = e.user_away_pen ?? null;
    let winnerPen: string | null = null;
    if (homePen !== null && awayPen !== null) winnerPen = homePen > awayPen ? 'home' : 'away';

    toInsert.push({
      user_id: pending.user_id,
      match_id: e.match_id,
      user_home: e.user_home,
      user_away: e.user_away,
      user_home_pen: homePen,
      user_away_pen: awayPen,
      user_winner_penalties: winnerPen,
      ingresado_por_referi: true,
    });
  }

  if (toInsert.length) {
    const { error } = await supabaseAdmin
      .from('predictions')
      .upsert(toInsert, { onConflict: 'user_id,match_id' });
    if (error) return redirect('/admin?err=' + encodeURIComponent('Error al guardar: ' + error.message));
  }

  // Marcar resuelto (aunque todo estuviera terminado: ya no hay nada que hacer).
  await supabaseAdmin
    .from('pending_predictions')
    .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: admin.user.id })
    .eq('id', id);

  const { data: target } = await supabaseAdmin
    .from('profiles').select('username').eq('id', pending.user_id).single();

  await logEvent({
    category: 'pronostico',
    event: 'validacion-pendiente',
    actor: admin.username,
    summary: `${admin.username} validó el pronóstico pendiente de ${target?.username ?? '?'} (${toInsert.length} partido(s))`,
    detail: skippedFinished ? `${skippedFinished} partido(s) ya terminados, omitidos` : null,
  });

  const note = skippedFinished
    ? ` (${skippedFinished} ya terminado(s), omitido(s))`
    : '';
  return redirect('/admin?msg=' + encodeURIComponent(
    `Pronóstico de ${target?.username ?? 'jugador'} validado: ${toInsert.length} partido(s)${note}`));
};
