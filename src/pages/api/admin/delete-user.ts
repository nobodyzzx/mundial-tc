import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getAdminUser, isValidUUID, sanitizeError } from '@/lib/auth-helpers';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  const form = await request.formData();
  const targetId = form.get('user_id')?.toString();

  if (!targetId || !isValidUUID(targetId))
    return redirect('/admin/usuarios?err=ID+inválido');

  if (targetId === admin.user.id)
    return redirect('/admin/usuarios?err=No+podés+eliminarte+a+vos+mismo');

  console.warn(`[AUDIT] delete-user: ${admin.username} eliminó usuario ${targetId} a las ${new Date().toISOString()}`);

  await supabaseAdmin.from('predictions').delete().eq('user_id', targetId);
  await supabaseAdmin.from('sanctions').delete().eq('user_id', targetId);
  await supabaseAdmin.from('profiles').delete().eq('id', targetId);

  const { error } = await supabaseAdmin.auth.admin.deleteUser(targetId);
  if (error) return redirect('/admin/usuarios?err=' + encodeURIComponent(sanitizeError(error)));

  return redirect('/admin/usuarios?msg=Usuario+eliminado');
};
