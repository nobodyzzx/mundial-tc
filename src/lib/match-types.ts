/**
 * Forma normalizada de un partido, independiente del proveedor de datos.
 * Históricamente es la forma de football-data.org v4; cada proveedor mapea su
 * respuesta a este tipo para que sync/import/scoring no dependan del proveedor.
 */
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
    penalties?: { home: number | null; away: number | null };
  };
}
