/**
 * Desempate de la tabla de posiciones.
 *
 * A igualdad de puntos: gana quien tenga más MARCADORES EXACTOS; si persiste,
 * quien tenga más ACIERTOS (cualquier pronóstico que sumó puntos).
 *
 * ⚠️ Este criterio NO está documentado en el reglamento de este campeonato
 * (queda como criterio interno del sistema). Se publicará a partir del siguiente
 * — ver el bloque oculto en `src/pages/reglas.astro`.
 *
 *   "Exacto"  = pronóstico que sumó 3+ pts (marcador clavado, grupos o eliminatoria).
 *   "Acierto" = pronóstico que sumó cualquier punto (al menos acertó la dirección).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface TiebreakStat {
  exactos: number;
  aciertos: number;
}

const empty = (): TiebreakStat => ({ exactos: 0, aciertos: 0 });

function tally(stat: TiebreakStat, pts: number | null): void {
  const p = pts ?? 0;
  if (p >= 3) stat.exactos++;
  if (p > 0) stat.aciertos++;
}

/** Cuenta exactos/aciertos por usuario consultando sus pronósticos puntuados. */
export async function tiebreakStats(
  db: SupabaseClient,
  userIds: string[],
): Promise<Map<string, TiebreakStat>> {
  const map = new Map<string, TiebreakStat>();
  for (const id of userIds) map.set(id, empty());
  if (!userIds.length) return map;

  const { data } = await db
    .from('predictions')
    .select('user_id, points_earned')
    .in('user_id', userIds)
    .not('points_earned', 'is', null);

  for (const p of data ?? []) {
    const s = map.get(p.user_id);
    if (s) tally(s, p.points_earned);
  }
  return map;
}

/** Acumula exactos/aciertos desde una lista de pronósticos ya cargada en memoria. */
export function tiebreakStatsFromPreds(
  preds: Array<{ user_id: string; points_earned: number | null }>,
): Map<string, TiebreakStat> {
  const map = new Map<string, TiebreakStat>();
  for (const p of preds) {
    let s = map.get(p.user_id);
    if (!s) { s = empty(); map.set(p.user_id, s); }
    tally(s, p.points_earned);
  }
  return map;
}

/** Comparador de tabla: puntos → exactos → aciertos (todos descendente). */
export function compareStandings(
  a: { puntos_totales: number | null; exactos: number; aciertos: number },
  b: { puntos_totales: number | null; exactos: number; aciertos: number },
): number {
  const pa = a.puntos_totales ?? 0;
  const pb = b.puntos_totales ?? 0;
  if (pb !== pa) return pb - pa;
  if (b.exactos !== a.exactos) return b.exactos - a.exactos;
  return b.aciertos - a.aciertos;
}

/**
 * Ordena perfiles aplicando el desempate. Hace UNA consulta de pronósticos y
 * devuelve los perfiles ordenados con sus stats de desempate adjuntas.
 */
export async function rankProfiles<T extends { id: string; puntos_totales: number | null }>(
  db: SupabaseClient,
  profiles: T[],
): Promise<Array<T & TiebreakStat>> {
  const stats = await tiebreakStats(db, profiles.map((p) => p.id));
  return profiles
    .map((p) => ({ ...p, ...(stats.get(p.id) ?? empty()) }))
    .sort(compareStandings);
}
