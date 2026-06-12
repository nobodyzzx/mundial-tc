/**
 * Registro de accesos (entradas/salidas) del sistema.
 * Best-effort: nunca lanza ni interrumpe el flujo de login/logout.
 */
import { supabaseAdmin } from './supabase';

export async function logAccess(
  userId: string | null | undefined,
  event: 'login' | 'logout',
  method: string | null = null,
): Promise<void> {
  if (!userId) return;
  try {
    const { data } = await supabaseAdmin.from('profiles').select('username').eq('id', userId).single();
    await supabaseAdmin.from('access_log').insert({
      user_id: userId,
      username: data?.username ?? null,
      event,
      method,
    });
  } catch { /* el registro nunca debe romper el acceso */ }
}
