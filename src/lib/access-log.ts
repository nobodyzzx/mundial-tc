/**
 * Registro de accesos (entradas/salidas) del sistema.
 * Best-effort: nunca lanza ni interrumpe el flujo de login/logout.
 */
import { supabaseAdmin } from './supabase';
import { logEvent } from './system-log';

export async function logAccess(
  userId: string | null | undefined,
  event: 'login' | 'logout',
  method: string | null = null,
): Promise<void> {
  if (!userId) return;
  try {
    const { data } = await supabaseAdmin.from('profiles').select('username').eq('id', userId).single();
    const username = data?.username ?? null;
    await supabaseAdmin.from('access_log').insert({ user_id: userId, username, event, method });
    // También a la bitácora central.
    await logEvent({
      category: 'acceso',
      event,
      actor: username,
      summary: `${username ?? '—'} ${event === 'login' ? 'entró' : 'salió'}${method ? ` (${method})` : ''}`,
    });
  } catch { /* el registro nunca debe romper el acceso */ }
}
