import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getAdminUser } from '@/lib/auth-helpers';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  const form = await request.formData();
  const userId = form.get('user_id')?.toString();
  const monto  = parseInt(form.get('monto_pagado')?.toString() ?? '');

  if (!userId || isNaN(monto) || monto < 0) {
    return redirect('/admin/usuarios?err=Datos+inválidos');
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ monto_pagado: monto })
    .eq('id', userId);

  if (error) return redirect('/admin/usuarios?err=' + encodeURIComponent(error.message));
  return redirect('/admin/usuarios?msg=Monto+actualizado');
};
