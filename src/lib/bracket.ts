/**
 * Resolución del cuadro de eliminatorias a partir de las TABLAS de grupo de la BD.
 *
 * No depende del proveedor de marcadores: una vez que un grupo cerró (sus 6 partidos
 * terminados), el ganador y el segundo quedan determinados por la tabla, así que los
 * códigos de posición del bracket ("1A", "2A", …) se pueden traducir a equipos reales
 * sin esperar a que ESPN los pinte (cuyos horarios además no calzan con los sembrados).
 *
 * Desempate: SISTEMA OLÍMPICO → puntos, luego diferencia de goles, luego goles a favor.
 * (Es también el orden primario de FIFA, antes del head-to-head.) Si dos equipos quedan
 * idénticos en los tres criterios, la posición NO se considera resuelta y se reporta como
 * empate sin definir (a resolver a mano: head-to-head / fair play / sorteo).
 */

export interface GroupMatch {
  group_name: string | null;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  is_finished: boolean;
}

export interface TeamRow {
  team: string;
  pj: number;
  gf: number;
  gc: number;
  dg: number;
  pts: number;
}

/** Tabla por grupo, ordenada con desempate olímpico (pts → dg → gf). */
export function computeStandings(matches: GroupMatch[]): Map<string, TeamRow[]> {
  const groupMap = new Map<string, Map<string, TeamRow>>();

  for (const m of matches) {
    const grp = m.group_name ?? '—';
    if (!groupMap.has(grp)) groupMap.set(grp, new Map());
    const table = groupMap.get(grp)!;
    for (const team of [m.home_team, m.away_team])
      if (!table.has(team)) table.set(team, { team, pj: 0, gf: 0, gc: 0, dg: 0, pts: 0 });

    if (!m.is_finished || m.home_score === null || m.away_score === null) continue;
    const home = table.get(m.home_team)!, away = table.get(m.away_team)!;
    const hs = m.home_score, as_ = m.away_score;
    home.pj++; away.pj++;
    home.gf += hs; home.gc += as_;
    away.gf += as_; away.gc += hs;
    if (hs > as_)      home.pts += 3;
    else if (hs < as_) away.pts += 3;
    else             { home.pts++; away.pts++; }
    home.dg = home.gf - home.gc;
    away.dg = away.gf - away.gc;
  }

  const out = new Map<string, TeamRow[]>();
  for (const [name, table] of groupMap) {
    const teams = [...table.values()].sort((a, b) =>
      b.pts - a.pts || b.dg - a.dg || b.gf - a.gf || a.team.localeCompare(b.team)
    );
    out.set(name, teams);
  }
  return out;
}

import { THIRD_PLACE_TABLE, THIRD_COLS, THIRD_SLOT_BY_FIRST } from './data/third-place-table';

/** ¿Empatan a, b en los tres criterios olímpicos? → desempate real sin resolver. */
function tied(a: TeamRow, b: TeamRow): boolean {
  return a.pts === b.pts && a.dg === b.dg && a.gf === b.gf;
}

export interface GroupResolution {
  /** Mapa código→equipo para grupos cerrados sin empate ambiguo (ej. "1A"→"Mexico"). */
  codes: Map<string, string>;
  /** Grupos cerrados con 1º/2º indistinguibles por sistema olímpico (revisar a mano). */
  ambiguous: { group: string; pos: number; teams: [string, string] }[];
  /** Grupos resueltos (cerrados y sin ambigüedad en las dos primeras plazas). */
  closed: string[];
}

/**
 * Traduce las plazas 1º y 2º de cada grupo CERRADO (6 partidos jugados) a códigos
 * "1X"/"2X". Solo grupos completos: una plaza aún en disputa no se resuelve.
 */
export function resolveGroupCodes(matches: GroupMatch[]): GroupResolution {
  const standings = computeStandings(matches);
  const codes = new Map<string, string>();
  const ambiguous: GroupResolution['ambiguous'] = [];
  const closed: string[] = [];

  for (const [group, teams] of standings) {
    if (group === '—' || teams.length < 2) continue;
    // Cerrado = todos jugaron sus 3 partidos.
    if (!teams.every((t) => t.pj === 3)) continue;

    let ok = true;
    // 1º vs 2º y 2º vs 3º deben estar separados por el sistema olímpico.
    if (tied(teams[0], teams[1])) {
      ambiguous.push({ group, pos: 1, teams: [teams[0].team, teams[1].team] });
      ok = false;
    }
    if (teams.length >= 3 && tied(teams[1], teams[2])) {
      ambiguous.push({ group, pos: 2, teams: [teams[1].team, teams[2].team] });
      ok = false;
    }
    if (!ok) continue;

    codes.set(`1${group}`, teams[0].team);
    codes.set(`2${group}`, teams[1].team);
    closed.push(group);
  }

  return { codes, ambiguous, closed };
}

export interface ThirdResolution {
  /** Mapa código-slot→equipo (ej. "3CEFHI"→"Ecuador"), si los 12 grupos cerraron. */
  codes: Map<string, string>;
  /** Razón por la que no se pudo resolver (aún), o null si se resolvió. */
  blocked: string | null;
}

interface ThirdRow extends TeamRow { group: string }

/**
 * Resuelve los 8 slots de mejores terceros ("3CEFHI"…) → equipos reales.
 *
 * Requiere los 12 grupos cerrados. Rankea los 12 terceros por sistema olímpico
 * (pts → dg → gf); toma los 8 mejores; con el CONJUNTO de sus grupos consulta la
 * tabla oficial FIFA (Anexo C), que asigna cada tercero a un 1º concreto.
 *
 * El último criterio de FIFA (ranking mundial) no está disponible; si el corte 8º/9º
 * o el orden que lo afecta queda empatado en los tres criterios olímpicos, NO se
 * resuelve (se reporta) para no asignar a ciegas.
 */
export function resolveThirdPlaceCodes(matches: GroupMatch[]): ThirdResolution {
  const standings = computeStandings(matches);
  const groups = [...standings.keys()].filter((g) => g !== '—');
  const empty = new Map<string, string>();

  if (groups.length < 12) return { codes: empty, blocked: `Faltan grupos (${groups.length}/12)` };

  const thirds: ThirdRow[] = [];
  for (const g of groups) {
    const t = standings.get(g)!;
    if (!t.every((r) => r.pj === 3)) return { codes: empty, blocked: `Grupo ${g} no cerrado` };
    if (t.length < 3) return { codes: empty, blocked: `Grupo ${g} incompleto` };
    thirds.push({ ...t[2], group: g });
  }

  // Ranking olímpico de los 12 terceros.
  thirds.sort((a, b) => b.pts - a.pts || b.dg - a.dg || b.gf - a.gf || a.group.localeCompare(b.group));

  // Corte 8º/9º: si empatan en los tres criterios, el ranking mundial decidiría → sin resolver.
  if (tied(thirds[7], thirds[8])) {
    return {
      codes: empty,
      blocked: `Corte 8º/9º empatado por sistema olímpico (${thirds[7].team} vs ${thirds[8].team}); decide ranking FIFA`,
    };
  }

  const key = thirds.slice(0, 8).map((t) => t.group).sort().join('');
  const assign = THIRD_PLACE_TABLE[key];
  if (!assign) return { codes: empty, blocked: `Combinación ${key} no está en la tabla FIFA` };

  // assign[i] = letra de grupo del tercero que enfrenta a THIRD_COLS[i].
  const thirdTeamByGroup = new Map(thirds.map((t) => [t.group, t.team]));
  const codes = new Map<string, string>();
  for (let i = 0; i < THIRD_COLS.length; i++) {
    const first = THIRD_COLS[i];          // ej. "1A"
    const slot = THIRD_SLOT_BY_FIRST[first]; // ej. "3CEFHI"
    const grp = assign[i];                // ej. "E"
    codes.set(slot, thirdTeamByGroup.get(grp)!);
  }
  return { codes, blocked: null };
}
