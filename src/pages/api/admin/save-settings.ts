import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getAdminUser } from '@/lib/auth-helpers';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  const form = await request.formData();
  const deadline70 = form.get('pagos_deadline_70')?.toString().trim() ?? '';
  const deadline50 = form.get('pagos_deadline_50')?.toString().trim() ?? '';

  const rows = [
    { key: 'pagos_deadline_70', value: deadline70 || null, updated_at: new Date().toISOString() },
    { key: 'pagos_deadline_50', value: deadline50 || null, updated_at: new Date().toISOString() },
  ];

  const { error } = await supabaseAdmin.from('settings').upsert(rows);
  if (error) return redirect(`/admin?err=${encodeURIComponent('Error guardando configuración: ' + error.message)}`);

  return redirect('/admin?msg=Configuraci%C3%B3n+guardada');
};
