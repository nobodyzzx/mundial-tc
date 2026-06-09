/**
 * SOLO EN DEV: simula "ahora" en un punto del Mundial 2026 para poder probar
 * predicciones abiertas, partidos en vivo, resultados, etc. El tiempo fluye a
 * velocidad real desde el arranque del dev server, anclado a BETA_SIMULATED_NOW.
 *
 * Para mover el reloj, cambia BETA_SIMULATED_NOW y reinicia `pnpm dev`.
 * Ej: '2026-06-11T12:00:00Z' = 11 jun 08:00 BOT → predicciones del día 1 abiertas.
 *
 * EN CUALQUIER BUILD (deploy beta o producción) el offset es 0 y se usa SIEMPRE
 * el tiempo real — la hora nunca se mueve fuera de dev.
 */

// Punto del torneo a simular como "ahora" al arrancar el dev server.
const BETA_SIMULATED_NOW_MS = new Date('2026-06-11T12:00:00Z').getTime();

// Momento real en que se cargó el módulo (arranque del server). El reloj
// fluye normal a partir de aquí, anclado a BETA_SIMULATED_NOW_MS.
const MODULE_LOAD_MS = Date.now();

// Solo en el dev server se aplica el offset; en builds siempre es 0 (tiempo real).
export const BETA_OFFSET_MS = import.meta.env.DEV
  ? BETA_SIMULATED_NOW_MS - MODULE_LOAD_MS
  : 0;

/** Timestamp "ahora" (simulado en beta, real en producción) */
export function betaNowMs(): number {
  return Date.now() + BETA_OFFSET_MS;
}

/** Date "ahora" */
export function betaNow(): Date {
  return new Date(betaNowMs());
}
