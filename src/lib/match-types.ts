/**
 * Forma normalizada de un partido, independiente del proveedor de datos.
 * Históricamente es la forma de football-data.org v4; cada proveedor mapea su
 * respuesta a este tipo para que sync/import/scoring no dependan del proveedor.
 */
/** Un gol dentro de un partido, en orden cronológico (para avisos en vivo). */
export interface GoalEvent {
  side: 'home' | 'away';   // lado al que se le suma el gol (en autogol, el beneficiado)
  scorer: string | null;   // nombre del goleador (o autor del autogol)
  minute: string | null;   // minuto tal como lo da el proveedor, ej. "23'", "90'+2'"
  penalty: boolean;
  ownGoal: boolean;
}

export interface ApiMatch {
  id: number;
  utcDate: string;
  status: 'SCHEDULED' | 'TIMED' | 'IN_PLAY' | 'PAUSED' | 'FINISHED' | 'AWARDED' | 'CANCELLED' | 'SUSPENDED' | 'POSTPONED';
  stage: string;   // GROUP_STAGE, LAST_32, LAST_16, QUARTER_FINALS, SEMI_FINALS, THIRD_PLACE, FINAL
  group: string | null;    // GROUP_A … GROUP_L | null
  matchday: number | null;
  minute?: number | null;   // solo presente en partidos LIVE
  goals?: GoalEvent[];       // goles en orden (solo proveedores que los exponen, ej. ESPN)
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
