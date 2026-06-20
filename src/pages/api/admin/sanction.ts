import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getAdminUser } from '@/lib/auth-helpers';
import { boliviaDayStart } from '@/lib/jornada';
import { sendWhatsApp } from '@/lib/whatsapp';
import { mdToWhatsApp } from '@/lib/markdown';

const MAX_REASON_LENGTH = 2000;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  const form = await request.formData();
  const userId = form.get('userId')?.toString();
  const type = form.get('type')?.toString();
  const rawReason =
    form.get('reason')?.toString().trim() || 'Advertencia del réferi';
  const reason = rawReason.slice(0, MAX_REASON_LENGTH);
  const notify = form.get('notify')?.toString() === 'on'; // ¿publicar en el grupo?

  // Página a la que volver (evita open-redirect: solo rutas internas de admin).
  const backRaw = form.get('back')?.toString() ?? '/admin';
  const back = backRaw.startsWith('/admin') ? backRaw : '/admin';

  if (!userId || !type) return redirect(`${back}?err=Datos+incompletos`);
  if (!['yellow', 'red', 'double_red'].includes(type))
    return redirect(`${back}?err=Tipo+de+sanción+no+válido`);
  if (rawReason.length > MAX_REASON_LENGTH)
    return redirect(`${back}?err=El+motivo+no+puede+superar+2000+caracteres`);

  // Día de juego al que se imputa la tarjeta. Por defecto HOY (comportamiento de
  // siempre); el réferi puede elegir un día anterior. Se normaliza a la frontera
  // 03:00 BOT y se rechaza un día futuro (sus puntos aún no existen).
  const todayStart = boliviaDayStart(Date.now());
  const rawGameDay = parseInt(form.get('gameDay')?.toString() ?? '');
  const gameDay = Number.isFinite(rawGameDay)
    ? boliviaDayStart(rawGameDay)
    : todayStart;
  if (gameDay.getTime() > todayStart.getTime())
    return redirect(`${back}?err=No+se+puede+sancionar+un+día+futuro`);

  // Prevenir sanciones redundantes. Una expulsión (doble roja) activa cierra todo.
  // Para una ROJA solo se bloquea si ya hay otra roja activa PARA EL MISMO DÍA de
  // juego (anular dos veces la misma jornada no tiene sentido); rojas de días
  // DISTINTOS sí se permiten — sanciones atrasadas en jornadas diferentes.
  if (type === 'red' || type === 'double_red') {
    const { data: activeRed } = await supabaseAdmin
      .from('sanctions')
      .select('id, type, game_day, created_at')
      .eq('user_id', userId)
      .in('type', ['red', 'double_red'])
      .eq('active', true);

    const expelled = (activeRed ?? []).some((s) => s.type === 'double_red');
    if (expelled)
      return redirect(`${back}?err=${encodeURIComponent('El usuario ya está expulsado')}`);

    if (type === 'red') {
      // Día imputado de cada roja activa: game_day si existe; si no (tarjetas
      // viejas), se deriva de created_at con la misma frontera 03:00 BOT.
      const sameDay = (activeRed ?? []).some((s) => {
        const ref = s.game_day
          ? boliviaDayStart(new Date(s.game_day).getTime()).getTime()
          : boliviaDayStart(new Date(s.created_at).getTime()).getTime();
        return ref === gameDay.getTime();
      });
      if (sameDay)
        return redirect(`${back}?err=${encodeURIComponent('El usuario ya tiene una roja activa para ese día')}`);
    }
  }

  // Registrar sanción (game_day = día de juego imputado, hoy o uno anterior).
  await supabaseAdmin.from('sanctions').insert({
    user_id: userId,
    type,
    reason,
    created_by: admin.user.id,
    active: true,
    game_day: gameDay.toISOString(),
  });

  // ROJA o DOBLE ROJA: anular puntos del DÍA de juego imputado (frontera 03:00
  // BOT, igual que calculate_match_points y el cierre de jornada).
  if (type === 'red' || type === 'double_red') {
    const dayStart = gameDay;
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

    const { data: dayMatches } = await supabaseAdmin
      .from('matches')
      .select('id')
      .gte('match_date', dayStart.toISOString())
      .lt('match_date', dayEnd.toISOString());
    const matchIds = dayMatches?.map((m) => m.id) ?? [];

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

      const total =
        allPoints?.reduce((sum, p) => sum + (p.points_earned ?? 0), 0) ?? 0;
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

  const typeLabel =
    type === 'yellow'
      ? 'Amarilla'
      : type === 'red'
        ? 'Roja (jornada anulada)'
        : 'Doble Roja (expulsado permanentemente)';

  // Publicar en el grupo de WhatsApp (opcional). Nunca rompe el flujo de la sanción.
  let notifyNote = '';
  if (notify) {
    try {
      const { data: prof } = await supabaseAdmin
        .from('profiles')
        .select('username')
        .eq('id', userId)
        .single();
      const nombre = prof?.username ?? 'Jugador';
      const head =
        type === 'yellow'
          ? '**🟨 TARJETA AMARILLA**'
          : type === 'red'
            ? '**🟥 TARJETA ROJA**'
            : '**🟥🟥 DOBLE ROJA · EXPULSIÓN**';
      const consecuencia =
        type === 'red'
          ? '_⚠️ Jornada anulada: 0 puntos._'
          : type === 'double_red'
            ? '_⛔ Expulsión definitiva, sin devolución._'
            : '_Advertencia. Se limpia al cerrar la jornada._';

      // Cuerpo en markdown (se renderiza en el tablón y se convierte para WhatsApp)
      const cardMd = [
        head,
        `👤 **${nombre}**`,
        `📝 ${reason}`,
        '',
        consecuencia,
      ].join('\n');

      const text = [
        mdToWhatsApp(cardMd),
        '',
        `— ${admin.username}, la Réferi ⚖️`,
        '_Polla Mundial 2026_ 🏆',
      ].join('\n');
      const res = await sendWhatsApp(text, 'sanction-card');
      notifyNote = !res.configured
        ? ' (WhatsApp no configurado)'
        : res.ok
          ? ' y enviada al grupo'
          : ' (no se pudo enviar al grupo)';

      // También dejarla en el tablón de la app, en markdown (sin firma/pie:
      // el tablón ya muestra al réferi como autor).
      await supabaseAdmin.from('announcements').insert({
        body: cardMd,
        author_name: admin.username,
        created_by: admin.user.id,
        sent_to_whatsapp: res.ok,
        wa_detail: res.detail ?? null,
      });
    } catch {
      notifyNote = ' (no se pudo enviar al grupo)';
    }
  }

  return redirect(
    `${back}?msg=${encodeURIComponent('Sanción aplicada: ' + typeLabel + notifyNote)}`,
  );
};
