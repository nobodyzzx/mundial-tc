/**
 * Fuente única de verdad del sistema de pagos.
 *
 * `monto_pagado` (en Bs) es el ÚNICO dato real. Los flags `pago_70` / `pago_50`
 * se derivan de él (en la DB vía trigger, y en el código vía estas funciones).
 * Nunca calcular pozo/réferi a partir de los flags: usar siempre el monto.
 *
 * Modelo: cada participante aporta 120 Bs = 100 al pozo + 20 al réferi.
 * El depósito mínimo para entrar al pozo es 70 Bs.
 */

export const DEPOSITO_BS = 70;        // mínimo para participar del pozo (ex pago_70)
export const PAGO_COMPLETO_BS = 120;  // pago total (ex pago_50 = "70+50 saldados")
export const CUOTA_REFERI_BS = 20;    // parte fija del réferi por participante
export const APORTE_POZO_MAX_BS = 100; // tope al pozo por participante (120 - 20)

/** ¿Pagó al menos el depósito? Reemplaza al flag pago_70. */
export function haPagadoDeposito(monto?: number | null): boolean {
  return (monto ?? 0) >= DEPOSITO_BS;
}

/** ¿Pagó completo? Reemplaza al flag pago_50. */
export function haPagadoCompleto(monto?: number | null): boolean {
  return (monto ?? 0) >= PAGO_COMPLETO_BS;
}

/** Aporte de este jugador al pozo (0 si no llegó al depósito; tope APORTE_POZO_MAX_BS). */
export function aportePozo(monto?: number | null): number {
  const m = monto ?? 0;
  if (m < DEPOSITO_BS) return 0;
  return Math.min(m - CUOTA_REFERI_BS, APORTE_POZO_MAX_BS);
}

/** Cuota al réferi de este jugador (CUOTA_REFERI_BS si pagó el depósito, si no 0). */
export function cuotaReferi(monto?: number | null): number {
  return haPagadoDeposito(monto) ? CUOTA_REFERI_BS : 0;
}

/** Estado de pago para UI: 'completo' | 'parcial' | 'pendiente'. */
export type EstadoPago = 'completo' | 'parcial' | 'pendiente';
export function estadoPago(monto?: number | null): EstadoPago {
  if (haPagadoCompleto(monto)) return 'completo';
  if (haPagadoDeposito(monto)) return 'parcial';
  return 'pendiente';
}

export type ResumenPozo = {
  total: number;         // suma de montos pagados (no-réferi)
  pozo: number;          // total acumulado al pozo
  referi: number;        // total al réferi
  completos: number;     // pagaron 120+
  parciales: number;     // pagaron depósito pero <120
  pendientes: number;    // no llegaron al depósito
  participantes: number; // pagaron >= depósito
};

/**
 * Agrega una lista de montos (solo jugadores que participan, sin réferis).
 * Invariante: si nadie sobrepasa el tope, total === pozo + referi.
 */
export function resumenPozo(montos: Array<number | null | undefined>): ResumenPozo {
  const r: ResumenPozo = { total: 0, pozo: 0, referi: 0, completos: 0, parciales: 0, pendientes: 0, participantes: 0 };
  for (const raw of montos) {
    const m = raw ?? 0;
    r.total += m;
    const est = estadoPago(m);
    if (est === 'pendiente') { r.pendientes++; continue; }
    if (est === 'completo') r.completos++; else r.parciales++;
    r.participantes++;
    r.pozo += aportePozo(m);
    r.referi += cuotaReferi(m);
  }
  return r;
}
