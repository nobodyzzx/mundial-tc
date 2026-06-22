/**
 * GET /api/cron/watchdog?secret=CRON_SECRET
 *
 * Dead-man's switch del sync. El sync (n8n) deja heartbeat en sync_logs en cada
 * corrida; EN VENTANA DE PARTIDO corre cada ~1 min. Si hay un partido en juego y
 * no hubo ninguna corrida en >STALE_MIN, el cron está colgado/caído y los
 * marcadores quedan congelados — esto lo detecta y avisa.
 *
 * Cómo se usa (cualquiera de los dos, o ambos):
 *   - n8n: un workflow SEPARADO del de sync que pegue aquí cada ~5 min (separado
 *     para que un fallo del workflow de sync no tumbe también al vigilante).
 *   - Monitor externo de uptime (UptimeRobot, etc.) apuntando a esta URL: si la
 *     app o n8n entero caen, devuelve 503 y el monitor avisa por su cuenta. Esta
 *     es la red de seguridad real contra una caída total.
 *
 * Devuelve 200 si todo está sano (o no hay partido en ventana) y 503 si detecta
 * que el sync está colgado. El aviso al grupo va por alertGroupError (deduplicado
 * por día), así que aunque se consulte cada 5 min no spamea.
 */
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@/lib/supabase';
import { alertGroupError } from '@/lib/whatsapp';
import { checkCronSecret, json } from '@/lib/cron';

// Sin corrida de sync en >10 min ESTANDO en ventana = colgado (corre cada 1 min).
const STALE_MIN = 10;
// Misma ventana que el gate del sync: un partido sin terminar en [now-6h, now].
const WINDOW_BACK_MS = 6 * 3600 * 1000;

export const GET: APIRoute = async ({ url, request }) => {
  if (!(await checkCronSecret(url, request))) return json({ error: 'Unauthorized' }, 401);

  const now = Date.now();

  // 1. ¿Hay un partido en juego que arrancó hace >= STALE_MIN? El límite superior
  //    (now - STALE_MIN) evita el falso positivo del minuto del arranque, cuando el
  //    último registro de sync todavía puede ser el heartbeat de 30 min de fuera
  //    de ventana. Un sync vivo loguea cada minuto desde el pitazo inicial.
  const { data: active } = await supabaseAdmin
    .from('matches')
    .select('id')
    .eq('is_finished', false)
    .gte('match_date', new Date(now - WINDOW_BACK_MS).toISOString())
    .lte('match_date', new Date(now - STALE_MIN * 60_000).toISOString())
    .limit(1);

  if (!active?.length) {
    return json({ ok: true, window: false, reason: 'Sin partido en ventana de juego' });
  }

  // 2. ¿Cuándo fue la última corrida de sync? (cualquier fila source='sync').
  const { data: last } = await supabaseAdmin
    .from('sync_logs')
    .select('created_at')
    .eq('source', 'sync')
    .order('created_at', { ascending: false })
    .limit(1);

  const lastMs = last?.[0] ? new Date(last[0].created_at).getTime() : 0;
  const ageMin = Math.round((now - lastMs) / 60_000);

  if (ageMin <= STALE_MIN) {
    return json({ ok: true, window: true, lastSyncMinAgo: ageMin });
  }

  // 3. Colgado: hay partido en juego pero el sync no corre. Avisar (deduplicado
  //    por día) y devolver 503 para que un monitor externo también lo capte.
  await alertGroupError({
    source: 'sync-colgado',
    detail: `El sync no corre hace ${ageMin} min y hay un partido en juego. Los marcadores podrían estar congelados.`,
  });
  return json({ ok: false, window: true, lastSyncMinAgo: ageMin, alerted: true }, 503);
};
