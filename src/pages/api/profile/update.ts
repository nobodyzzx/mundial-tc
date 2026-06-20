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

  // Cambio de apodo de UNA SOLA VEZ. Se lee el estado actual: si el nombre no
  // cambia, no consume el cambio; si ya lo usó, se rechaza. El réferi NO pasa por
  // aquí (renombra desde el panel), así que su override no se ve afectado.
  const { data: current } = await supabaseAdmin
    .from('profiles')
    .select('username, apodo_cambiado')
    .eq('id', user.id)
    .single();

  if (current && username === current.username)
    return redirect('/perfil?msg=' + encodeURIComponent('Tu apodo no cambió'));

  if (current?.apodo_cambiado)
    return redirect('/perfil?err=' + encodeURIComponent('Ya usaste tu único cambio de apodo. Es definitivo; si hay un error, contacta al Réferi.'));

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ username, apodo_cambiado: true })
    .eq('id', user.id);

  if (error) {
    const msg = error.message.includes('unique') || error.message.includes('duplicate')
      ? 'Ese nombre ya está en uso'
      : error.message;
    return redirect('/perfil?err=' + encodeURIComponent(msg));
  }

  return redirect('/perfil?msg=' + encodeURIComponent('Apodo actualizado. Recuerda: era tu único cambio, ahora es definitivo.'));
};
