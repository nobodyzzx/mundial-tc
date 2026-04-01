import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { isValidUUID, sanitizeError, getAdminUser } from '@/lib/auth-helpers';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  const form = await request.formData();
  const targetId = form.get('user_id')?.toString();
  const username  = form.get('username')?.toString()?.trim();
  const email     = form.get('email')?.toString()?.trim().toLowerCase();
  const password  = form.get('password')?.toString()?.trim();
  const esReferi     = form.get('es_referi') === 'on';
  const hasParticipa = form.get('has_participa') === '1';
  const participa    = form.get('participa') === 'on';

  if (!targetId || !isValidUUID(targetId) || !username || !email) {
    return redirect('/admin/usuarios?err=Datos+incompletos');
  }
  if (!EMAIL_RE.test(email)) {
    return redirect('/admin/usuarios?err=El+formato+del+correo+no+es+válido');
  }

  // Verificar que el usuario existe antes de actualizar
  const { data: existingUser } = await supabaseAdmin.auth.admin.getUserById(targetId);
  if (!existingUser.user) {
    return redirect('/admin/usuarios?err=Usuario+no+encontrado');
  }

  // Actualizar Auth (email + password opcional)
  const authUpdate: any = { email };
  if (password) authUpdate.password = password;

  const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(targetId, authUpdate);
  if (authErr) return redirect('/admin/usuarios?err=' + encodeURIComponent(sanitizeError(authErr)));

  // No permitir quitarse el rol de réferi a uno mismo
  const finalEsReferi = targetId === admin.user.id ? true : esReferi;

  // Para jugadores normales, participa siempre es true.
  // Para réferis, solo actualizamos participa si el formulario incluye ese campo
  // (la forma de réferis tiene has_participa=1; la de jugadores no).
  // Si el formulario no incluye participa (al convertir jugador→réferi), conservamos el valor actual de la DB.
  let finalParticipa: boolean;
  if (!finalEsReferi) {
    finalParticipa = true;
  } else if (hasParticipa) {
    finalParticipa = participa;
  } else {
    const { data: cur } = await supabaseAdmin.from('profiles').select('participa').eq('id', targetId).single();
    finalParticipa = cur?.participa ?? true;
  }

  const { error: profileErr } = await supabaseAdmin
    .from('profiles')
    .update({ username, es_referi: finalEsReferi, participa: finalParticipa })
    .eq('id', targetId);

  if (profileErr) return redirect('/admin/usuarios?err=' + encodeURIComponent(sanitizeError(profileErr)));

  return redirect(`/admin/usuarios?msg=${encodeURIComponent(`"${username}" actualizado`)}`);
};
