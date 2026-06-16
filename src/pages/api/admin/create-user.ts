import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { sanitizeError, getAdminUser } from '@/lib/auth-helpers';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  const form = await request.formData();
  const email    = form.get('email')?.toString()?.trim().toLowerCase();
  const username = form.get('username')?.toString()?.trim();
  const password = form.get('password')?.toString()?.trim();
  const esReferi = form.get('es_referi') === 'on';

  if (!email || !username) return redirect('/admin/usuarios?err=Email+y+nombre+son+obligatorios');
  // Sin magic link: el jugador entra con contraseña, así que es obligatoria.
  if (!password || password.length < 6) return redirect('/admin/usuarios?err=' + encodeURIComponent('La contraseña es obligatoria (mínimo 6 caracteres)'));

  // Crear usuario en Auth (confirmado directamente, sin email de verificación)
  const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authErr || !created.user) {
    return redirect('/admin/usuarios?err=' + encodeURIComponent(sanitizeError(authErr) ?? 'Error creando usuario'));
  }

  // Crear perfil
  const { error: profileErr } = await supabaseAdmin.from('profiles').insert({
    id: created.user.id,
    username,
    es_referi: esReferi,
    participa: !esReferi,
    puntos_totales: 0,
    expulsado: false,
    pago_70: false,
    pago_50: false,
  });

  if (profileErr) {
    // Revertir usuario en auth si falla el perfil
    await supabaseAdmin.auth.admin.deleteUser(created.user.id);
    return redirect('/admin/usuarios?err=' + encodeURIComponent(sanitizeError(profileErr)));
  }

  return redirect(`/admin/usuarios?msg=${encodeURIComponent(`Usuario "${username}" creado`)}`);
};
