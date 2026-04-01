import type { SupabaseClient, User } from '@supabase/supabase-js';

/** Valida UUID v4 */
export function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Mapea errores de Supabase/Postgres a mensajes amigables.
 * Nunca expone detalles internos de la BD en la UI.
 */
export function sanitizeError(err: { message?: string; code?: string } | null | undefined): string {
  if (!err?.message) return 'Error inesperado';
  const msg = err.message.toLowerCase();
  const code = err.code ?? '';

  if (code === '23505' || msg.includes('unique') || msg.includes('duplicate'))
    return 'Ya existe un registro con esos datos';
  if (code === '23503' || msg.includes('foreign key'))
    return 'Referencia inválida — el registro relacionado no existe';
  if (code === '23514' || msg.includes('violates check'))
    return 'Los datos no cumplen las reglas del sistema';
  if (msg.includes('not found') || msg.includes('no rows'))
    return 'Registro no encontrado';
  if (msg.includes('email') && msg.includes('already'))
    return 'Ese correo ya está registrado';
  if (msg.includes('invalid email'))
    return 'El formato del correo no es válido';
  if (msg.includes('password') && msg.includes('weak'))
    return 'La contraseña es demasiado débil (mínimo 8 caracteres)';
  if (msg.includes('rate limit') || msg.includes('too many'))
    return 'Demasiados intentos. Esperá unos minutos.';
  if (msg.includes('jwt') || msg.includes('token'))
    return 'Sesión inválida. Volvé a iniciar sesión.';
  if (msg.includes('permission') || msg.includes('not authorized') || msg.includes('policy'))
    return 'No tenés permisos para realizar esta acción';

  // Fallback genérico — no expone el mensaje original
  return 'Error al procesar la solicitud';
}

export interface AdminContext {
  user: User;
  username: string;
  isSuperAdmin: boolean;
}

/**
 * Verifica que el request viene de un réferi autenticado.
 * Retorna null si no está autenticado o no es réferi (el caller debe redirect).
 *
 * Uso:
 *   const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
 *   if (!admin) return redirect('/login');
 */
export async function getAdminUser(
  cookies: { get: (name: string) => { value?: string } | undefined },
  supabase: SupabaseClient,
  supabaseAdmin: SupabaseClient,
): Promise<AdminContext | null> {
  const accessToken  = cookies.get('sb-access-token')?.value;
  const refreshToken = cookies.get('sb-refresh-token')?.value;
  if (!accessToken || !refreshToken) return null;

  const { data: { user } } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (!user) return null;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('es_referi, username')
    .eq('id', user.id)
    .single();

  if (!profile?.es_referi) return null;

  const adminEmail = import.meta.env.ADMIN_EMAIL?.toLowerCase().trim();
  const isSuperAdmin = !!adminEmail && user.email?.toLowerCase().trim() === adminEmail;

  return { user, username: profile.username, isSuperAdmin };
}

/**
 * Crea el perfil de un usuario si no existe.
 * Centraliza la lógica de primer login (antes estaba duplicada en login.ts y callback.ts).
 */
export async function ensureProfile(
  user: { id: string; email?: string },
  supabase: SupabaseClient,
  adminEmail: string | undefined,
): Promise<void> {
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .single();

  if (existing) return;

  const isAdmin = !!adminEmail && user.email?.toLowerCase().trim() === adminEmail.toLowerCase().trim();
  const username = user.email?.split('@')[0] ?? `user_${Date.now()}`;

  await supabase.from('profiles').insert({
    id: user.id,
    username,
    es_referi: isAdmin,
    participa: !isAdmin,
    puntos_totales: 0,
    expulsado: false,
    pago_70: false,
    pago_50: false,
  });
}
