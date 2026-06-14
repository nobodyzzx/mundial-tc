/**
 * GET /api/cron/standings-announce
 *
 * Cuando un partido termina (is_finished), postea al grupo de WhatsApp el
 * resultado + la tabla de posiciones actualizada.
 *
 * Llamar desde cron-job.org cada ~10 min con ?secret=CRON_SECRET o header
 * Authorization: Bearer CRON_SECRET. Idempotente: registra cada partido
 * anunciado en sync_logs (source 'standings-announce', endpoint = match id) y
 * no repite. Solo considera partidos recientes para no anunciar el historial.
 *
 * ?preview=1 → arma el mensaje y lo devuelve SIN idempotencia ni envío.
 */
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@/lib/supabase';
import { spanishName, teamFlag } from '@/lib/isoFlags';
import { betaNowMs } from '@/lib/betaTime';
import { checkCronSecret, json } from '@/lib/cron';
import { sendWhatsApp } from '@/lib/whatsapp';

// Solo partidos cuyo inicio fue dentro de esta ventana (evita anunciar historial
// en el primer despliegue; un partido termina ~2h después de su match_date).
const RECENT_WINDOW_MS = 8 * 3600 * 1000;

export const GET: APIRoute = async ({ url, request }) => {
  if (!(await checkCronSecret(url, request))) return json({ error: 'Unauthorized' }, 401);

  const preview = url.searchParams.get('preview') === '1';
  const nowMs = betaNowMs();
  const sinceIso = new Date(nowMs - RECENT_WINDOW_MS).toISOString();

  // 1. Partidos terminados recientes.
  const { data: finishedMatches } = await supabaseAdmin
    .from('matches')
    .select('id, home_team, away_team, home_score, away_score, home_pen, away_pen, winner_penalties, match_date')
    .eq('is_finished', true)
    .gte('match_date', sinceIso)
    .order('match_date', { ascending: true });

  if (!finishedMatches?.length) return json({ skipped: true, reason: 'Sin partidos terminados recientes' });

  // 2. Filtrar los ya anunciados (idempotencia por partido).
  let newly = finishedMatches;
  if (!preview) {
    const { data: logs } = await supabaseAdmin
      .from('sync_logs')
      .select('endpoint')
      .eq('source', 'standings-announce')
      .is('error', null);
    const announced = new Set((logs ?? []).map(l => l.endpoint));
    newly = finishedMatches.filter(m => !announced.has(m.id));
  }

  if (!newly.length) return json({ skipped: true, reason: 'Nada nuevo que anunciar' });

  // 3. Asegurar que los puntos estén calculados (idempotente) antes de leer la tabla.
  if (!preview) {
    for (const m of newly) {
      await supabaseAdmin.rpc('calculate_match_points_safe', { p_match_id: m.id });
    }
  }

  // 4. Tabla de posiciones actualizada + puntos ganados en el/los partido(s) anunciados.
  const { data: standings } = await supabaseAdmin
    .from('profiles')
    .select('id, username, puntos_totales')
    .eq('participa', true)
    .eq('expulsado', false)
    .order('puntos_totales', { ascending: false });

  const { data: matchPreds } = await supabaseAdmin
    .from('predictions')
    .select('user_id, points_earned')
    .in('match_id', newly.map(m => m.id));

  const matchPts = new Map<string, number>();
  for (const pr of matchPreds ?? []) {
    matchPts.set(pr.user_id, (matchPts.get(pr.user_id) ?? 0) + (pr.points_earned ?? 0));
  }

  // 5. Construir mensaje.
  const resultLines = newly.map(m => {
    let s = `🏁 *TERMINÓ* · ${spanishName(m.home_team)} ${teamFlag(m.home_team)} ${m.home_score}–${m.away_score} ${teamFlag(m.away_team)} ${spanishName(m.away_team)}`;
    if (m.winner_penalties) {
      const w = m.winner_penalties === 'home' ? spanishName(m.home_team) : spanishName(m.away_team);
      const pen = (m.home_pen != null && m.away_pen != null) ? `${m.home_pen}–${m.away_pen} pen · ` : '';
      s += `\n  _(${pen}clasifica ${w})_`;
    }
    return s;
  });

  const tableLines = (standings ?? []).map((p, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    const gained = matchPts.get(p.id) ?? 0;
    const prev = p.puntos_totales - gained;
    return `${medal} ${p.username} — ${gained} + ${prev} = ${p.puntos_totales} pts`;
  });

  const text = [
    ...resultLines,
    '',
    '📊 *TABLA ACTUALIZADA*',
    '_este partido + acumulado = total_',
    ...tableLines,
    '',
    '👉 mundial.tecnocondor.dev/pronosticos',
    '_Polla Mundial 2026_ 🏆',
  ].join('\n');

  if (preview) {
    return json({ preview: true, finished: newly.map(m => m.id), text });
  }

  // 6. Enviar.
  const res = await sendWhatsApp(text, 'standings-announce');
  if (!res.configured) return json({ error: res.detail }, 500);

  // 7. Registrar cada partido (éxito sella la idempotencia; error → reintenta).
  await supabaseAdmin.from('sync_logs').insert(
    newly.map(m => ({
      source: 'standings-announce',
      endpoint: m.id,
      response_status: res.ok ? 200 : 502,
      matches_updated: newly.length,
      error: res.ok ? null : `Green API: ${res.detail}`.slice(0, 500),
    }))
  );

  if (!res.ok) return json({ error: 'Green API error', detail: res.detail }, 502);
  return json({ ok: true, announced: newly.map(m => `${m.home_team} ${m.home_score}-${m.away_score} ${m.away_team}`) });
};
