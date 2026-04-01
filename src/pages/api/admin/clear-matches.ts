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

  const { error: predError } = await supabaseAdmin
    .from('predictions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (predError) return redirect('/admin?err=' + encodeURIComponent('Error borrando predicciones'));

  const { error: sanctionError } = await supabaseAdmin
    .from('sanctions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (sanctionError) return redirect('/admin?err=' + encodeURIComponent('Error borrando sanciones'));

  const { error: matchError } = await supabaseAdmin
    .from('matches').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (matchError) return redirect('/admin?err=' + encodeURIComponent('Error borrando partidos'));

  const { error: ptsError } = await supabaseAdmin
    .from('profiles')
    .update({ puntos_totales: 0, expulsado: false, pago_70: false, pago_50: false })
    .eq('es_referi', false);
  if (ptsError) return redirect('/admin?err=' + encodeURIComponent('Datos borrados pero error reseteando perfiles'));

  return redirect('/admin?msg=' + encodeURIComponent('Competición limpiada · partidos, pronósticos, sanciones y perfiles reseteados'));
};
