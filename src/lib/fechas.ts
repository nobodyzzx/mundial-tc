/**
 * Formateo de fechas centralizado.
 * Toda la app muestra horas en zona Bolivia (UTC-4) con locale es-BO.
 * Si cambia el locale o la zona, solo se edita este archivo.
 */

export const LOCALE = 'es-BO';
export const TIMEZONE = 'America/La_Paz';

/**
 * Formatea una fecha en zona Bolivia con locale es-BO y reloj de 24h.
 * Pasa las opciones de formato (weekday, day, hour, minute, etc.) según el caso;
 * timeZone y hour12 ya vienen aplicados, no hace falta repetirlos.
 *
 * Reemplaza tanto a toLocaleString como a toLocaleDateString: si no se piden
 * hour/minute, simplemente no se muestra la hora.
 */
export function fmtFecha(
  date: Date | string | number,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Date(date).toLocaleString(LOCALE, {
    timeZone: TIMEZONE,
    hour12: false,
    ...options,
  });
}

/**
 * Clave de día en zona Bolivia con formato YYYY-MM-DD (locale en-CA).
 * Útil para agrupar/comparar por día sin depender de la zona del servidor.
 */
export function fmtDiaKey(date: Date | string | number): string {
  return new Date(date).toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}
