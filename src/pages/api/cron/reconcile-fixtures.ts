/**
 * GET /api/cron/reconcile-fixtures
 *
 * Alinea el calendario de FASE DE GRUPOS de la BD con api-football, dentro de la
 * ventana visible del free (~3 días). Misma fuente para calendario y marcadores →
 * sin discrepancias. Solo actúa con MATCH_PROVIDER=api-football.
 *
 * Candados de seguridad:
 *  - Nunca toca partidos terminados ni con pronósticos.
 *  - Deriva group_name del mapa equipo→grupo ya sembrado; si los dos equipos de un
 *    partido caen en grupos distintos (composición discrepante), lo MARCA y NO inserta.
 *  - Borra solo fantasmas sin pronósticos; un fantasma con pronósticos se marca.
 *
 * ?preview=1 → reporta el plan de cambios SIN escribir. Úsalo siempre antes de aplicar.
 */
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@/lib/supabase';
import { getFixturesRange } from '@/lib/providers/api-football';
import { mapStage } from '@/lib/football-api';
import { teamKey, normTeam } from '@/lib/match-link';
import { checkCronSecret, json } from '@/lib/cron';

const PROVIDER = (import.meta.env.MATCH_PROVIDER ?? 'football-data').toLowerCase();
const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);

export const GET: APIRoute = async ({ url, request }) => {
  if (!(await checkCronSecret(url, request))) return json({ error: 'Unauthorized' }, 401);
  if (PROVIDER !== 'api-football') return json({ skipped: true, reason: 'Solo con MATCH_PROVIDER=api-football' });
  const preview = url.searchParams.get('preview') === '1';

  // 1. Fixtures de grupo de api-football en la ventana hacia adelante (hoy..+2).
  let apiAll;
  try {
    apiAll = await getFixturesRange(0, 2);
  } catch (e: any) {
    return json({ error: 'API-Football: ' + e.message }, 502);
  }
  const apiGroup = apiAll.filter((f) => mapStage(f.stage) === 'group');
  if (!apiGroup.length) return json({ skipped: true, reason: 'Sin fixtures de grupo en la ventana' });
  const apiDates = new Set(apiGroup.map((f) => utcDay(f.utcDate)));

  // 2. Partidos de grupo de la BD.
  const { data: dbGroupAll } = await supabaseAdmin
    .from('matches')
    .select('id, home_team, away_team, match_date, group_name, is_finished')
    .eq('stage', 'group');
  const all: any[] = dbGroupAll ?? [];

  // Mapas normalizados: equipo→grupo y equipo→nombre canónico de la app.
  const teamGroup = new Map<string, string>();
  const canonName = new Map<string, string>();
  for (const m of all) {
    if (m.group_name) {
      teamGroup.set(normTeam(m.home_team), m.group_name);
      teamGroup.set(normTeam(m.away_team), m.group_name);
    }
    canonName.set(normTeam(m.home_team), m.home_team);
    canonName.set(normTeam(m.away_team), m.away_team);
  }

  const dbWindow = all.filter((m) => apiDates.has(utcDay(m.match_date)));
  const dbByTeams = new Map<string, any>();
  for (const m of dbWindow) dbByTeams.set(teamKey(m.home_team, m.away_team), m);

  // Pronósticos en la ventana (no tocar partidos con pronósticos).
  const winIds = dbWindow.map((m) => m.id);
  const predCount = new Map<string, number>();
  if (winIds.length) {
    const { data: preds } = await supabaseAdmin.from('predictions').select('match_id').in('match_id', winIds);
    for (const p of preds ?? []) predCount.set(p.match_id, (predCount.get(p.match_id) ?? 0) + 1);
  }

  const inserts: any[] = [];
  const updates: any[] = [];
  const flags: any[] = [];
  const matchedDbIds = new Set<string>();

  for (const f of apiGroup) {
    const db = dbByTeams.get(teamKey(f.homeTeam.name, f.awayTeam.name));
    if (db) {
      matchedDbIds.add(db.id);
      if (Math.abs(Date.parse(db.match_date) - Date.parse(f.utcDate)) >= 60000) {
        updates.push({ id: db.id, teams: `${db.home_team} vs ${db.away_team}`, from: db.match_date, to: f.utcDate });
      }
      continue;
    }
    // api tiene un partido que la BD no tiene con esos equipos → candidato a insertar.
    const home = canonName.get(normTeam(f.homeTeam.name)) ?? f.homeTeam.name;
    const away = canonName.get(normTeam(f.awayTeam.name)) ?? f.awayTeam.name;
    const gh = teamGroup.get(normTeam(f.homeTeam.name));
    const ga = teamGroup.get(normTeam(f.awayTeam.name));
    if (!gh || !ga || gh !== ga) {
      flags.push({ tipo: 'grupo-discrepante', partido: `${home} vs ${away}`, fecha: f.utcDate, grupo_home: gh ?? '?', grupo_away: ga ?? '?' });
      continue; // no insertar a ciegas
    }
    inserts.push({
      external_id: f.id,
      match_date: f.utcDate,
      stage: 'group',
      group_name: gh,
      round: null,
      jornada: `Jornada ${f.matchday ?? 1}`,
      home_team: home,
      away_team: away,
      home_score: f.score.fullTime.home,
      away_score: f.score.fullTime.away,
      is_finished: f.status === 'FINISHED',
    });
  }

  // Fantasmas: en la ventana, no terminados, no emparejados por la api.
  const toDelete = dbWindow
    .filter((m) => !matchedDbIds.has(m.id) && !m.is_finished && (predCount.get(m.id) ?? 0) === 0)
    .map((m) => ({ id: m.id, partido: `${m.home_team} vs ${m.away_team}`, fecha: m.match_date }));
  for (const m of dbWindow) {
    if (!matchedDbIds.has(m.id) && !m.is_finished && (predCount.get(m.id) ?? 0) > 0) {
      flags.push({ tipo: 'fantasma-con-pronosticos', partido: `${m.home_team} vs ${m.away_team}`, fecha: m.match_date, pronosticos: predCount.get(m.id) });
    }
  }

  const plan = {
    ventana: [...apiDates].sort(),
    insertar: inserts.map((r) => `${r.home_team} vs ${r.away_team} @ ${r.match_date} (Grupo ${r.group_name})`),
    actualizar_hora: updates,
    borrar: toDelete,
    alertas: flags,
  };

  if (preview) return json({ preview: true, ...plan });

  // Aplicar.
  const applied = { insertados: 0, actualizados: 0, borrados: 0 };
  if (inserts.length) {
    const { error } = await supabaseAdmin.from('matches').upsert(inserts, { onConflict: 'external_id' });
    if (!error) applied.insertados = inserts.length;
  }
  for (const u of updates) {
    const { error } = await supabaseAdmin.from('matches').update({ match_date: u.to }).eq('id', u.id);
    if (!error) applied.actualizados++;
  }
  if (toDelete.length) {
    const { error } = await supabaseAdmin.from('matches').delete().in('id', toDelete.map((d) => d.id));
    if (!error) applied.borrados = toDelete.length;
  }

  return json({ ok: true, ...applied, alertas: flags, plan });
};
