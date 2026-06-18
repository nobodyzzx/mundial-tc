import type { APIRoute } from 'astro';
import { createRequestClient } from '@/lib/supabase';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const supabase = createRequestClient(); // sesión aislada por petición (ver lib/supabase)
  const accessToken  = cookies.get('sb-access-token')?.value;
  const refreshToken = cookies.get('sb-refresh-token')?.value;
  if (!accessToken || !refreshToken) return redirect('/login?error=Sesión+inválida');

  const { data: { user }, error: sessionErr } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (sessionErr || !user) return redirect('/login?error=Sesión+expirada.+Intentá+de+nuevo.');

  const form     = await request.formData();
  const password = form.get('password')?.toString();
  const confirm  = form.get('confirm_password')?.toString();

  if (!password || password.length < 8)
    return redirect('/nueva-contrasena?error=' + encodeURIComponent('La contraseña debe tener al menos 8 caracteres'));

  if (password !== confirm)
    return redirect('/nueva-contrasena?error=' + encodeURIComponent('Las contraseñas no coinciden'));

  const { error } = await supabase.auth.updateUser({ password });
  if (error)
    return redirect('/nueva-contrasena?error=' + encodeURIComponent(error.message));

  return redirect('/nueva-contrasena?message=' + encodeURIComponent('¡Contraseña actualizada! Ya podés usar tu nueva contraseña.'));
};
