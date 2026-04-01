import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getAdminUser } from '@/lib/auth-helpers';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  const form = await request.formData();
  const userId = form.get('userId')?.toString();
  const field  = form.get('field')?.toString();   // 'pago70' | 'pago50'
  const value  = form.get('value')?.toString() === 'true';

  if (!userId || !field) return redirect('/admin?err=Datos+incompletos');

  if (field === 'pago70') {
    // Al desactivar 70, también desactivar 50
    await supabaseAdmin
      .from('profiles')
      .update({ pago_70: value, ...(value === false ? { pago_50: false } : {}) })
      .eq('id', userId);
  } else if (field === 'pago50') {
    // Verificar que pago_70 esté activo antes de activar pago_50
    if (value) {
      const { data: target } = await supabaseAdmin
        .from('profiles').select('pago_70').eq('id', userId).single();
      if (!target?.pago_70) return redirect('/admin?err=Debe+confirmar+el+pago+de+70+Bs+primero');
    }
    await supabaseAdmin
      .from('profiles')
      .update({ pago_50: value })
      .eq('id', userId);
  } else {
    return redirect('/admin?err=Campo+no+válido');
  }

  return redirect('/admin?msg=Pago+actualizado');
};
