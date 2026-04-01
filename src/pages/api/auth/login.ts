import type { APIRoute } from 'astro';
import { supabase } from '@/lib/supabase';
import { ensureProfile } from '@/lib/auth-helpers';

function traducirError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials') || m.includes('invalid credentials'))
    return 'Correo o contraseña incorrectos';
  if (m.includes('email not confirmed'))
    return 'Correo no confirmado. Revisá tu bandeja de entrada';
  if (m.includes('too many requests') || m.includes('rate limit'))
    return 'Demasiados intentos. Esperá unos minutos e intentá de nuevo';
  if (m.includes('user not found'))
    return 'No existe una cuenta con ese correo';
  if (m.includes('password') && m.includes('weak'))
    return 'La contraseña es demasiado débil';
  if (m.includes('network') || m.includes('fetch'))
    return 'Error de conexión. Verificá tu internet';
  if (m.includes('email') && m.includes('invalid'))
    return 'El formato del correo no es válido';
  return msg; // fallback: mostrar original si no se reconoce
}

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const email = form.get('email')?.toString();
  const password = form.get('password')?.toString();

  if (!email) {
    return redirect('/login?error=El+correo+es+obligatorio');
  }

  // Si viene password: login clásico
  if (password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      return redirect(`/login?error=${encodeURIComponent(traducirError(error?.message ?? 'Credenciales incorrectas'))}`);
    }

    // Redirigir al callback con los tokens como query params simulados
    // En realidad seteamos las cookies aquí directamente
    const response = new Response(null, {
      status: 302,
      headers: { Location: '/dashboard' },
    });

    const maxAge = 60 * 60 * 24 * 7;
    const secure = import.meta.env.PROD ? '; Secure' : '';
    const cookieOpts = `Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
    response.headers.append('Set-Cookie', `sb-access-token=${data.session.access_token}; ${cookieOpts}`);
    response.headers.append('Set-Cookie', `sb-refresh-token=${data.session.refresh_token}; ${cookieOpts}`);

    await ensureProfile(data.user, supabase, import.meta.env.ADMIN_EMAIL);
    return response;
  }

  // Magic link (producción)
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${new URL(request.url).origin}/api/auth/callback`,
    },
  });

  if (error) {
    return redirect(`/login?error=${encodeURIComponent(traducirError(error.message))}`);
  }

  return redirect('/login?message=¡Revisa+tu+correo!+Te+enviamos+el+link+para+entrar.');
};
