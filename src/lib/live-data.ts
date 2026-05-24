import { supabaseAdmin } from '@/lib/supabase';
import { spanishName, teamFlag } from '@/lib/isoFlags';

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
  };
}

export async function getLiveData(): Promise<LiveData> {
  const nowIso = new Date().toISOString();

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

  return {
    live: (liveRes.data ?? []).map(toLive),
    // Un partido en vivo puede tener match_date > now si la API lo adelantó; lo excluimos de upcoming.
    upcoming: (upcomingRes.data ?? []).filter((m: any) => !liveIds.has(m.id)).map(toLive),
    recent: (recentRes.data ?? []).map(toLive),
    fetchedAt: nowIso,
  };
}
