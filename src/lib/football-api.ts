const BASE = 'https://api.football-data.org/v4';

async function apiFetch(path: string) {
  const key = import.meta.env.FOOTBALL_API_KEY;
  if (!key) throw new Error('FOOTBALL_API_KEY no configurada');

  const res = await fetch(`${BASE}${path}`, {
    headers: { 'X-Auth-Token': key },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

// ── Tipos ────────────────────────────────────────────────────────
export interface ApiMatch {
  id: number;
  utcDate: string;
  status: 'SCHEDULED' | 'TIMED' | 'IN_PLAY' | 'PAUSED' | 'FINISHED' | 'AWARDED' | 'CANCELLED' | 'SUSPENDED' | 'POSTPONED';
  stage: string;   // GROUP_STAGE, LAST_32, LAST_16, QUARTER_FINALS, SEMI_FINALS, THIRD_PLACE, FINAL
  group: string | null;    // GROUP_A … GROUP_L | null
  matchday: number | null;
  minute?: number | null;   // solo presente en partidos LIVE
  homeTeam: { name: string };
  awayTeam: { name: string };
  score: {
    winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null;
    duration: 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT';
    fullTime: { home: number | null; away: number | null };
    halfTime?: { home: number | null; away: number | null };
    penalties: { home: number | null; away: number | null };
  };
}

// ── Queries ──────────────────────────────────────────────────────
export async function getFixtures(code: string, season: number): Promise<ApiMatch[]> {
  const data = await apiFetch(`/competitions/${code}/matches?season=${season}`);
  return data.matches ?? [];
}

export async function getFinishedMatches(code: string, season: number): Promise<ApiMatch[]> {
  const data = await apiFetch(`/competitions/${code}/matches?season=${season}&status=FINISHED`);
  return data.matches ?? [];
}

// IN_PLAY (jugando) + PAUSED (medio tiempo). Es 1 sola llamada — la API acepta
// múltiples valores separados por coma.
export async function getLiveMatches(code: string, season: number): Promise<ApiMatch[]> {
  const data = await apiFetch(`/competitions/${code}/matches?season=${season}&status=IN_PLAY,PAUSED`);
  return data.matches ?? [];
}

// ── Mapeo al esquema de la app ───────────────────────────────────
// Stages que se tratan como "fase de grupos" (antes del cuadro eliminatorio)
const GROUP_STAGES = new Set(['GROUP_STAGE', 'LEAGUE_STAGE', 'LEAGUE_PHASE']);

export function mapStage(stage: string): 'group' | 'knockout' {
  return GROUP_STAGES.has(stage) ? 'group' : 'knockout';
}

export function mapGroupName(group: string | null): string | null {
  if (!group) return null;
  // "GROUP_A" → "A"
  return group.replace(/^GROUP_/i, '').trim() || null;
}

const ROUND_MAP: Record<string, string> = {
  LAST_32:         'R32',
  LAST_16:         'R16',
  QUARTER_FINALS:  'Cuartos',
  SEMI_FINALS:     'Semifinal',
  THIRD_PLACE:     'Tercer Puesto',
  FINAL:           'Final',
  PLAYOFFS:        'Playoffs',
  PLAYOFF_ROUND_1: 'Playoffs',
  PLAYOFF_ROUND_2: 'Playoffs',
};

export function mapRound(stage: string): string | null {
  return ROUND_MAP[stage] ?? stage;
}

export function mapJornada(stage: string, matchday: number | null): string | null {
  if (GROUP_STAGES.has(stage)) return `Jornada ${matchday ?? 1}`;
  return mapRound(stage);
}

export function deriveWinnerPenalties(
  score: ApiMatch['score'],
): 'home' | 'away' | null {
  if (score.duration !== 'PENALTY_SHOOTOUT') return null;
  const { home, away } = score.penalties;
  if (home === null || away === null) return null;
  return home > away ? 'home' : 'away';
}
