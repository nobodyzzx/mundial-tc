import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getAdminUser } from '@/lib/auth-helpers';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  const form = await request.formData();
  const raw70 = form.get('pagos_deadline_70')?.toString().trim() ?? '';
  const raw50 = form.get('pagos_deadline_50')?.toString().trim() ?? '';

  // datetime-local envía "YYYY-MM-DDTHH:MM" sin timezone → interpretamos como Bolivia (UTC-4)
  function boliviaToUtc(localStr: string): string | null {
    if (!localStr) return null;
    const d = new Date(localStr + '-04:00');
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  const rows = [
    { key: 'pagos_deadline_70', value: boliviaToUtc(raw70), updated_at: new Date().toISOString() },
    { key: 'pagos_deadline_50', value: boliviaToUtc(raw50), updated_at: new Date().toISOString() },
  ];

  const { error } = await supabaseAdmin.from('settings').upsert(rows);
  if (error) return redirect(`/admin?err=${encodeURIComponent('Error guardando configuración: ' + error.message)}`);

  return redirect('/admin?msg=Configuraci%C3%B3n+guardada');
};
