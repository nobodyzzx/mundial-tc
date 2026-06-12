/**
 * Empareja partidos del proveedor (ApiMatch) con filas de la BD.
 *
 * - football-data: por external_id (cada partido de la BD guarda el id del proveedor).
 * - api-football: por hora de inicio (UTC, al minuto). El plan free solo da una
 *   ventana móvil de ~3 días, así que no se puede pre-mapear el torneo; se empareja
 *   al vuelo. Si dos partidos comparten exactamente la misma hora (última fecha de
 *   grupos), se desempata por equipos (con normalización de nombres entre proveedores).
 */
import type { ApiMatch } from './match-types';

export interface DbMatchRow {
  id: string;
  external_id: number | null;
  match_date: string;
  home_team: string;
  away_team: string;
}

// Nombres difieren entre proveedores; se mapean a una forma canónica.
const ALIAS: Record<string, string> = {
  usa: 'unitedstates',
  unitedstatesofamerica: 'unitedstates',
  czechrepublic: 'czechia',
  korearepublic: 'southkorea',
  korea: 'southkorea',
  cotedivoire: 'ivorycoast',
  capeverdeislands: 'capeverde',
  drcongo: 'congodr',
  democraticrepublicofcongo: 'congodr',
  turkiye: 'turkey',
  bosniaandherzegovina: 'bosniaherzegovina',
};

function normTeam(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/[^a-z]/g, '');         // deja solo letras
  return ALIAS[base] ?? base;
}

function teamKey(home: string, away: string): string {
  return [normTeam(home), normTeam(away)].sort().join('|');
}

/** Placeholder de bracket (ej. "2A", "W74", "3ABCDF", "TBD"): no tiene minúsculas. */
export function isPlaceholderName(name: string): boolean {
  return !/[a-z]/.test(name);
}

function epochMinute(iso: string): number {
  return Math.floor(Date.parse(iso) / 60000);
}

/** Devuelve Map<ApiMatch, dbMatchId> con los emparejamientos resueltos. */
export function linkMatches(
  apiMatches: ApiMatch[],
  dbMatches: DbMatchRow[],
  provider: string,
): Map<ApiMatch, string> {
  const out = new Map<ApiMatch, string>();

  if (provider === 'api-football') {
    const byMinute = new Map<number, DbMatchRow[]>();
    for (const db of dbMatches) {
      const m = epochMinute(db.match_date);
      const arr = byMinute.get(m) ?? [];
      arr.push(db);
      byMinute.set(m, arr);
    }
    for (const am of apiMatches) {
      const cands = byMinute.get(epochMinute(am.utcDate)) ?? [];
      if (cands.length === 1) {
        out.set(am, cands[0].id);
      } else if (cands.length > 1) {
        const target = teamKey(am.homeTeam.name, am.awayTeam.name);
        const hit = cands.find((c) => teamKey(c.home_team, c.away_team) === target);
        if (hit) out.set(am, hit.id);
      }
    }
  } else {
    const byExt = new Map<number, string>();
    for (const db of dbMatches) if (db.external_id != null) byExt.set(db.external_id, db.id);
    for (const am of apiMatches) {
      const id = byExt.get(am.id);
      if (id) out.set(am, id);
    }
  }

  return out;
}
