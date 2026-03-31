import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const accessToken = cookies.get('sb-access-token')?.value;
  const refreshToken = cookies.get('sb-refresh-token')?.value;
  if (!accessToken || !refreshToken) return redirect('/login');

  const { data: { user } } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (!user) return redirect('/login');

  const { data: profile } = await supabaseAdmin.from('profiles').select('es_referi').eq('id', user.id).single();
  if (!profile?.es_referi) return redirect('/dashboard');

  const form = await request.formData();
  const email    = form.get('email')?.toString()?.trim().toLowerCase();
  const username = form.get('username')?.toString()?.trim();
  const password = form.get('password')?.toString()?.trim();
  const esReferi = form.get('es_referi') === 'on';

  if (!email || !username) return redirect('/admin/usuarios?err=Email+y+nombre+son+obligatorios');

  // Crear usuario en Auth (confirmado directamente, sin email de verificación)
  const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: password || undefined,
    email_confirm: true,
  });

  if (authErr || !created.user) {
    return redirect(`/admin/usuarios?err=${encodeURIComponent(authErr?.message ?? 'Error creando usuario')}`);
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
    return redirect(`/admin/usuarios?err=${encodeURIComponent('Error creando perfil: ' + profileErr.message)}`);
  }

  return redirect(`/admin/usuarios?msg=${encodeURIComponent(`Usuario "${username}" creado`)}`);
};
