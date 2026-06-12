/**
 * Bitácora central del sistema. Un solo log para todo lo relevante.
 * Best-effort: nunca lanza ni interrumpe el flujo que lo invoca.
 *
 * Categorías: 'whatsapp' (mensajes enviados), 'marcador' (scores sync/manual),
 * 'pronostico' (ingresos/rechazos), 'acceso' (login/logout), 'sistema' (otros).
 */
import { supabaseAdmin } from './supabase';

export interface LogEvent {
  category: 'whatsapp' | 'marcador' | 'pronostico' | 'acceso' | 'sistema';
  event?: string | null;
  actor?: string | null;     // quién: username | 'sistema' | 'ESPN' | 'réferi'
  summary: string;
  detail?: string | null;
}

export async function logEvent(e: LogEvent): Promise<void> {
  try {
    await supabaseAdmin.from('system_log').insert({
      category: e.category,
      event: e.event ?? null,
      actor: e.actor ?? null,
      summary: e.summary.slice(0, 500),
      detail: e.detail ? e.detail.slice(0, 1000) : null,
    });
  } catch { /* el registro nunca debe romper el flujo */ }
}
