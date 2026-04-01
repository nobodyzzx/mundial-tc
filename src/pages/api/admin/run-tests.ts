/**
 * Test suite para verificar que el reglamento se aplica correctamente.
 * Crea partidos/pronósticos de prueba, calcula puntos, verifica resultados y limpia.
 */
import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getAdminUser } from '@/lib/auth-helpers';

interface TestResult {
  id: string;
  name: string;
  description: string;
  expected: number;
  actual: number | null;
  passed: boolean;
  note?: string;
}

export const POST: APIRoute = async ({ cookies }) => {
  // ── Auth ────────────────────────────────────────────────
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return json({ error: 'No autorizado' }, 401);

  // ── Jugadores disponibles ────────────────────────────────
  const { data: players } = await supabaseAdmin
    .from('profiles').select('id, username').eq('es_referi', false).limit(10);

  if (!players || players.length < 2) {
    return json({ error: 'Se necesitan al menos 2 jugadores registrados para correr los tests.' });
  }

  const p = (i: number) => players[i % players.length];
  const now = new Date();
  const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

  // ── Definición de partidos de prueba ─────────────────────
  //
  //  Cada partido tiene su propia jornada (TEST_XX) para aislar las reglas
  //  salvo T15 (jornada incompleta) que comparte TEST_15, y T16 (sanción)
  //  que usa una fecha reciente para que el window de sanción incluya "ahora".
  //
  const matchDefs = [
    // id        stage       hs  as  hp     ap     wp       jornada    hoursAgo
    ['T01', 'group',    2,  1,  null,  null,  null,  'TEST_01', 48],
    ['T02', 'group',    2,  1,  null,  null,  null,  'TEST_02', 48],
    ['T03', 'group',    2,  1,  null,  null,  null,  'TEST_03', 48],
    ['T04', 'group',    1,  1,  null,  null,  null,  'TEST_04', 48],
    ['T05', 'group',    1,  1,  null,  null,  null,  'TEST_05', 48],
    ['T06', 'group',    1,  1,  null,  null,  null,  'TEST_06', 48],
    ['T07', 'knockout', 2,  1,  null,  null,  null,  'TEST_07', 48],
    ['T08', 'knockout', 2,  1,  null,  null,  null,  'TEST_08', 48],
    ['T09', 'knockout', 2,  1,  null,  null,  null,  'TEST_09', 48],
    ['T10', 'knockout', 1,  1,  5,     3,    'home', 'TEST_10', 48],
    ['T11', 'knockout', 1,  1,  5,     3,    'home', 'TEST_11', 48],
    ['T12', 'knockout', 1,  1,  5,     3,    'home', 'TEST_12', 48],
    ['T13', 'knockout', 1,  1,  5,     3,    'home', 'TEST_13', 48],
    ['T14', 'knockout', 1,  1,  5,     3,    'home', 'TEST_14', 48],
    // Jornada incompleta: 2 partidos en TEST_15
    ['T15a', 'group',   2,  0,  null,  null,  null,  'TEST_15', 48],
    ['T15b', 'group',   1,  1,  null,  null,  null,  'TEST_15', 47.5],
    // Sanción: match reciente (window incluye ahora)
    ['T16', 'group',    2,  1,  null,  null,  null,  'TEST_16', 1],
  ] as const;

  const matchRows = matchDefs.map(([label, stage, hs, as_, hp, ap, wp, jornada, h]) => ({
    home_team:        `Local_${label}`,
    away_team:        `Visit_${label}`,
    match_date:       ago(h),
    stage,
    group_name:       stage === 'group' ? 'T' : null,
    round:            stage === 'knockout' ? 'TEST' : null,
    jornada,
    home_score:       hs,
    away_score:       as_,
    home_pen:         hp ?? null,
    away_pen:         ap ?? null,
    winner_penalties: wp ?? null,
    is_finished:      true,
  }));

  const { data: inserted, error: matchErr } = await supabaseAdmin
    .from('matches').insert(matchRows).select('id, jornada');

  if (matchErr || !inserted) {
    return json({ error: 'Error creando partidos de prueba: ' + matchErr?.message });
  }

  // Map label → matchId
  const mid = new Map<string, string>();
  matchDefs.forEach(([label], i) => mid.set(label, inserted[i].id));

  // ── Pronósticos a insertar ───────────────────────────────
  //
  //  Cada test usa un player distinto (ciclando) para aislar los puntos.
  //  T15: playerA (p0) pronostica ambos → completo · playerB (p1) solo T15a → incompleto
  //  T16: p2 pronostica exacto, luego recibe tarjeta roja → debería quedar en 0
  //
  const predDefs: {
    label: string; userId: string;
    uh: number; ua: number;
    uhp?: number | null; uap?: number | null; uwp?: string | null;
  }[] = [
    // ── GRUPO ───────────────────────────────────────────────────────────
    { label: 'T01', userId: p(0).id,  uh: 2, ua: 1 },                              // marcador exacto → 3
    { label: 'T02', userId: p(1).id,  uh: 3, ua: 1 },                              // resultado correcto → 1
    { label: 'T03', userId: p(2).id,  uh: 0, ua: 1 },                              // resultado incorrecto → 0
    { label: 'T04', userId: p(3).id,  uh: 1, ua: 1 },                              // empate exacto → 3
    { label: 'T05', userId: p(4).id,  uh: 2, ua: 2 },                              // empate correcto → 1
    { label: 'T06', userId: p(5).id,  uh: 1, ua: 0 },                              // predice local gana, real empate → 0
    // ── ELIMINATORIA SIN PENALES ─────────────────────────────────────────
    { label: 'T07', userId: p(0).id,  uh: 2, ua: 1 },                              // marcador exacto → 3
    { label: 'T08', userId: p(1).id,  uh: 3, ua: 1 },                              // ganador correcto → 1
    { label: 'T09', userId: p(2).id,  uh: 0, ua: 1 },                              // ganador incorrecto → 0
    // ── ELIMINATORIA CON PENALES (real: 1-1, pen 5-3, gana local) ────────
    { label: 'T10', userId: p(3).id,  uh: 1, ua: 1, uhp: 5, uap: 3, uwp: 'home' }, // score exacto + pen exactos → 6
    { label: 'T11', userId: p(4).id,  uh: 1, ua: 1, uhp: 4, uap: 2, uwp: 'home' }, // score exacto + pen incorrectos (pero gana mismo) → 4
    { label: 'T12', userId: p(5).id,  uh: 2, ua: 2, uhp: 5, uap: 3, uwp: 'home' }, // score incorrecto + ganador pen correcto → 2
    { label: 'T13', userId: p(0).id,  uh: 2, ua: 2, uhp: 3, uap: 5, uwp: 'away' }, // score incorrecto + ganador pen incorrecto → 1
    { label: 'T14', userId: p(1).id,  uh: 1, ua: 0 },                              // no predice empate → 0
    // ── JORNADA INCOMPLETA ───────────────────────────────────────────────
    { label: 'T15a', userId: p(0).id, uh: 2, ua: 0 },  // playerA: predice T15a exacto
    { label: 'T15b', userId: p(0).id, uh: 1, ua: 1 },  // playerA: predice T15b exacto → jornada completa → 3 pts c/u
    { label: 'T15a', userId: p(2).id, uh: 2, ua: 0 },  // playerB: solo predice T15a → jornada incompleta → 0 pts
    // ── TARJETA ROJA ─────────────────────────────────────────────────────
    { label: 'T16', userId: p(3).id,  uh: 2, ua: 1 },  // exacto (3 pts) pero roja → 0
  ];

  // Construir rows evitando duplicados (mismo userId+matchId podría ocurrir si players.length < 6)
  const seen = new Set<string>();
  const predRows: any[] = [];
  for (const d of predDefs) {
    const key = `${d.userId}:${mid.get(d.label)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    predRows.push({
      user_id:               d.userId,
      match_id:              mid.get(d.label),
      user_home:             d.uh,
      user_away:             d.ua,
      user_home_pen:         d.uhp ?? null,
      user_away_pen:         d.uap ?? null,
      user_winner_penalties: d.uwp ?? null,
    });
  }

  const { error: predErr } = await supabaseAdmin.from('predictions').insert(predRows);
  if (predErr) {
    await cleanup(mid);
    return json({ error: 'Error insertando pronósticos: ' + predErr.message });
  }

  // ── Tarjeta roja para T16 ────────────────────────────────
  const { error: sanctErr } = await supabaseAdmin.from('sanctions').insert({
    user_id:    p(3).id,
    type:       'red',
    reason:     'TEST_T16: sanción de prueba',
    active:     true,
    created_by: admin.user.id,
  });
  if (sanctErr) {
    await cleanup(mid);
    return json({ error: 'Error insertando sanción: ' + sanctErr.message });
  }

  // ── Calcular puntos para todos los partidos de prueba ────
  for (const [, matchId] of mid) {
    await supabaseAdmin.rpc('calculate_match_points_safe', { p_match_id: matchId });
  }

  // ── Leer resultados ──────────────────────────────────────
  const matchIds = [...mid.values()];
  const { data: results } = await supabaseAdmin
    .from('predictions')
    .select('user_id, match_id, points_earned')
    .in('match_id', matchIds);

  // matchId → userId → points
  const pts = new Map<string, Map<string, number | null>>();
  for (const r of results ?? []) {
    if (!pts.has(r.match_id)) pts.set(r.match_id, new Map());
    pts.get(r.match_id)!.set(r.user_id, r.points_earned);
  }

  function actual(label: string, playerIdx: number): number | null {
    const matchId = mid.get(label);
    if (!matchId) return null;
    return pts.get(matchId)?.get(p(playerIdx).id) ?? null;
  }

  // ── Verificar resultados ─────────────────────────────────
  const tests: TestResult[] = [
    // Grupo
    { id: 'T01', name: 'Grupo: marcador exacto',         description: 'Predice 2-1 · real 2-1',           expected: 3, actual: actual('T01', 0) },
    { id: 'T02', name: 'Grupo: resultado correcto',      description: 'Predice 3-1 · real 2-1',           expected: 1, actual: actual('T02', 1) },
    { id: 'T03', name: 'Grupo: resultado incorrecto',    description: 'Predice 0-1 · real 2-1',           expected: 0, actual: actual('T03', 2) },
    { id: 'T04', name: 'Grupo: empate exacto',           description: 'Predice 1-1 · real 1-1',           expected: 3, actual: actual('T04', 3) },
    { id: 'T05', name: 'Grupo: empate correcto',         description: 'Predice 2-2 · real 1-1',           expected: 1, actual: actual('T05', 4) },
    { id: 'T06', name: 'Grupo: predice victoria, real empate', description: 'Predice 1-0 · real 1-1',    expected: 0, actual: actual('T06', 5) },
    // Eliminatoria sin penales
    { id: 'T07', name: 'Elim.: marcador exacto',         description: 'Predice 2-1 · real 2-1',           expected: 3, actual: actual('T07', 0) },
    { id: 'T08', name: 'Elim.: ganador correcto',        description: 'Predice 3-1 · real 2-1',           expected: 1, actual: actual('T08', 1) },
    { id: 'T09', name: 'Elim.: ganador incorrecto',      description: 'Predice 0-1 · real 2-1',           expected: 0, actual: actual('T09', 2) },
    // Eliminatoria con penales
    { id: 'T10', name: 'Pen.: score exacto + pen exactos',    description: 'Predice 1-1 (5-3) · real 1-1 (5-3)', expected: 6, actual: actual('T10', 3) },
    { id: 'T11', name: 'Pen.: score exacto + pen incorrectos', description: 'Predice 1-1 (4-2) · real 1-1 (5-3)', expected: 4, actual: actual('T11', 4) },
    { id: 'T12', name: 'Pen.: score incorrecto + ganador correcto', description: 'Predice 2-2 · real 1-1, gana local', expected: 2, actual: actual('T12', 5) },
    { id: 'T13', name: 'Pen.: score incorrecto + ganador incorrecto', description: 'Predice 2-2 · real 1-1, gana visitante', expected: 1, actual: actual('T13', 0) },
    { id: 'T14', name: 'Pen.: no predice empate',        description: 'Predice 1-0 · real 1-1 (empate)',  expected: 0, actual: actual('T14', 1) },
    // Regla jornada incompleta
    { id: 'T15_ok',   name: 'Jornada completa → puntos normales',   description: `${p(0).username} pronostica 2/2 partidos`, expected: 3, actual: actual('T15a', 0) },
    { id: 'T15_zero', name: 'Jornada incompleta → 0 pts',           description: `${p(2).username} pronostica 1/2 partidos`, expected: 0, actual: actual('T15a', 2) },
    // Sanción roja
    { id: 'T16', name: 'Tarjeta roja → 0 pts aunque acierte',       description: `${p(3).username} marcador exacto + roja`, expected: 0, actual: actual('T16', 3) },
  ];

  for (const t of tests) {
    t.passed = t.actual === t.expected;
    if (t.actual === null) {
      t.note = 'Sin datos (posible player duplicado en test)';
      t.passed = false;
    }
  }

  const passed = tests.filter(t => t.passed).length;

  // ── Limpieza ─────────────────────────────────────────────
  await cleanup(mid);

  // Recalcular puntos_totales desde cero para no dejar residuos
  const { data: allPlayers } = await supabaseAdmin
    .from('profiles').select('id').eq('es_referi', false);
  for (const player of allPlayers ?? []) {
    const { data: preds } = await supabaseAdmin
      .from('predictions').select('points_earned').eq('user_id', player.id);
    const total = (preds ?? []).reduce((a, r) => a + (r.points_earned ?? 0), 0);
    await supabaseAdmin.from('profiles').update({ puntos_totales: total }).eq('id', player.id);
  }

  return json({ passed, total: tests.length, tests });
};

async function cleanup(mid: Map<string, string>) {
  const matchIds = [...mid.values()];
  if (!matchIds.length) return;

  // Borrar sanciones de prueba
  await supabaseAdmin.from('sanctions').delete().like('reason', 'TEST_%');
  // Borrar predicciones de prueba
  await supabaseAdmin.from('predictions').delete().in('match_id', matchIds);
  // Borrar partidos de prueba
  await supabaseAdmin.from('matches').delete().like('jornada', 'TEST_%');
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
