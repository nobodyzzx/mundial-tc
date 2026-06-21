import type { APIRoute } from 'astro';
import { createRequestClient } from '@/lib/supabase';
import { logEvent } from '@/lib/system-log';

/**
 * Registra en la bitácora que el jugador VIO el aviso de "jornada cerrada" (entró
 * tarde y pulsó Entendido en el popup). Da constancia al réferi de que el jugador
 * supo que no alcanzó a pronosticar. Best-effort: no rompe nada si falla.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const supabase = createRequestClient();
  const accessToken = cookies.get('sb-access-token')?.value;
  const refreshToken = cookies.get('sb-refresh-token')?.value;
  if (!accessToken || !refreshToken)
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });

  const { data: { user } } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (!user) return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });

  const { data: profile } = await supabase
    .from('profiles').select('username').eq('id', user.id).single();

  const form = await request.formData();
  const key = form.get('key')?.toString().slice(0, 40) ?? '';

  await logEvent({
    category: 'pronostico',
    event: 'cierre-visto',
    actor: profile?.username ?? null,
    summary: `${profile?.username ?? '—'} confirmó el aviso de jornada cerrada`,
    detail: key ? `jornada-key:${key}` : null,
  });

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
