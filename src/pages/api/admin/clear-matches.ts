import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getAdminUser } from '@/lib/auth-helpers';

const CONFIRM_PHRASE = 'LIMPIAR TODO';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  // Solo el super admin (ADMIN_EMAIL) puede limpiar todo
  if (!admin.isSuperAdmin)
    return redirect('/admin?err=' + encodeURIComponent('Solo el administrador principal puede realizar esta acción'));

  const form = await request.formData();
  const phrase = form.get('confirm_phrase')?.toString()?.trim().toUpperCase();

  if (phrase !== CONFIRM_PHRASE)
    return redirect(`/admin?err=${encodeURIComponent(`Escribí "${CONFIRM_PHRASE}" para confirmar`)}`);

  console.warn(`[AUDIT] clear-matches ejecutado por ${admin.username} (${admin.user.id}) a las ${new Date().toISOString()}`);

  // clear_competition() es SECURITY DEFINER — bypasea la RULE no_delete_predictions
  const { error } = await supabaseAdmin.rpc('clear_competition');
  if (error) return redirect('/admin?err=' + encodeURIComponent('Error al limpiar: ' + error.message));

  return redirect('/admin?msg=' + encodeURIComponent('Competición limpiada · partidos, pronósticos, sanciones y perfiles reseteados'));
};
