/**
 * Lógica compartida de cierre de jornada.
 * Centraliza la regla de 2h y el cálculo de medianoche Bolivia (UTC-4).
 * Si la regla cambia, solo hay que editar este archivo.
 */

/** Milisegundos de anticipación para cerrar pronósticos antes del primer partido. */
export const JORNADA_CLOSE_MS = 2 * 3600 * 1000; // 2 horas

/**
 * Anticipación con la que se REVELAN los pronósticos del día antes del primer
 * partido. Debe ser MENOR que JORNADA_CLOSE_MS para que nunca se vean antes de
 * cerrar: 1h55m = 5 minutos DESPUÉS del cierre (que es a 2h). Usado por la
 * página /pronosticos y por el cron dia-pronosticos (ambos mantienen la misma
 * restricción gracias a esta fuente única).
 */
export const REVEAL_BEFORE_MS = 115 * 60 * 1000; // 1h 55m

/**
 * Retorna el timestamp UTC del inicio de la "jornada del día" Bolivia.
 * El día se considera que empieza a las 03:00 AM BOT (no en medianoche) para
 * que partidos a las 00:00-02:59 queden agrupados con la noche anterior.
 * Ej: Australia-Turquía 00:00 sáb → misma jornada que USA-Paraguay 21:00 vie.
 */
const BOLIVIA_OFFSET_MS = 4 * 3600 * 1000;  // UTC-4
const DAY_BOUNDARY_MS   = 3 * 3600 * 1000;  // el "día" empieza a las 03:00 BOT

export function boliviaDayStart(dateMs: number): Date {
  const shifted = new Date(dateMs - BOLIVIA_OFFSET_MS - DAY_BOUNDARY_MS);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
    + BOLIVIA_OFFSET_MS + DAY_BOUNDARY_MS
  );
}

/**
 * Retorna true si la jornada está cerrada (ya pasó el cutoff de JORNADA_CLOSE_MS
 * antes del primer partido).
 */
export function isCutoffPassed(firstMatchTimeMs: number, nowMs: number): boolean {
  return firstMatchTimeMs - nowMs < JORNADA_CLOSE_MS;
}

/**
 * Clave canónica de "día jornada" Bolivia (frontera 03:00 BOT). Dos partidos de
 * la misma jornada comparten clave; uno de medianoche (00:00-02:59) cae con la
 * noche anterior. Úsala SIEMPRE para agrupar/comparar días — nunca el día
 * calendario (medianoche), que parte la jornada de medianoche en dos.
 */
export function boliviaDayKey(dateMs: number): number {
  return boliviaDayStart(dateMs).getTime();
}

export type JornadaLockState = 'open' | 'closed' | 'prevPending' | 'ongoingLock';

/**
 * Estado de bloqueo de una jornada para pronosticar. Fuente ÚNICA de la máquina
 * de estados que antes se repetía (y divergía) entre /predictions y el dashboard.
 * Cada página calcula sus booleanos con sus propios datos y delega aquí la
 * decisión y su precedencia:
 *   1. cutoff (2h antes del primer partido) → 'closed'
 *   2. jornada anterior sin terminar (y el día propio aún no empezó) → 'prevPending'
 *   3. el día ya empezó o hay un partido en curso → 'ongoingLock'
 *   4. → 'open'
 */
export function jornadaLockState(opts: {
  firstMatchMs: number;
  nowMs: number;
  /** Algún partido del mismo día jornada (clave 03:00 BOT) ya inició. */
  sameDayStarted: boolean;
  /** Hay algún partido en curso ahora mismo (iniciado y sin terminar). */
  hasMatchInProgress: boolean;
  /** Existe un partido sin terminar anterior al primero de esta jornada. */
  hasEarlierUnfinished: boolean;
}): JornadaLockState {
  if (isCutoffPassed(opts.firstMatchMs, opts.nowMs)) return 'closed';
  if (!opts.sameDayStarted && opts.hasEarlierUnfinished) return 'prevPending';
  if (opts.sameDayStarted || opts.hasMatchInProgress) return 'ongoingLock';
  return 'open';
}
