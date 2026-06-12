import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { isValidUUID } from '@/lib/auth-helpers';
import { boliviaDayStart, isCutoffPassed } from '@/lib/jornada';
import { logEvent } from '@/lib/system-log';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const accessToken = cookies.get('sb-access-token')?.value;
  const refreshToken = cookies.get('sb-refresh-token')?.value;
  if (!accessToken || !refreshToken) return redirect('/login');

  // Parsear form y auth en paralelo
  const [formData, { data: { user } }] = await Promise.all([
    request.formData(),
    supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }),
  ]);
  if (!user) return redirect('/login');

  const { data: profile } = await supabase.from('profiles').select('username, pago_70, pago_50, expulsado').eq('id', user.id).single();

  // ── Registro de intentos RECHAZADOS ─────────────────────────────────────────
  // Deja huella en BD de cada envío rechazado (motivo + lo que intentó enviar),
  // para resolver disputas "yo sí pronostiqué y no me lo tomó". Nunca interrumpe
  // el flujo (best-effort). El detalle se rellena cuando ya se parseó el form.
  let attemptDetail = '';
  const reject = async (reason: string, url: string) => {
    try {
      await supabaseAdmin.from('submit_attempts').insert({
        user_id: user.id,
        username: profile?.username ?? null,
        reason,
        detail: attemptDetail || null,
      });
      // También a la bitácora central.
      await logEvent({
        category: 'pronostico',
        event: `rechazo:${reason}`,
        actor: profile?.username ?? null,
        summary: `${profile?.username ?? '—'} — envío rechazado (${reason})`,
        detail: attemptDetail || null,
      });
    } catch { /* el registro nunca debe romper el envío */ }
    return redirect(url);
  };

  if (import.meta.env.PUBLIC_BETA !== "true" && !(profile?.pago_70 && profile?.pago_50))
    return reject('no-pagado', '/predictions');
  if (profile?.expulsado)
    return reject('expulsado', `/predictions?error=${encodeURIComponent('Estás expulsado: no puedes pronosticar')}`);

  // Leer entradas del form
  const entries: {
    matchId: string;
    userHome: number;
    userAway: number;
    userHomePen: number | null;
    userAwayPen: number | null;
    userWinnerPenalties: string | null;
  }[] = [];

  let i = 0;
  while (formData.has(`matchId_${i}`)) {
    const matchId = formData.get(`matchId_${i}`)?.toString() ?? '';
    const userHome = parseInt(formData.get(`home_${i}`)?.toString() ?? '');
    const userAway = parseInt(formData.get(`away_${i}`)?.toString() ?? '');
    const penHomeStr = formData.get(`pen_home_${i}`)?.toString() ?? '';
    const penAwayStr = formData.get(`pen_away_${i}`)?.toString() ?? '';
    const userHomePen = penHomeStr !== '' ? parseInt(penHomeStr) : null;
    const userAwayPen = penAwayStr !== '' ? parseInt(penAwayStr) : null;

    if (!matchId || !isValidUUID(matchId) || isNaN(userHome) || isNaN(userAway)) {
      return reject('form-invalido', '/predictions?error=incompleto');
    }
    if (userHome < 0 || userHome > 20 || userAway < 0 || userAway > 20) {
      return reject('form-invalido', '/predictions?error=incompleto');
    }
    if (userHomePen !== null && (userHomePen < 0 || userHomePen > 20)) {
      return reject('form-invalido', '/predictions?error=incompleto');
    }
    if (userAwayPen !== null && (userAwayPen < 0 || userAwayPen > 20)) {
      return reject('form-invalido', '/predictions?error=incompleto');
    }

    let userWinnerPenalties: string | null = null;
    if (userHomePen !== null && userAwayPen !== null) {
      if (userHomePen > userAwayPen) userWinnerPenalties = 'home';
      else if (userAwayPen > userHomePen) userWinnerPenalties = 'away';
    }

    entries.push({ matchId, userHome, userAway, userHomePen, userAwayPen, userWinnerPenalties });
    i++;
  }

  if (entries.length === 0) return reject('sin-entradas', '/predictions?error=incompleto');

  // Resumen de lo que intentó enviar (para el registro de rechazos).
  attemptDetail = entries
    .map(e => {
      const pen = (e.userHomePen !== null && e.userAwayPen !== null) ? ` (pen ${e.userHomePen}-${e.userAwayPen})` : '';
      return `${e.matchId}:${e.userHome}-${e.userAway}${pen}`;
    })
    .join(' | ');

  // Una sola query trae todos los datos necesarios para validar
  const matchIds = entries.map(e => e.matchId);
  const { data: matchRows } = await supabase
    .from('matches')
    .select('id, match_date, is_finished, stage, status')
    .in('id', matchIds);

  if (!matchRows || matchRows.length === 0) return reject('partidos-no-encontrados', '/predictions');

  const matchIndex = new Map(matchRows.map(m => [m.id, m]));

  // Validar finished / en juego
  for (const m of matchRows) {
    if (m.is_finished) return reject('partido-terminado', `/predictions?error=${encodeURIComponent('El partido ya terminó')}`);
    if (m.status && ['IN_PLAY', 'PAUSED', 'FINISHED'].includes(m.status))
      return reject('partido-en-juego', `/predictions?error=${encodeURIComponent('Las apuestas para este partido ya están cerradas')}`);
  }

  // Validar cierre de jornada: 2h antes del primer partido del día Bolivia (UTC-4)
  const firstTime = Math.min(...matchRows.map(m => new Date(m.match_date).getTime()));
  const dayStart = boliviaDayStart(firstTime);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

  const { data: dayMatches } = await supabase
    .from('matches')
    .select('match_date')
    .gte('match_date', dayStart.toISOString())
    .lt('match_date', dayEnd.toISOString());

  const firstMatchTime = Math.min(...(dayMatches ?? []).map(m => new Date(m.match_date).getTime()));
  if (isCutoffPassed(firstMatchTime, Date.now()))
    return reject('jornada-cerrada', `/predictions?error=${encodeURIComponent('La jornada ya está cerrada')}`);

  // Sanción roja del día Bolivia (frontera 03:00 BOT): jornada anulada, no se pronostica.
  const { data: redCards } = await supabase
    .from('sanctions')
    .select('id')
    .eq('user_id', user.id)
    .in('type', ['red', 'double_red'])
    .eq('active', true)
    .gte('created_at', dayStart.toISOString())
    .lt('created_at', dayEnd.toISOString());
  if (redCards && redCards.length > 0)
    return reject('roja-jornada-anulada', `/predictions?error=${encodeURIComponent('Jornada anulada por tarjeta roja')}`);

  // Validar knockout con empate sin score de penales (usa matchIndex en vez de queries)
  for (const e of entries) {
    const m = matchIndex.get(e.matchId);
    if (m?.stage === 'knockout' && e.userHome === e.userAway &&
        (e.userHomePen === null || e.userAwayPen === null || e.userHomePen === e.userAwayPen)) {
      return reject('knockout-sin-penales', '/predictions?error=Debes+completar+el+score+de+penales+%28sin+empate%29+para+el+partido+eliminatorio');
    }
  }

  // Insertar todos los pronósticos de una vez
  const { error } = await supabase.from('predictions').insert(
    entries.map(e => ({
      user_id: user.id,
      match_id: e.matchId,
      user_home: e.userHome,
      user_away: e.userAway,
      user_home_pen: e.userHomePen,
      user_away_pen: e.userAwayPen,
      user_winner_penalties: e.userWinnerPenalties,
    }))
  );

  if (error) {
    if (error.code === '23505') return reject('ya-pronosticado', '/predictions?info=ya_pronosticado');
    attemptDetail = `${attemptDetail} || db:${error.code ?? ''} ${error.message ?? ''}`.slice(0, 500);
    return reject('error-db', '/predictions?error=' + encodeURIComponent('Error al guardar los pronósticos'));
  }

  return redirect('/predictions?ok=1');
};
