/**
 * Código de validación corto y legible derivado del id de un pronóstico pendiente
 * (pending_predictions). Se muestra GRANDE al jugador cuando la BD falla y, espejado,
 * en la tarjeta del Réferi — así el réferi cruza la captura del jugador con el
 * pendiente correcto. Determinístico: el mismo id da siempre el mismo código.
 *
 * Toma los primeros 6 hex del UUID y los formatea como "ABC-123" (mayúsculas).
 */
export function pendingCode(id: string): string {
  const hex = id.replace(/-/g, '').slice(0, 6).toUpperCase();
  return `${hex.slice(0, 3)}-${hex.slice(3, 6)}`;
}
