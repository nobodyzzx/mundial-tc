import type { APIRoute } from 'astro';
import { createRequestClient, supabaseAdmin } from '@/lib/supabase';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const supabase = createRequestClient(); // sesión aislada por petición (ver lib/supabase)
  const accessToken  = cookies.get('sb-access-token')?.value;
  const refreshToken = cookies.get('sb-refresh-token')?.value;
  if (!accessToken || !refreshToken) return redirect('/login');

  const { data: { user } } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (!user) return redirect('/login');

  const form     = await request.formData();
  const username = form.get('username')?.toString()?.trim();

  if (!username || username.length < 2)
    return redirect('/perfil?err=' + encodeURIComponent('El nombre debe tener al menos 2 caracteres'));

  if (username.length > 30)
    return redirect('/perfil?err=' + encodeURIComponent('El nombre no puede superar los 30 caracteres'));

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ username })
    .eq('id', user.id);

  if (error) {
    const msg = error.message.includes('unique') || error.message.includes('duplicate')
      ? 'Ese nombre ya está en uso'
      : error.message;
    return redirect('/perfil?err=' + encodeURIComponent(msg));
  }

  return redirect('/perfil?msg=' + encodeURIComponent('Nombre actualizado correctamente'));
};
