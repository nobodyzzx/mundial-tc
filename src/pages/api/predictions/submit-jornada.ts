import type { APIRoute } from 'astro';
import { supabase } from '@/lib/supabase';
import { isValidUUID } from '@/lib/auth-helpers';
import { boliviaDayStart, isCutoffPassed } from '@/lib/jornada';

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

  const { data: profile } = await supabase.from('profiles').select('pago_70, pago_50').eq('id', user.id).single();
  if (import.meta.env.PUBLIC_BETA !== "true" && !(profile?.pago_70 && profile?.pago_50)) return redirect('/predictions');

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
      return redirect('/predictions?error=incompleto');
    }

    let userWinnerPenalties: string | null = null;
    if (userHomePen !== null && userAwayPen !== null) {
      if (userHomePen > userAwayPen) userWinnerPenalties = 'home';
      else if (userAwayPen > userHomePen) userWinnerPenalties = 'away';
    }

    entries.push({ matchId, userHome, userAway, userHomePen, userAwayPen, userWinnerPenalties });
    i++;
  }

  if (entries.length === 0) return redirect('/predictions?error=incompleto');

  // Una sola query trae todos los datos necesarios para validar
  const matchIds = entries.map(e => e.matchId);
  const { data: matchRows } = await supabase
    .from('matches')
    .select('id, match_date, is_finished, stage')
    .in('id', matchIds);

  if (!matchRows || matchRows.length === 0) return redirect('/predictions');

  const matchIndex = new Map(matchRows.map(m => [m.id, m]));

  // Validar finished
  for (const m of matchRows) {
    if (m.is_finished) return redirect(`/predictions?error=${encodeURIComponent('El partido ya terminó')}`);
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
    return redirect(`/predictions?error=${encodeURIComponent('La jornada ya está cerrada')}`);

  // Validar knockout con empate sin score de penales (usa matchIndex en vez de queries)
  for (const e of entries) {
    const m = matchIndex.get(e.matchId);
    if (m?.stage === 'knockout' && e.userHome === e.userAway &&
        (e.userHomePen === null || e.userAwayPen === null || e.userHomePen === e.userAwayPen)) {
      return redirect('/predictions?error=Debes+completar+el+score+de+penales+%28sin+empate%29+para+el+partido+eliminatorio');
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
    if (error.code === '23505') return redirect('/predictions?info=ya_pronosticado');
    return redirect('/predictions?error=' + encodeURIComponent('Error al guardar los pronósticos'));
  }

  return redirect('/predictions?ok=1');
};
