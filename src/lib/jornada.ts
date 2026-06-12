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
