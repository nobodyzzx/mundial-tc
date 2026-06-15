/**
 * GET /api/cron/jornada-abierta
 *
 * Anuncia por WhatsApp que la jornada del día ABRIÓ: ya se pueden cargar los
 * pronósticos (scores) de los partidos habilitados para ese día. Es el
 * complemento de jornada-reminder (apertura vs. cierre).
 *
 * Clave: NO anuncia por hora ni por una ventana arbitraria, sino cuando la
 * jornada está realmente ABIERTA según la MISMA máquina de estados que usan
 * /predictions y el dashboard (jornadaLockState). Es decir, solo envía cuando:
 *   - la jornada PREVIA ya está resuelta (no hay partido anterior sin terminar)
 *   - la jornada nueva todavía NO cierra (faltan >2h para el primer partido)
 *   - ningún partido del día empezó / está en curso
 * Si el estado es 'closed' | 'prevPending' | 'ongoingLock' → NO envía. Así se
 * evita el caso de hoy: anunciar "abierta" cuando en realidad seguía bloqueada
 * porque el partido de medianoche anterior aún figuraba sin terminar.
 *
 * Llamar desde cron-job.org cada ~30–60 min con ?secret=CRON_SECRET o header
 * Authorization: Bearer CRON_SECRET. Idempotente: registra el envío en
 * sync_logs (source 'jornada-abierta', endpoint = fecha del día) y no repite.
 *
 * ?preview=1 → arma el mensaje y lo devuelve SIN validar estado/idempotencia
 * ni enviarlo (para ver cómo quedaría).
 */
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@/lib/supabase';
import { spanishName, teamFlag } from '@/lib/isoFlags';
import {
  boliviaDayStart,
  JORNADA_CLOSE_MS,
  jornadaLockState,
  countsUnresolved,
} from '@/lib/jornada';
import { betaNowMs } from '@/lib/betaTime';
import { fmtFecha, fmtDiaKey } from '@/lib/fechas';
import { checkCronSecret, json } from '@/lib/cron';
import { sendWhatsApp } from '@/lib/whatsapp';

const fmtTime = (iso: string | number) =>
  fmtFecha(iso, { hour: '2-digit', minute: '2-digit' });

export const GET: APIRoute = async ({ url, request }) => {
  if (!(await checkCronSecret(url, request))) return json({ error: 'Unauthorized' }, 401);

  const preview = url.searchParams.get('preview') === '1';
  const nowMs = betaNowMs();
  const nowIso = new Date(nowMs).toISOString();

  // 1. Próximo partido no terminado → define el día candidato.
  const { data: nextRows } = await supabaseAdmin
    .from('matches')
    .select('match_date')
    .eq('is_finished', false)
    .gt('match_date', nowIso)
    .order('match_date', { ascending: true })
    .limit(1);

  const firstUpcoming = nextRows?.[0];
  if (!firstUpcoming) return json({ skipped: true, reason: 'Sin partidos próximos' });

  // 2. Todos los partidos de ese día Bolivia (frontera 03:00 BOT).
  const dayStart = boliviaDayStart(new Date(firstUpcoming.match_date).getTime());
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

  const { data: dayMatches } = await supabaseAdmin
    .from('matches')
    .select('id, home_team, away_team, match_date, is_finished')
    .gte('match_date', dayStart.toISOString())
    .lt('match_date', dayEnd.toISOString())
    .order('match_date', { ascending: true });

  if (!dayMatches?.length) return json({ skipped: true, reason: 'Sin partidos en el día' });

  const firstMatchMs = Math.min(...dayMatches.map(m => new Date(m.match_date).getTime()));
  const cutoffMs = firstMatchMs - JORNADA_CLOSE_MS;
  const dayKey = fmtDiaKey(firstMatchMs);
  const dayLabel = fmtFecha(dayStart, { weekday: 'long', day: 'numeric', month: 'long' });

  // 3. Estado de bloqueo con la MISMA lógica que las páginas (fuente única).
  //    sameDayStarted / hasMatchInProgress se calculan sobre los partidos del día;
  //    hasEarlierUnfinished mira si quedó algún partido ANTERIOR sin resolver
  //    (la "jornada previa cerrada" que pide la validación). countsUnresolved
  //    acota por tiempo: un partido viejo sin sync ya no congela la jornada.
  const sameDayStarted = dayMatches.some(m => new Date(m.match_date).getTime() <= nowMs);
  const hasMatchInProgress = dayMatches.some(
    m => !m.is_finished && new Date(m.match_date).getTime() <= nowMs
      && countsUnresolved(new Date(m.match_date).getTime(), nowMs),
  );

  const { data: earlierRows } = await supabaseAdmin
    .from('matches')
    .select('match_date')
    .eq('is_finished', false)
    .lt('match_date', new Date(firstMatchMs).toISOString());
  const hasEarlierUnfinished = (earlierRows ?? []).some(
    m => countsUnresolved(new Date(m.match_date).getTime(), nowMs),
  );

  const state = jornadaLockState({
    firstMatchMs,
    nowMs,
    sameDayStarted,
    hasMatchInProgress,
    hasEarlierUnfinished,
  });

  if (!preview) {
    // 4. Solo se anuncia si la jornada está REALMENTE abierta.
    if (state !== 'open') {
      return json({ skipped: true, reason: `Jornada no abierta (${state})`, dayKey });
    }

    // 5. Orden de mensajes: la apertura va DESPUÉS del cierre del día anterior.
    //    Si el día anterior YA terminó (todos finished) pero su resumen aún no
    //    salió, esperar un tick para que el orden sea cierre→apertura. Si el día
    //    anterior NO está completo (lag/pospuesto), no se exige el resumen: el
    //    candado por tiempo ya decidió 'open' y no hay que bloquear la apertura.
    const { data: prevRows } = await supabaseAdmin
      .from('matches')
      .select('match_date')
      .lt('match_date', new Date(firstMatchMs).toISOString())
      .order('match_date', { ascending: false })
      .limit(1);
    const prevLast = prevRows?.[0];
    if (prevLast) {
      const prevStart = boliviaDayStart(new Date(prevLast.match_date).getTime());
      const prevEnd = new Date(prevStart.getTime() + 24 * 3600 * 1000);
      const { data: prevMatches } = await supabaseAdmin
        .from('matches')
        .select('match_date, is_finished')
        .gte('match_date', prevStart.toISOString())
        .lt('match_date', prevEnd.toISOString());
      const prevAllFinished = !!prevMatches?.length && prevMatches.every(m => m.is_finished);
      if (prevAllFinished) {
        const prevKey = fmtDiaKey(Math.min(...prevMatches.map(m => new Date(m.match_date).getTime())));
        const { data: prevResumen } = await supabaseAdmin
          .from('sync_logs')
          .select('id')
          .eq('source', 'resumen-dia')
          .eq('endpoint', prevKey)
          .is('error', null)
          .limit(1);
        if (!prevResumen?.length) {
          return json({ skipped: true, reason: 'Espera el resumen del día anterior', prevKey });
        }
      }
    }

    // 6. Idempotencia: un solo anuncio por día.
    const { data: alreadySent } = await supabaseAdmin
      .from('sync_logs')
      .select('id')
      .eq('source', 'jornada-abierta')
      .eq('endpoint', dayKey)
      .is('error', null)
      .limit(1);
    if (alreadySent?.length) return json({ skipped: true, reason: 'Ya anunciada esta jornada', dayKey });
  }

  // 6. Construir mensaje.
  const matchLines = dayMatches.map(m =>
    `${teamFlag(m.home_team)} ${spanishName(m.home_team)} vs ${spanishName(m.away_team)} ${teamFlag(m.away_team)} — ${fmtTime(m.match_date)}`,
  );

  const text = [
    `🟢 *JORNADA ABIERTA · ${dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1)}*`,
    '_Ya puedes cargar tus pronósticos_ ✍️',
    '',
    '📋 *Partidos de la jornada:*',
    ...matchLines,
    '',
    `⏰ Cierran a las *${fmtTime(cutoffMs)}* (2h antes del primer partido)`,
    '👉 mundial.tecnocondor.dev/predictions',
    '_Polla Mundial 2026_ 🏆',
  ].join('\n');

  if (preview) {
    return json({
      preview: true,
      dayKey,
      state,
      cutoff: new Date(cutoffMs).toISOString(),
      matches: dayMatches.length,
      text,
    });
  }

  // 7. Enviar.
  const res = await sendWhatsApp(text, 'jornada-abierta');
  if (!res.configured) return json({ error: res.detail }, 500);

  await supabaseAdmin.from('sync_logs').insert({
    source: 'jornada-abierta',
    endpoint: dayKey,
    response_status: res.ok ? 200 : 502,
    matches_updated: 0,
    error: res.ok ? null : `Green API: ${res.detail}`.slice(0, 500),
  });

  if (!res.ok) return json({ error: 'Green API error', detail: res.detail }, 502);
  return json({ ok: true, dayKey, matches: dayMatches.length });
};
