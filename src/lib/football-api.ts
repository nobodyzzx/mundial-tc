/**
 * Facade de datos de partidos. Enruta entre proveedores según MATCH_PROVIDER:
 *   - 'football-data' (por defecto): football-data.org v4 (consulta por temporada).
 *   - 'api-football': API-Football / api-sports.io (consulta por fecha / en vivo).
 *
 * Ambos devuelven ApiMatch (forma normalizada en lib/match-types). El resto de la
 * app (sync, import-fixture, scoring) no sabe qué proveedor está activo.
 */
import type { ApiMatch } from './match-types';
import * as apiFootball from './providers/api-football';

export type { ApiMatch };
export const getLiveMatches = apiFootball.getLiveMatches;

const PROVIDER = (import.meta.env.MATCH_PROVIDER ?? 'football-data').toLowerCase();

// ── Proveedor football-data.org ──────────────────────────────────
const FD_BASE = 'https://api.football-data.org/v4';

async function fdFetch(path: string) {
  const key = import.meta.env.FOOTBALL_API_KEY;
  if (!key) throw new Error('FOOTBALL_API_KEY no configurada');

  const res = await fetch(`${FD_BASE}${path}`, {
    headers: { 'X-Auth-Token': key },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

async function fdGetFixtures(code: string, season: number): Promise<ApiMatch[]> {
  const data = await fdFetch(`/competitions/${code}/matches?season=${season}`);
  return data.matches ?? [];
}

async function fdGetFinishedMatches(code: string, season: number): Promise<ApiMatch[]> {
  const data = await fdFetch(`/competitions/${code}/matches?season=${season}&status=FINISHED`);
  return data.matches ?? [];
}

// ── API pública (enruta por proveedor) ───────────────────────────
export async function getFixtures(code: string, season: number): Promise<ApiMatch[]> {
  if (PROVIDER === 'api-football') return apiFootball.getFixtures();
  return fdGetFixtures(code, season);
}

export async function getFinishedMatches(code: string, season: number): Promise<ApiMatch[]> {
  if (PROVIDER === 'api-football') return apiFootball.getFinishedMatches();
  return fdGetFinishedMatches(code, season);
}

// ── Mapeo al esquema de la app (común a ambos proveedores) ────────
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
  const home = score.penalties?.home ?? null;
  const away = score.penalties?.away ?? null;
  if (home === null || away === null) return null;
  return home > away ? 'home' : 'away';
}
