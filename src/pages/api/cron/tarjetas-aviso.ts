/**
 * GET /api/cron/tarjetas-aviso
 *
 * Aviso diario de tarjetas por WhatsApp (Green API). Reemplaza al botón manual
 * que existía en el dashboard. Pensado para cron-job.org cada ~30–60 min:
 * envía UNA vez al día, ~3 horas antes del primer partido del día Bolivia,
 * la lista de sancionados de esa jornada (rojas = jornada anulada, amarillas).
 *
 * - Idempotente por día (sync_logs source='tarjetas-aviso', endpoint=YYYY-MM-DD).
 * - Si no hay tarjetas ese día, NO envía (no sella idempotencia → un tick
 *   posterior dentro de la ventana sí enviaría si aparece una tarjeta).
 * - ?preview=1 → arma el mensaje y lo devuelve sin chequear ventana/idempotencia
 *   ni enviarlo.
 */
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@/lib/supabase';
import { boliviaDayStart } from '@/lib/jornada';
import { betaNowMs } from '@/lib/betaTime';
import { fmtFecha, fmtDiaKey } from '@/lib/fechas';
import { sendWhatsApp } from '@/lib/whatsapp';
import { checkCronSecret, json } from '@/lib/cron';

const SEND_BEFORE_MS = 3 * 3600 * 1000; // 3 horas antes del primer partido
const MIN_LEAD_MS = 30 * 60 * 1000;     // no enviar si faltan <30 min (aviso tardío)

export const GET: APIRoute = async ({ url, request }) => {
  if (!(await checkCronSecret(url, request))) return json({ error: 'Unauthorized' }, 401);
  const preview = url.searchParams.get('preview') === '1';

  const nowMs = betaNowMs();
  const nowIso = new Date(nowMs).toISOString();

  // 1. Próximo partido no terminado → define la jornada candidata.
  const { data: nextRows } = await supabaseAdmin
    .from('matches')
    .select('match_date')
    .eq('is_finished', false)
    .gt('match_date', nowIso)
    .order('match_date', { ascending: true })
    .limit(1);

  const firstUpcoming = nextRows?.[0];
  if (!firstUpcoming) return json({ skipped: true, reason: 'Sin partidos próximos' });

  // 2. Ventana del día Bolivia (frontera 03:00 BOT) de ese partido.
  const dayStart = boliviaDayStart(new Date(firstUpcoming.match_date).getTime());
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

  const { data: dayMatches } = await supabaseAdmin
    .from('matches')
    .select('match_date')
    .gte('match_date', dayStart.toISOString())
    .lt('match_date', dayEnd.toISOString())
    .order('match_date', { ascending: true });

  if (!dayMatches?.length) return json({ skipped: true, reason: 'Sin partidos en la jornada' });

  const firstTime = Math.min(...dayMatches.map((m) => new Date(m.match_date).getTime()));
  const sendAtMs = firstTime - SEND_BEFORE_MS;
  const dayKey = fmtDiaKey(firstTime);

  if (!preview) {
    // 3. Ventana: a partir del momento "3h antes" y hasta 30 min antes del partido.
    if (nowMs < sendAtMs) {
      return json({ skipped: true, reason: 'Aún temprano', minutesToSend: Math.round((sendAtMs - nowMs) / 60000) });
    }
    if (nowMs >= firstTime - MIN_LEAD_MS) {
      return json({ skipped: true, reason: 'Demasiado tarde para el aviso del día' });
    }

    // 4. Idempotencia: ¿ya se envió el aviso de esta jornada?
    const { data: alreadySent } = await supabaseAdmin
      .from('sync_logs')
      .select('id')
      .eq('source', 'tarjetas-aviso')
      .eq('endpoint', dayKey)
      .is('error', null)
      .limit(1);

    if (alreadySent?.length) {
      return json({ skipped: true, reason: 'Aviso ya enviado para esta jornada', dayKey });
    }
  }

  // 5. Tarjetas (sanciones activas) que afectan a ESTE día Bolivia, por game_day
  //    (la jornada castigada); una tarjeta retroactiva se registra otro día.
  const { data: allSanctions } = await supabaseAdmin
    .from('sanctions')
    .select('user_id, type, created_at, game_day')
    .eq('active', true);
  const sanctions = (allSanctions ?? []).filter(s => {
    const eff = new Date(s.game_day ?? s.created_at).getTime();
    return eff >= dayStart.getTime() && eff < dayEnd.getTime();
  });

  const sanctionMap = new Map<string, { yellows: number; reds: number }>();
  for (const s of sanctions ?? []) {
    const cur = sanctionMap.get(s.user_id) ?? { yellows: 0, reds: 0 };
    if (s.type === 'yellow') cur.yellows++;
    else if (s.type === 'red' || s.type === 'double_red') cur.reds++;
    sanctionMap.set(s.user_id, cur);
  }

  const ids = [...sanctionMap.keys()];
  if (!ids.length) return json({ skipped: true, reason: 'Sin tarjetas hoy', dayKey });

  // 6. Nombres (excluye expulsados, igual que el resto de la app). Rojas primero.
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, username')
    .in('id', ids)
    .eq('expulsado', false);

  const items = (profiles ?? [])
    .map((p) => ({ username: p.username as string, ...(sanctionMap.get(p.id) ?? { yellows: 0, reds: 0 }) }))
    .filter((x) => x.yellows > 0 || x.reds > 0)
    .sort((a, b) => b.reds - a.reds || b.yellows - a.yellows);

  if (!items.length) return json({ skipped: true, reason: 'Sin tarjetas hoy (tras filtrar)', dayKey });

  // 7. Mensaje (mismo formato que tenía el botón del dashboard).
  const dayLabel = fmtFecha(dayStart, { weekday: 'long', day: 'numeric', month: 'long' });
  const lines = ['🟨🟥 *TARJETAS DE HOY*', `_${dayLabel}_`, ''];
  for (const it of items) {
    if (it.reds > 0) lines.push(`🟥 ${it.username} — jornada anulada`);
    else lines.push(`${'🟨'.repeat(it.yellows)} ${it.username}`);
  }
  lines.push('', '_Polla Mundial 2026_ 🏆');
  const text = lines.join('\n');

  if (preview) return json({ preview: true, dayKey, tarjetas: items.length, text });

  // 8. Enviar por Green API y sellar idempotencia.
  const r = await sendWhatsApp(text, 'tarjetas-aviso');
  await supabaseAdmin.from('sync_logs').insert({
    source: 'tarjetas-aviso',
    endpoint: dayKey,
    response_status: r.ok ? 200 : 502,
    matches_updated: 0,
    error: r.ok ? null : `Green API: ${r.detail}`.slice(0, 500),
  });

  if (!r.ok) return json({ error: 'Green API error', detail: r.detail }, 502);
  return json({ ok: true, dayKey, tarjetas: items.length });
};
