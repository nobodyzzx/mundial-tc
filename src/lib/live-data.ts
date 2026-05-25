import { supabaseAdmin } from '@/lib/supabase';
import { spanishName, teamFlag } from '@/lib/isoFlags';
import { betaNowMs } from '@/lib/betaTime';

export interface LiveMatch {
  id: string;
  home: string;
  away: string;
  homeFlag: string;
  awayFlag: string;
  hs: number | null;
  as_: number | null;
  hsHt: number | null;
  asHt: number | null;
  homePen: number | null;
  awayPen: number | null;
  winnerPen: string | null;
  status: string | null;
  minute: number | null;
  date: string;
  label: string;
  // Provisional "si terminara así" — solo poblado para partidos en vivo.
  provTotal: number;   // cuántos pronosticaron este partido
  provExact: number;   // cuántos van por el marcador exacto
  provResult: number;  // cuántos aciertan el resultado (gana/empata)
}

export interface LiveData {
  live: LiveMatch[];
  upcoming: LiveMatch[];
  recent: LiveMatch[];
  fetchedAt: string;
}

const MATCH_COLS =
  'id, home_team, away_team, home_score, away_score, home_pen, away_pen, ' +
  'winner_penalties, score_home_ht, score_away_ht, status, minute, ' +
  'is_finished, stage, group_name, round, jornada, match_date';

function label(m: any): string {
  if (m.stage === 'group') return m.group_name ? `Grupo ${m.group_name}` : (m.jornada ?? '');
  return m.round ?? m.jornada ?? '';
}

function toLive(m: any): LiveMatch {
  return {
    id: m.id,
    home: spanishName(m.home_team),
    away: spanishName(m.away_team),
    homeFlag: teamFlag(m.home_team),
    awayFlag: teamFlag(m.away_team),
    hs: m.home_score,
    as_: m.away_score,
    hsHt: m.score_home_ht,
    asHt: m.score_away_ht,
    homePen: m.home_pen,
    awayPen: m.away_pen,
    winnerPen: m.winner_penalties,
    status: m.status,
    minute: m.minute,
    date: m.match_date,
    label: label(m),
    provTotal: 0,
    provExact: 0,
    provResult: 0,
  };
}

// Pobla los conteos provisionales de cada partido en vivo llamando al RPC.
// Defensivo: si el RPC aún no existe o falla, deja los conteos en 0 (no rompe /live).
async function attachProvisional(matches: LiveMatch[]): Promise<void> {
  await Promise.all(matches.map(async (m) => {
    const { data, error } = await supabaseAdmin.rpc('provisional_match_points', { p_match_id: m.id });
    if (error || !data) return;
    const rows = data as Array<{ is_exact: boolean; is_result: boolean }>;
    m.provTotal = rows.length;
    m.provExact = rows.filter(r => r.is_exact).length;
    m.provResult = rows.filter(r => r.is_result).length;
  }));
}

// Solo partidos en vivo (IN_PLAY/PAUSED). Liviano: 1 query.
// Lo usa el dashboard, que no necesita próximos ni recientes.
export async function getLiveMatches(): Promise<LiveMatch[]> {
  const { data } = await supabaseAdmin.from('matches').select(MATCH_COLS)
    .in('status', ['IN_PLAY', 'PAUSED'])
    .order('match_date', { ascending: true });
  const live = (data ?? []).map(toLive);
  await attachProvisional(live);
  return live;
}

export async function getLiveData(): Promise<LiveData> {
  // betaNow para que en beta los "próximos/recientes" respeten el reloj simulado.
  // En producción betaNow === tiempo real (offset 0), así que no cambia nada.
  const nowIso = new Date(betaNowMs()).toISOString();

  const [liveRes, upcomingRes, recentRes] = await Promise.all([
    supabaseAdmin.from('matches').select(MATCH_COLS)
      .in('status', ['IN_PLAY', 'PAUSED'])
      .order('match_date', { ascending: true }),
    supabaseAdmin.from('matches').select(MATCH_COLS)
      .eq('is_finished', false)
      .gt('match_date', nowIso)
      .order('match_date', { ascending: true })
      .limit(8),
    supabaseAdmin.from('matches').select(MATCH_COLS)
      .eq('is_finished', true)
      .order('match_date', { ascending: false })
      .limit(8),
  ]);

  const liveIds = new Set((liveRes.data ?? []).map((m: any) => m.id));

  const live = (liveRes.data ?? []).map(toLive);
  await attachProvisional(live);

  return {
    live,
    // Un partido en vivo puede tener match_date > now si la API lo adelantó; lo excluimos de upcoming.
    upcoming: (upcomingRes.data ?? []).filter((m: any) => !liveIds.has(m.id)).map(toLive),
    recent: (recentRes.data ?? []).map(toLive),
    fetchedAt: nowIso,
  };
}
