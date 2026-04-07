/**
 * Lógica compartida de cierre de jornada.
 * Centraliza la regla de 2h y el cálculo de medianoche Bolivia (UTC-4).
 * Si la regla cambia, solo hay que editar este archivo.
 */

/** Milisegundos de anticipación para cerrar pronósticos antes del primer partido. */
export const JORNADA_CLOSE_MS = 2 * 3600 * 1000; // 2 horas

/**
 * Retorna el timestamp UTC del inicio del día Bolivia (UTC-4) para una fecha dada.
 * Ej: si el partido es el 15/06 a las 15:00 BOT → retorna 15/06 00:00 BOT (= 04:00 UTC).
 */
export function boliviaDayStart(dateMs: number): Date {
  const shifted = new Date(dateMs - 4 * 3600 * 1000);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) + 4 * 3600 * 1000
  );
}

/**
 * Retorna true si la jornada está cerrada (ya pasó el cutoff de JORNADA_CLOSE_MS
 * antes del primer partido).
 */
export function isCutoffPassed(firstMatchTimeMs: number, nowMs: number): boolean {
  return firstMatchTimeMs - nowMs < JORNADA_CLOSE_MS;
}
