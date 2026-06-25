/**
 * GET /api/cron/resolve-bracket
 *
 * Rellena los placeholders de posición del cuadro ("1A", "2B", …) con los equipos
 * reales en cuanto el grupo cierra, calculando la tabla desde la BD con desempate
 * OLÍMPICO (pts → diferencia de goles → goles a favor). Independiente del proveedor:
 * no usa nombres ni horarios de ESPN (que no calzan con los sembrados), solo resultados.
 *
 * Candados:
 *  - Solo grupos cerrados (6 partidos jugados). Plaza en disputa → no se toca.
 *  - Solo reescribe lados que siguen siendo placeholder (no renombra equipos reales).
 *  - Nunca toca partidos terminados.
 *  - Empate olímpico irresoluble (pts=dg=gf) → se reporta como alerta, no se resuelve.
 *
 * ?preview=1 → reporta el plan SIN escribir. Úsalo siempre antes de aplicar.
 *
 * (Pendiente: terceros — códigos "3ABCDF" — requieren el cierre de los 12 grupos y la
 * tabla oficial de asignación FIFA; y W##/L## se resuelven con resultados de llaves.)
 */
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@/lib/supabase';
import { resolveGroupCodes, resolveThirdPlaceCodes, type GroupMatch } from '@/lib/bracket';
import { isPlaceholderName } from '@/lib/match-link';
import { checkCronSecret, json } from '@/lib/cron';

export const GET: APIRoute = async ({ url, request }) => {
  if (!(await checkCronSecret(url, request))) return json({ error: 'Unauthorized' }, 401);
  const preview = url.searchParams.get('preview') === '1';

  // 1. Tablas de grupo → códigos de posición resueltos.
  const { data: groupRows } = await supabaseAdmin
    .from('matches')
    .select('group_name, home_team, away_team, home_score, away_score, is_finished')
    .eq('stage', 'group');
  const groups = (groupRows ?? []) as GroupMatch[];
  const { codes, ambiguous, closed } = resolveGroupCodes(groups);

  // Terceros (slots "3CEFHI"…): solo con los 12 grupos cerrados + tabla FIFA.
  const thirds = resolveThirdPlaceCodes(groups);
  for (const [slot, team] of thirds.codes) codes.set(slot, team);

  if (!codes.size) {
    return json({ ok: true, skipped: true, reason: 'Sin grupos cerrados que resolver', ambiguous, closed, terceros: thirds.blocked });
  }

  // 2. Partidos de eliminatoria con algún lado aún placeholder.
  const { data: koRows } = await supabaseAdmin
    .from('matches')
    .select('id, round, home_team, away_team, match_date, is_finished')
    .eq('stage', 'knockout')
    .eq('is_finished', false);

  const updates: { id: string; round: string; field: 'home_team' | 'away_team'; from: string; to: string }[] = [];
  for (const m of koRows ?? []) {
    if (isPlaceholderName(m.home_team) && codes.has(m.home_team))
      updates.push({ id: m.id, round: m.round, field: 'home_team', from: m.home_team, to: codes.get(m.home_team)! });
    if (isPlaceholderName(m.away_team) && codes.has(m.away_team))
      updates.push({ id: m.id, round: m.round, field: 'away_team', from: m.away_team, to: codes.get(m.away_team)! });
  }

  const plan = {
    grupos_cerrados: closed.sort(),
    terceros: thirds.blocked ?? 'resueltos',
    codigos: Object.fromEntries([...codes.entries()].sort()),
    cambios: updates.map((u) => `${u.round}: ${u.from} → ${u.to}`),
    alertas: ambiguous,
  };

  if (preview) return json({ preview: true, ...plan });

  // 3. Aplicar (un update por celda; el volumen es mínimo).
  let applied = 0;
  for (const u of updates) {
    const { error } = await supabaseAdmin.from('matches').update({ [u.field]: u.to }).eq('id', u.id);
    if (!error) applied++;
  }

  return json({ ok: true, aplicados: applied, ...plan });
};
