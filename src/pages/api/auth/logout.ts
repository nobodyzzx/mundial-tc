import type { APIRoute } from 'astro';
import { supabase } from '@/lib/supabase';
import { logAccess } from '@/lib/access-log';

export const POST: APIRoute = async ({ cookies, redirect }) => {
  // Identificar al usuario por el token antes de borrar las cookies, para el log.
  const token = cookies.get('sb-access-token')?.value;
  if (token) {
    try {
      const { data } = await supabase.auth.getUser(token);
      if (data.user) await logAccess(data.user.id, 'logout');
    } catch { /* best-effort */ }
  }

  cookies.delete('sb-access-token', { path: '/' });
  cookies.delete('sb-refresh-token', { path: '/' });
  return redirect('/login');
};
