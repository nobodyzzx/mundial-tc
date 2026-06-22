/**
 * GET /api/cron/resumen-dia
 *
 * Al terminar TODOS los partidos de un día (zona Bolivia), postea al grupo de
 * WhatsApp el resumen del día (resultados) + la tabla de posiciones final.
 *
 * Llamar desde cron-job.org cada ~15 min con ?secret=CRON_SECRET o header
 * Authorization: Bearer CRON_SECRET. Idempotente: registra el envío en sync_logs
 * (source 'resumen-dia', endpoint = clave del día) y no repite. Solo considera
 * días recientes para no anunciar el historial.
 *
 * ?preview=1 → arma el mensaje y lo devuelve SIN idempotencia ni envío.
 */
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@/lib/supabase';
import { spanishName, teamFlag } from '@/lib/isoFlags';
import { boliviaDayStart } from '@/lib/jornada';
import { betaNowMs } from '@/lib/betaTime';
import { fmtFecha, fmtDiaKey } from '@/lib/fechas';
import { checkCronSecret, json } from '@/lib/cron';
import { sendWhatsApp } from '@/lib/whatsapp';

// Solo días cuyo último partido empezó dentro de esta ventana (evita anunciar
// historial en el primer despliegue). Holgada (30h) a propósito: el resumen es
// el mensaje "must-have" y es idempotente por día, así que sobrevive a un retraso
// largo de sync o a un tick de cron perdido sin perder el resumen del día.
const RECENT_WINDOW_MS = 30 * 3600 * 1000;

export const GET: APIRoute = async ({ url, request }) => {
  if (!(await checkCronSecret(url, request))) return json({ error: 'Unauthorized' }, 401);

  const preview = url.searchParams.get('preview') === '1';
  const nowMs = betaNowMs();
  const sinceIso = new Date(nowMs - RECENT_WINDOW_MS).toISOString();

  // 1. Último partido terminado reciente → define el día candidato.
  const { data: lastRows } = await supabaseAdmin
    .from('matches')
    .select('match_date')
    .eq('is_finished', true)
    .gte('match_date', sinceIso)
    .order('match_date', { ascending: false })
    .limit(1);

  const lastFinished = lastRows?.[0];
  if (!lastFinished) return json({ skipped: true, reason: 'Sin partidos terminados recientes' });

  // 2. Todos los partidos de ese día Bolivia.
  const dayStart = boliviaDayStart(new Date(lastFinished.match_date).getTime());
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

  const { data: dayMatches } = await supabaseAdmin
    .from('matches')
    .select('id, home_team, away_team, home_score, away_score, home_pen, away_pen, winner_penalties, is_finished, match_date')
    .gte('match_date', dayStart.toISOString())
    .lt('match_date', dayEnd.toISOString())
    .order('match_date', { ascending: true });

  if (!dayMatches?.length) return json({ skipped: true, reason: 'Sin partidos en el día' });

  // 3. El día solo se cierra cuando TODOS sus partidos terminaron.
  if (dayMatches.some(m => !m.is_finished)) {
    return json({ skipped: true, reason: 'El día aún no termina', pendientes: dayMatches.filter(m => !m.is_finished).length });
  }

  const firstTime = Math.min(...dayMatches.map(m => new Date(m.match_date).getTime()));
  const dayKey = fmtDiaKey(firstTime);
  const dayLabel = fmtFecha(dayStart, { weekday: 'long', day: 'numeric', month: 'long' });

  // 4. Orden de mensajes: el resumen del día va DESPUÉS del marcador del último
  //    partido (standings-announce). Si ese último partido aún no se anunció y su
  //    ventana de 8h sigue vigente, esperar un tick. Pasada la ventana NO se exige
  //    (el resumen es el respaldo y debe salir igual aunque standings se la pierda).
  const STANDINGS_WINDOW_MS = 8 * 3600 * 1000;
  const lastMatch = dayMatches[dayMatches.length - 1]; // orden ascendente → el más tardío
  const lastKickoffMs = new Date(lastMatch.match_date).getTime();

  // 5. Idempotencia.
  if (!preview) {
    if (nowMs - lastKickoffMs < STANDINGS_WINDOW_MS) {
      const { data: lastAnnounced } = await supabaseAdmin
        .from('sync_logs')
        .select('id')
        .eq('source', 'standings-announce')
        .eq('endpoint', lastMatch.id)
        .is('error', null)
        .limit(1);
      if (!lastAnnounced?.length) {
        return json({ skipped: true, reason: 'Espera el marcador del último partido', lastMatchId: lastMatch.id });
      }
    }

    const { data: alreadySent } = await supabaseAdmin
      .from('sync_logs')
      .select('id')
      .eq('source', 'resumen-dia')
      .eq('endpoint', dayKey)
      .is('error', null)
      .limit(1);
    if (alreadySent?.length) return json({ skipped: true, reason: 'Ya enviado para este día', dayKey });

    // Asegurar puntos calculados (idempotente) antes de leer la tabla.
    for (const m of dayMatches) {
      await supabaseAdmin.rpc('calculate_match_points_safe', { p_match_id: m.id });
    }
  }

  // 5. Tabla general (acumulado) + puntos ganados en el día por usuario.
  const { data: standings } = await supabaseAdmin
    .from('profiles')
    .select('id, username, puntos_totales')
    .eq('participa', true)
    .eq('expulsado', false)
    .order('puntos_totales', { ascending: false });

  const dayIds = dayMatches.map(m => m.id);
  const { data: dayPreds } = await supabaseAdmin
    .from('predictions')
    .select('user_id, points_earned')
    .in('match_id', dayIds);

  const dayPts = new Map<string, number>();
  for (const pr of dayPreds ?? []) {
    dayPts.set(pr.user_id, (dayPts.get(pr.user_id) ?? 0) + (pr.points_earned ?? 0));
  }

  // Tarjetas que afectan a ESTE día Bolivia. Una tarjeta retroactiva se registra
  // otro día (created_at) pero castiga la jornada de game_day: se atribuye por
  // game_day, igual que calculate_match_points (COALESCE(game_day, created_at)).
  const { data: allCards } = await supabaseAdmin
    .from('sanctions')
    .select('type, user_id, created_at, game_day')
    .eq('active', true)
    .order('created_at', { ascending: true });
  const inDay = (c: { game_day: string | null; created_at: string }) => {
    const eff = new Date(c.game_day ?? c.created_at).getTime();
    return eff >= dayStart.getTime() && eff < dayEnd.getTime();
  };
  const dayCards = (allCards ?? []).filter(inDay);

  let cardNames = new Map<string, string>();
  if (dayCards?.length) {
    const ids = [...new Set(dayCards.map(c => c.user_id))];
    const { data: cardProfiles } = await supabaseAdmin
      .from('profiles')
      .select('id, username')
      .in('id', ids);
    cardNames = new Map((cardProfiles ?? []).map(p => [p.id, p.username]));
  }
  const cardLines = (dayCards ?? []).map(c => {
    const name = cardNames.get(c.user_id) ?? '—';
    if (c.type === 'yellow') return `🟨 ${name}`;
    if (c.type === 'red') return `🟥 ${name} — jornada anulada`;
    return `🟥🟥 ${name} — expulsado`;
  });

  // ¿Hay próxima jornada? La página de pronósticos se abre apenas se resuelve el
  // día actual, así que si quedan partidos por jugar ya se puede cargar la
  // siguiente. Si el torneo terminó, no se invita a pronosticar.
  const { data: upcoming } = await supabaseAdmin
    .from('matches')
    .select('id')
    .eq('is_finished', false)
    .gt('match_date', new Date(nowMs).toISOString())
    .limit(1);
  const hayProxima = !!upcoming?.length;

  // 6. Construir mensaje.
  const resultLines = dayMatches.map(m => {
    let s = `${spanishName(m.home_team)} ${teamFlag(m.home_team)} ${m.home_score}–${m.away_score} ${teamFlag(m.away_team)} ${spanishName(m.away_team)}`;
    if (m.winner_penalties) {
      const w = m.winner_penalties === 'home' ? spanishName(m.home_team) : spanishName(m.away_team);
      const pen = (m.home_pen != null && m.away_pen != null) ? `${m.home_pen}–${m.away_pen} pen · ` : '';
      s += ` _(${pen}clasifica ${w})_`;
    }
    return `  ${s}`;
  });

  // Tabla general (acumulado) con los puntos ganados HOY al lado.
  const topGained = Math.max(0, ...(standings ?? []).map(p => dayPts.get(p.id) ?? 0));
  const tableLines = (standings ?? []).map((p, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    const gained = dayPts.get(p.id) ?? 0;
    // ⭐ al que más ganó hoy (si ganó algo); 💀 a quien no sumó nada.
    const mark = gained === 0 ? ' 💀' : gained === topGained ? ' ⭐' : '';
    return `${medal} ${p.username} — ${p.puntos_totales} pts _(+${gained} hoy)_${mark}`;
  });

  const text = [
    `🏁 *FIN DEL DÍA · ${dayLabel}*`,
    '',
    '⚽ *Resultados*',
    ...resultLines,
    '',
    '📊 *TABLA GENERAL* _(+ puntos de hoy)_',
    ...tableLines,
    ...(cardLines.length ? ['', '🟨🟥 *Tarjetas de hoy*', ...cardLines] : []),
    ...(hayProxima ? ['', '✍️ _¡La próxima jornada ya está abierta! No olvides cargar tus pronósticos._'] : []),
    '',
    '👉 mundial.tecnocondor.dev/pronosticos',
    '_Polla Mundial 2026_ 🏆',
  ].join('\n');

  if (preview) {
    return json({ preview: true, dayKey, matches: dayMatches.length, text });
  }

  // 7. Enviar.
  const res = await sendWhatsApp(text, 'resumen-dia');
  if (!res.configured) return json({ error: res.detail }, 500);

  await supabaseAdmin.from('sync_logs').insert({
    source: 'resumen-dia',
    endpoint: dayKey,
    response_status: res.ok ? 200 : 502,
    matches_updated: 0,
    error: res.ok ? null : `Green API: ${res.detail}`.slice(0, 500),
  });

  if (!res.ok) return json({ error: 'Green API error', detail: res.detail }, 502);
  return json({ ok: true, dayKey, matches: dayMatches.length });
};
