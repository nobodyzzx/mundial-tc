/**
 * GET /api/cron/dia-pronosticos
 *
 * Postea al grupo de WhatsApp los pronósticos de TODOS para el día de juego,
 * una vez que las apuestas ya cerraron (1h55m antes del primer partido = 5 min
 * después del cierre). Es el "botón Día" automatizado.
 *
 * Llamar desde cron-job.org cada ~15–30 min con ?secret=CRON_SECRET o
 * header Authorization: Bearer CRON_SECRET. Idempotente: registra el envío en
 * sync_logs (source 'dia-pronosticos', endpoint = fecha del día) y no repite.
 *
 * ?preview=1 → arma el mensaje y lo devuelve SIN ventana/idempotencia ni envío.
 */
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@/lib/supabase';
import { spanishName, teamFlag } from '@/lib/isoFlags';
import { boliviaDayStart, REVEAL_BEFORE_MS } from '@/lib/jornada';
import { betaNowMs } from '@/lib/betaTime';
import { fmtFecha, fmtDiaKey } from '@/lib/fechas';
import { checkCronSecret, json } from '@/lib/cron';
import { sendWhatsApp } from '@/lib/whatsapp';

// Revelación (REVEAL_BEFORE_MS) centralizada en lib/jornada.ts: 1h55m antes del
// primer partido = 5 min después del cierre. Igual que la página /pronosticos.

const fmtTime = (iso: string) => fmtFecha(iso, { hour: '2-digit', minute: '2-digit' });

export const GET: APIRoute = async ({ url, request }) => {
  if (!(await checkCronSecret(url, request))) return json({ error: 'Unauthorized' }, 401);

  const preview = url.searchParams.get('preview') === '1';
  const nowMs = betaNowMs();
  const nowIso = new Date(nowMs).toISOString();

  // 1. Próximo partido no terminado → define el día candidato.
  const { data: nextRows } = await supabaseAdmin
    .from('matches')
    .select('match_date')
    .eq('is_finished', false)
    .gt('match_date', nowIso)
    .order('match_date', { ascending: true })
    .limit(1);

  const firstUpcoming = nextRows?.[0];
  if (!firstUpcoming) return json({ skipped: true, reason: 'Sin partidos próximos' });

  // 2. Todos los partidos de ese día Bolivia.
  const dayStart = boliviaDayStart(new Date(firstUpcoming.match_date).getTime());
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

  const { data: dayMatches } = await supabaseAdmin
    .from('matches')
    .select('id, home_team, away_team, match_date, stage')
    .gte('match_date', dayStart.toISOString())
    .lt('match_date', dayEnd.toISOString())
    .order('match_date', { ascending: true });

  if (!dayMatches?.length) return json({ skipped: true, reason: 'Sin partidos en el día' });

  const firstTime = Math.min(...dayMatches.map(m => new Date(m.match_date).getTime()));
  const revealMs = firstTime - REVEAL_BEFORE_MS;
  const dayKey = fmtDiaKey(firstTime);
  const dayLabel = fmtFecha(dayStart, { weekday: 'long', day: 'numeric', month: 'long' });

  if (!preview) {
    // 3. Ventana: solo tras la revelación (apuestas ya cerradas).
    if (nowMs < revealMs) {
      return json({ skipped: true, reason: 'Aún no se revela', minutesToReveal: Math.round((revealMs - nowMs) / 60000) });
    }
    // 4. Idempotencia.
    const { data: alreadySent } = await supabaseAdmin
      .from('sync_logs')
      .select('id')
      .eq('source', 'dia-pronosticos')
      .eq('endpoint', dayKey)
      .is('error', null)
      .limit(1);
    if (alreadySent?.length) return json({ skipped: true, reason: 'Ya enviado para este día', dayKey });
  }

  // 5. Participantes + pronósticos del día.
  const { data: participants } = await supabaseAdmin
    .from('profiles')
    .select('id, username')
    .eq('participa', true)
    .eq('expulsado', false)
    .order('username', { ascending: true });

  const dayIds = dayMatches.map(m => m.id);
  const { data: preds } = await supabaseAdmin
    .from('predictions')
    .select('user_id, match_id, user_home, user_away, user_winner_penalties')
    .in('match_id', dayIds);

  const predMap = new Map<string, any>();
  for (const pr of preds ?? []) predMap.set(`${pr.match_id}:${pr.user_id}`, pr);

  // Sancionados (roja del día Bolivia): su jornada está anulada, se marcan aparte.
  const { data: dayCards } = await supabaseAdmin
    .from('sanctions')
    .select('user_id')
    .in('type', ['red', 'double_red'])
    .eq('active', true)
    .gte('created_at', dayStart.toISOString())
    .lt('created_at', dayEnd.toISOString());
  const sanctionedIds = new Set((dayCards ?? []).map(c => c.user_id));

  // 6. Construir mensaje.
  const lines: string[] = [
    `📊 *PRONÓSTICOS DE HOY · ${dayLabel}*`,
    '_Apuestas cerradas 🔒 — esto puso cada uno_',
    '',
  ];
  for (const m of dayMatches) {
    lines.push(`⚽ *${spanishName(m.home_team)} ${teamFlag(m.home_team)} vs ${teamFlag(m.away_team)} ${spanishName(m.away_team)}* · ${fmtTime(m.match_date)}`);
    const picks = (participants ?? [])
      .filter(p => !sanctionedIds.has(p.id))
      .map(p => {
        const pr = predMap.get(`${m.id}:${p.id}`);
        if (!pr) return null;
        let s = `${p.username} ${pr.user_home}–${pr.user_away}`;
        if (pr.user_home === pr.user_away && pr.user_winner_penalties) {
          const w = pr.user_winner_penalties === 'home' ? spanishName(m.home_team) : spanishName(m.away_team);
          s += ` (pen ${w})`;
        }
        return s;
      })
      .filter(Boolean) as string[];
    lines.push(picks.length ? `  ${picks.join(' · ')}` : '  _(nadie pronosticó)_');
    const missing = (participants ?? [])
      .filter(p => !sanctionedIds.has(p.id) && !predMap.has(`${m.id}:${p.id}`))
      .map(p => p.username);
    if (missing.length) lines.push(`  💀 Sin pronóstico: ${missing.join(', ')}`);
    lines.push('');
  }
  const sanctionedNames = (participants ?? [])
    .filter(p => sanctionedIds.has(p.id))
    .map(p => p.username);
  if (sanctionedNames.length) {
    lines.push(`🟥 *Jornada anulada (roja):* ${sanctionedNames.join(', ')}`);
    lines.push('');
  }
  lines.push('👉 mundial.tecnocondor.dev/pronosticos');
  lines.push('_Polla Mundial 2026_ 🏆');
  const text = lines.join('\n');

  if (preview) {
    return json({ preview: true, dayKey, reveal: new Date(revealMs).toISOString(), matches: dayMatches.length, text });
  }

  // 7. Enviar.
  const res = await sendWhatsApp(text);
  if (!res.configured) return json({ error: res.detail }, 500);

  await supabaseAdmin.from('sync_logs').insert({
    source: 'dia-pronosticos',
    endpoint: dayKey,
    response_status: res.ok ? 200 : 502,
    matches_updated: 0,
    error: res.ok ? null : `Green API: ${res.detail}`.slice(0, 500),
  });

  if (!res.ok) return json({ error: 'Green API error', detail: res.detail }, 502);
  return json({ ok: true, dayKey, matches: dayMatches.length });
};
