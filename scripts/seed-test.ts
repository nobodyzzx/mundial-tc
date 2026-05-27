#!/usr/bin/env tsx
/**
 * scripts/seed-test.ts
 * Pobla un proyecto Supabase de PRUEBAS con fixture completo y verifica
 * que las reglas de puntaje funcionen correctamente.
 *
 * Escenarios cubiertos:
 *   Grupos:
 *     exacto → 3 pts | resultado → 1 pt | errado → 0 pts
 *   Knockout sin penales:
 *     exacto → 3 pts | resultado → 1 pt | errado → 0 pts
 *   Knockout con penales (empate en 90'):
 *     no pronostica empate                          → 0 pts
 *     empate + clasificado incorrecto               → 1 pt
 *     empate + clasificado correcto (sin exacto)    → 2 pts
 *     empate + marcador exacto + pen incorrecto     → 4 pts
 *     empate + marcador exacto + pen exacto         → 6 pts
 *   Jornada incompleta → 0 pts en esa jornada
 *   Tarjeta roja dentro de la ventana → 0 pts en esa jornada
 *
 * Uso:
 *   1. Crear proyecto Supabase de prueba en supabase.com
 *   2. Copiar .env.test.example → .env.test y rellenar las credenciales
 *   3. Aplicar migraciones: DATABASE_URL=... bash scripts/apply-migrations.sh
 *   4. pnpm tsx scripts/seed-test.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as fs from 'fs';

// ── Cargar .env.test ──────────────────────────────────────────

const envPath = path.resolve(process.cwd(), '.env.test');
if (!fs.existsSync(envPath)) {
  console.error('Error: .env.test no encontrado. Copia .env.test.example y rellena las credenciales del proyecto de prueba.');
  process.exit(1);
}
for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx === -1) continue;
  process.env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
}

const SUPABASE_URL = process.env.TEST_SUPABASE_URL;
const SERVICE_KEY  = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Error: TEST_SUPABASE_URL y TEST_SUPABASE_SERVICE_ROLE_KEY requeridos en .env.test');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function log(msg: string)  { console.log(`[seed] ${msg}`); }
function ok(msg: string)   { console.log(`[seed] ✓ ${msg}`); }
function fail(msg: string) { console.error(`[seed] ✗ ${msg}`); }

// ── 1. Limpiar datos de seed anteriores ──────────────────────

async function clean() {
  log('Limpiando datos de seed anteriores...');

  const { data: testProfiles } = await db.from('profiles')
    .select('id').like('username', 'test_%');

  if (testProfiles?.length) {
    const ids = testProfiles.map(p => p.id);
    await db.from('sanctions').delete().in('user_id', ids);
    await db.from('predictions').delete().in('user_id', ids);
    await db.from('profiles').delete().in('id', ids);
    for (const { id } of testProfiles) {
      await db.auth.admin.deleteUser(id);
    }
  }

  // Borra todos los partidos excepto el partido especial de prueba
  await db.from('matches').delete()
    .neq('id', 'a0000000-0000-0000-0000-000000000001');

  ok('Limpieza completa.');
}

// ── 2. Crear usuario de prueba ────────────────────────────────

interface Player { id: string; username: string; }

async function createUser(username: string, monto: number, esReferi = false): Promise<Player> {
  const email = `${username}@test.polla.local`;
  let userId: string;

  const { data: authData, error: authErr } = await db.auth.admin.createUser({
    email, password: 'Test1234!', email_confirm: true,
  });

  if (authErr) {
    if (authErr.message.includes('already been registered')) {
      const { data: list } = await db.auth.admin.listUsers();
      const existing = list?.users.find(u => u.email === email);
      if (!existing) { fail(`No se pudo recuperar usuario existente: ${email}`); process.exit(1); }
      userId = existing.id;
    } else {
      fail(`createUser ${email}: ${authErr.message}`); process.exit(1);
    }
  } else {
    userId = authData.user.id;
  }

  const { error: profErr } = await db.from('profiles').upsert(
    { id: userId, username, es_referi: esReferi, participa: !esReferi, monto_pagado: monto },
    { onConflict: 'id' },
  );
  if (profErr) { fail(`createProfile ${username}: ${profErr.message}`); process.exit(1); }

  return { id: userId, username };
}

// ── 3. Fixture de prueba ──────────────────────────────────────
//
// 10 partidos. Todos terminados excepto la Final.
//
// Resultados reales:
//   J1-1  México 2-1 Ecuador        (group, local gana)
//   J1-2  Argentina 0-0 Bolivia     (group, empate)
//   J2-1  Brasil 1-1 Colombia       (group, empate)
//   J2-2  Uruguay 3-2 Chile         (group, local gana)
//   QF-1  México 2-0 Colombia       (knockout sin penales, local gana)
//   QF-2  Argentina 1-1 Brasil      (knockout con penales, Arg gana 5-3)
//   SF-1  México 2-1 Argentina      (knockout sin penales, local gana)
//   SF-2  Colombia 0-0 Brasil       (knockout con penales, Col gana 4-3)
//   3PL   Argentina 1-0 Brasil      (knockout sin penales)
//   FINAL México vs Colombia        ← SIN TERMINAR

interface MatchDef {
  home_team: string; away_team: string;
  match_date: string; stage: string;
  group_name?: string; round?: string; jornada: string;
  home_score?: number; away_score?: number;
  home_pen?: number; away_pen?: number;
  winner_penalties?: string;
  is_finished: boolean; status: string;
}

const MATCHES: MatchDef[] = [
  { home_team:'México',    away_team:'Ecuador',   match_date:'2026-03-23 20:00:00+00', stage:'group',   group_name:'A',              jornada:'Jornada 1',    home_score:2, away_score:1, is_finished:true,  status:'FINISHED'  },
  { home_team:'Argentina', away_team:'Bolivia',   match_date:'2026-03-23 23:00:00+00', stage:'group',   group_name:'B',              jornada:'Jornada 1',    home_score:0, away_score:0, is_finished:true,  status:'FINISHED'  },
  { home_team:'Brasil',    away_team:'Colombia',  match_date:'2026-03-24 20:00:00+00', stage:'group',   group_name:'C',              jornada:'Jornada 2',    home_score:1, away_score:1, is_finished:true,  status:'FINISHED'  },
  { home_team:'Uruguay',   away_team:'Chile',     match_date:'2026-03-24 23:00:00+00', stage:'group',   group_name:'D',              jornada:'Jornada 2',    home_score:3, away_score:2, is_finished:true,  status:'FINISHED'  },
  { home_team:'México',    away_team:'Colombia',  match_date:'2026-03-25 20:00:00+00', stage:'knockout', round:'Cuartos',            jornada:'Cuartos',      home_score:2, away_score:0, is_finished:true,  status:'FINISHED'  },
  { home_team:'Argentina', away_team:'Brasil',    match_date:'2026-03-25 23:00:00+00', stage:'knockout', round:'Cuartos',            jornada:'Cuartos',      home_score:1, away_score:1, home_pen:5, away_pen:3, winner_penalties:'home', is_finished:true,  status:'FINISHED'  },
  { home_team:'México',    away_team:'Argentina', match_date:'2026-03-26 20:00:00+00', stage:'knockout', round:'Semifinal',          jornada:'Semifinal',    home_score:2, away_score:1, is_finished:true,  status:'FINISHED'  },
  { home_team:'Colombia',  away_team:'Brasil',    match_date:'2026-03-26 23:00:00+00', stage:'knockout', round:'Semifinal',          jornada:'Semifinal',    home_score:0, away_score:0, home_pen:4, away_pen:3, winner_penalties:'home', is_finished:true,  status:'FINISHED'  },
  { home_team:'Argentina', away_team:'Brasil',    match_date:'2026-03-27 20:00:00+00', stage:'knockout', round:'Tercer Puesto',       jornada:'Tercer Puesto',home_score:1, away_score:0, is_finished:true,  status:'FINISHED'  },
  { home_team:'México',    away_team:'Colombia',  match_date:'2026-03-28 23:00:00+00', stage:'knockout', round:'Final',              jornada:'Final',                                       is_finished:false, status:'SCHEDULED' },
];

// Claves de partido para las predicciones (home_team|jornada)
const J11 = 'México|Jornada 1';
const J12 = 'Argentina|Jornada 1';
const J21 = 'Brasil|Jornada 2';
const J22 = 'Uruguay|Jornada 2';
const QF1 = 'México|Cuartos';
const QF2 = 'Argentina|Cuartos';       // Arg 1-1 Bra, Arg gana 5-3
const SF1 = 'México|Semifinal';
const SF2 = 'Colombia|Semifinal';      // Col 0-0 Bra, Col gana 4-3
const TPL = 'Argentina|Tercer Puesto';
const FIN = 'México|Final';

async function seedFixture(): Promise<Map<string, string>> {
  log('Insertando fixture...');
  const matchIds = new Map<string, string>();

  for (const m of MATCHES) {
    const row: Record<string, unknown> = {
      home_team: m.home_team, away_team: m.away_team,
      match_date: m.match_date, stage: m.stage,
      jornada: m.jornada, is_finished: m.is_finished, status: m.status,
    };
    if (m.group_name)        row.group_name        = m.group_name;
    if (m.round)             row.round             = m.round;
    if (m.home_score != null) row.home_score       = m.home_score;
    if (m.away_score != null) row.away_score       = m.away_score;
    if (m.home_pen   != null) row.home_pen         = m.home_pen;
    if (m.away_pen   != null) row.away_pen         = m.away_pen;
    if (m.winner_penalties)  row.winner_penalties  = m.winner_penalties;

    const { data, error } = await db.from('matches').insert(row).select('id').single();
    if (error) { fail(`Fixture: ${m.home_team} vs ${m.away_team}: ${error.message}`); process.exit(1); }

    matchIds.set(`${m.home_team}|${m.jornada}`, data.id);
  }

  ok(`${MATCHES.length} partidos insertados.`);
  return matchIds;
}

// ── 4. Predicciones por escenario ────────────────────────────
//
// Regla de penales en knockout (cuando real_result = 'draw'):
//   v_exact_score     = predicción marcador exacta
//   v_exact_pen_score = predicción score de penales exacta
//   v_correct_pen     = acertó clasificado (por pen score o por winner_penalties legacy)
//
//   v_exact_score  AND v_exact_pen_score  → 6 pts
//   v_exact_score  AND !v_exact_pen_score → 4 pts
//   !v_exact_score AND v_correct_pen      → 2 pts
//   !v_exact_score AND !v_correct_pen     → 1 pt
//   usuario no pronosticó empate          → 0 pts
//
// Puntos de QF-2 (Argentina 1-1 Brasil, Arg 5-3 penales):
//   Pred 1-1 + pen 5-3       → exact+exact = 6 pts
//   Pred 1-1 + pen 5-4       → exact+wrong pen = 4 pts  (5>4 → Arg gana = correcto, pero score incorrecto)
//   Pred 2-2 + winner='home' → no-exact+correct = 2 pts
//   Pred 2-2 + winner='away' → no-exact+wrong  = 1 pt
//   Pred 2-1                 → no empate        = 0 pts
//
// Predicciones "base" que todos los jugadores hacen para partidos fuera de su escenario.
// Las bases dan puntos predecibles para no contaminar el escenario principal.
//   QF-1: 1-0 México → 1 pt   (resultado correcto)
//   SF-1: 1-0 México → 1 pt   (resultado correcto)
//   SF-2: 0-0 + Colombia winner (legacy) → 4 pts  (exact score + correct classified)
//   3PL:  1-0 Argentina → 3 pts  (exacto)
//   FIN:  1-0 México → sin calcular
// Base total (sin QF-2): QF1(1) + SF1(1) + SF2(4) + 3PL(3) = 9 pts

interface PredDef {
  key: string;
  home: number; away: number;
  homePen?: number | null; awayPen?: number | null;
  winnerPen?: string | null;
}

function basePreds(qf2: PredDef): PredDef[] {
  return [
    { key:QF1, home:1, away:0 },                                        // 1 pt
    qf2,
    { key:SF1, home:1, away:0 },                                        // 1 pt
    { key:SF2, home:0, away:0, winnerPen:'home' },                      // 4 pts (exact + legacy winner)
    { key:TPL, home:1, away:0 },                                        // 3 pts (exacto)
    { key:FIN, home:1, away:0 },                                        // sin calcular
  ];
}

interface Scenario {
  username: string;
  monto: number;
  description: string;
  preds: PredDef[];
  sanction?: { type: 'yellow'|'red'|'double_red'; jornada: string; reason: string };
  expectedTotal: number;
}

// Base points without QF2: QF1(1) + SF1(1) + SF2(4) + 3PL(3) = 9
const BASE = 9;

const SCENARIOS: Scenario[] = [
  // ── 1. EXACTO en grupos, QF2 = empate + clasificado sin exacto (2 pts) ──
  // Grupos exactos: J1(3+3) + J2(3+3) = 12; QF2 = 2; base = 9 → total = 23
  {
    username: 'test_exacto',
    monto: 120,
    description: 'Exacto en todos los grupos (12 pts). QF2: 2-2 + Arg gana = 2 pts.',
    expectedTotal: 12 + 2 + BASE,  // 23
    preds: [
      { key:J11, home:2, away:1 },  // exacto → 3
      { key:J12, home:0, away:0 },  // exacto → 3
      { key:J21, home:1, away:1 },  // exacto → 3
      { key:J22, home:3, away:2 },  // exacto → 3
      ...basePreds({ key:QF2, home:2, away:2, winnerPen:'home' }),  // QF2: 2-2 +Arg → 2 pts
    ],
  },

  // ── 2. RESULTADO correcto en grupos, QF2 = empate + clasificado incorrecto (1 pt) ──
  // Grupos resultado: J1(1+1) + J2(1+1) = 4; QF2 = 1; base = 9 → total = 14
  {
    username: 'test_resultado',
    monto: 120,
    description: 'Resultado correcto en grupos (4 pts). QF2: 2-2 + Brasil gana (incorrecto) = 1 pt.',
    expectedTotal: 4 + 1 + BASE,   // 14
    preds: [
      { key:J11, home:1, away:0 },  // home wins, correct → 1
      { key:J12, home:1, away:1 },  // draw, correct → 1
      { key:J21, home:2, away:2 },  // draw, correct → 1
      { key:J22, home:2, away:1 },  // home wins, correct → 1
      ...basePreds({ key:QF2, home:2, away:2, winnerPen:'away' }),  // QF2: 2-2 +Brasil → 1 pt
    ],
  },

  // ── 3. ERRADO en grupos, QF2 = no-empate (0 pts) ────────────────────────────────
  // Grupos errado: 0+0+0+0 = 0; QF2 = 0; base = 9 → total = 9
  {
    username: 'test_errado',
    monto: 120,
    description: 'Resultado incorrecto en grupos (0 pts). QF2: 2-1 (no empate) = 0 pts.',
    expectedTotal: 0 + 0 + BASE,   // 9
    preds: [
      { key:J11, home:0, away:1 },  // away wins, wrong → 0
      { key:J12, home:1, away:0 },  // home wins, wrong → 0
      { key:J21, home:1, away:0 },  // home wins, wrong → 0
      { key:J22, home:0, away:1 },  // away wins, wrong → 0
      ...basePreds({ key:QF2, home:2, away:1 }),  // QF2: 2-1 no-empate → 0 pts
    ],
  },

  // ── 4. TARDÍO: sin J1, J2 completa y exacta ──────────────────────────────────────
  // J1: 0 (no hay predicciones); J2-exacto: 3+3 = 6; QF2 = 2; base = 9 → total = 17
  {
    username: 'test_tardio',
    monto: 70,
    description: 'Sin predicciones de J1 (0 pts). J2 exacta (6 pts). QF2: 2 pts.',
    expectedTotal: 0 + 6 + 2 + BASE,  // 17
    preds: [
      // J1: sin predicciones (tardío)
      { key:J21, home:1, away:1 },  // exacto → 3
      { key:J22, home:3, away:2 },  // exacto → 3
      ...basePreds({ key:QF2, home:2, away:2, winnerPen:'home' }),  // QF2: 2 pts
    ],
  },

  // ── 5. INCOMPLETO: J1 completa/exacta, J2 incompleta (solo J2-1) ──────────────
  // J1-exacta: 3+3 = 6; J2-incompleta: 0 (ambas → 0); QF2 = 2; base = 9 → total = 17
  {
    username: 'test_incompleto',
    monto: 70,
    description: 'J1 exacta (6 pts). J2 incompleta: falta J2-2, J2-1 también → 0. QF2: 2 pts.',
    expectedTotal: 6 + 0 + 2 + BASE,  // 17
    preds: [
      { key:J11, home:2, away:1 },  // exacto → 3
      { key:J12, home:0, away:0 },  // exacto → 3
      { key:J21, home:1, away:1 },  // exacto pero J2 incompleta → 0
      // J22: sin predicción (jornada incompleta)
      ...basePreds({ key:QF2, home:2, away:2, winnerPen:'home' }),  // QF2: 2 pts
    ],
  },

  // ── 6. PEN 6 pts: QF2 exacto score + exacto penales ──────────────────────────
  // Grupos resultado: 4; QF2 = 6; base = 9 → total = 19
  {
    username: 'test_pen_6pts',
    monto: 120,
    description: 'QF2: pronostica 1-1 con Argentina 5-3 en penales → 6 pts.',
    expectedTotal: 4 + 6 + BASE,   // 19
    preds: [
      { key:J11, home:1, away:0 },
      { key:J12, home:1, away:1 },
      { key:J21, home:2, away:2 },
      { key:J22, home:2, away:1 },
      ...basePreds({ key:QF2, home:1, away:1, homePen:5, awayPen:3 }),  // 1-1 + 5-3 → 6 pts
    ],
  },

  // ── 7. PEN 4 pts: QF2 exacto score + pen score incorrecto ─────────────────────
  // Grupos resultado: 4; QF2 = 4; base = 9 → total = 17
  {
    username: 'test_pen_4pts',
    monto: 120,
    description: 'QF2: pronostica 1-1 con Argentina 5-4 en penales (score incorrecto) → 4 pts.',
    expectedTotal: 4 + 4 + BASE,   // 17
    preds: [
      { key:J11, home:1, away:0 },
      { key:J12, home:1, away:1 },
      { key:J21, home:2, away:2 },
      { key:J22, home:2, away:1 },
      ...basePreds({ key:QF2, home:1, away:1, homePen:5, awayPen:4 }),  // 1-1 + 5-4 → 4 pts (Arg gana, score pen incorrecto)
    ],
  },

  // ── 8. ROJO: tarjeta roja en Cuartos → QF1 y QF2 = 0 pts ────────────────────
  // Grupos resultado: 4; QF1 = 0 (roja); QF2 = 0 (roja); SF1+SF2+3PL = 8 → total = 12
  {
    username: 'test_rojo',
    monto: 120,
    description: 'Sanción roja en jornada Cuartos → QF1 y QF2 anulados (0 pts c/u).',
    sanction: { type: 'red', jornada: 'Cuartos', reason: 'Divulgó pronósticos antes del cierre' },
    expectedTotal: 4 + 0 + 0 + (BASE - 1),  // 12: base sin QF1 (1pt) + QF1=0 + QF2=0
    // BASE = QF1(1)+SF1(1)+SF2(4)+3PL(3) = 9; sin QF1 → 8
    preds: [
      { key:J11, home:1, away:0 },
      { key:J12, home:1, away:1 },
      { key:J21, home:2, away:2 },
      { key:J22, home:2, away:1 },
      ...basePreds({ key:QF2, home:1, away:1, winnerPen:'home' }),  // QF2 sería 2 pts pero roja → 0
    ],
  },
];

// ── 5. Insertar predicciones ──────────────────────────────────

async function seedPredictions(players: Player[], matchIds: Map<string, string>): Promise<void> {
  log('Insertando predicciones...');
  const rows: Record<string, unknown>[] = [];

  for (let i = 0; i < SCENARIOS.length; i++) {
    const sc = SCENARIOS[i];
    const p  = players[i];

    for (const pred of sc.preds) {
      const matchId = matchIds.get(pred.key);
      if (!matchId) { fail(`Match no encontrado para clave: ${pred.key}`); process.exit(1); }

      rows.push({
        user_id:               p.id,
        match_id:              matchId,
        user_home:             pred.home,
        user_away:             pred.away,
        user_home_pen:         pred.homePen ?? null,
        user_away_pen:         pred.awayPen ?? null,
        user_winner_penalties: pred.winnerPen ?? null,
      });
    }
  }

  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await db.from('predictions')
      .upsert(rows.slice(i, i + BATCH), { onConflict: 'user_id,match_id', ignoreDuplicates: true });
    if (error) { fail(`Insert predicciones: ${error.message}`); process.exit(1); }
  }

  ok(`${rows.length} predicciones insertadas.`);
}

// ── 6. Calcular puntos ────────────────────────────────────────

async function calcPoints(matchIds: Map<string, string>): Promise<void> {
  log('Calculando puntos...');
  let count = 0;

  for (const m of MATCHES) {
    if (!m.is_finished) continue;
    const matchId = matchIds.get(`${m.home_team}|${m.jornada}`);
    if (!matchId) continue;

    const { error } = await db.rpc('calculate_match_points_safe', { p_match_id: matchId });
    if (error) { fail(`calculate_match_points ${m.home_team} vs ${m.away_team}: ${error.message}`); process.exit(1); }
    count++;
  }

  ok(`Puntos calculados para ${count} partidos.`);
}

// ── 7. Aplicar sanciones y recalcular ────────────────────────

async function applySanctions(players: Player[], matchIds: Map<string, string>, refId: string): Promise<void> {
  const toSanction = SCENARIOS.filter(sc => sc.sanction);
  if (!toSanction.length) { log('Sin sanciones.'); return; }

  log('Aplicando sanciones...');

  for (let i = 0; i < SCENARIOS.length; i++) {
    const sc = SCENARIOS[i];
    if (!sc.sanction) continue;
    const p = players[i];

    // Timestampear la sanción dentro de la ventana de la jornada
    const jornadaMatches = MATCHES.filter(m => m.jornada === sc.sanction!.jornada && m.is_finished);
    if (!jornadaMatches.length) { fail(`No hay partidos para jornada ${sc.sanction.jornada}`); continue; }

    const refDate = new Date(jornadaMatches[0].match_date);
    refDate.setHours(refDate.getHours() + 1);  // +1h dentro de la ventana

    const { error: sErr } = await db.from('sanctions').insert({
      user_id:    p.id,
      type:       sc.sanction.type,
      reason:     sc.sanction.reason,
      active:     true,
      created_by: refId,
      created_at: refDate.toISOString(),
    });
    if (sErr) { fail(`Sanción ${sc.username}: ${sErr.message}`); continue; }

    // Recalcular los partidos de la jornada afectada para que el SQL aplique la sanción
    for (const m of jornadaMatches) {
      const matchId = matchIds.get(`${m.home_team}|${m.jornada}`);
      if (!matchId) continue;
      await db.rpc('calculate_match_points_safe', { p_match_id: matchId });
    }

    ok(`Sanción ${sc.sanction.type} → ${sc.username} (jornada: ${sc.sanction.jornada}).`);
  }
}

// ── 8. Reporte de validación ──────────────────────────────────

async function printReport(players: Player[]): Promise<void> {
  console.log('\n' + '─'.repeat(72));
  console.log('  REPORTE DE VALIDACIÓN — REGLAS DE PUNTAJE');
  console.log('─'.repeat(72));
  console.log('  Jugador               Esperado   Actual   Estado');
  console.log('─'.repeat(72));

  let allPassed = true;

  for (let i = 0; i < players.length; i++) {
    const p  = players[i];
    const sc = SCENARIOS[i];

    const { data: profile } = await db.from('profiles')
      .select('puntos_totales').eq('id', p.id).single();

    const actual   = profile?.puntos_totales ?? 0;
    const expected = sc.expectedTotal;
    const passed   = actual === expected;
    if (!passed) allPassed = false;

    const icon   = passed ? '✓' : '✗';
    const diff   = actual - expected;
    const diffStr = diff === 0 ? '' : `  (diff: ${diff > 0 ? '+' : ''}${diff})`;
    const name   = p.username.padEnd(22);
    const exp    = String(expected).padStart(6);
    const act    = String(actual).padStart(6);

    console.log(`  ${icon} ${name}  ${exp}   ${act}   ${passed ? 'PASS' : `FAIL${diffStr}`}`);
    if (!passed) console.log(`      → ${sc.description}`);
  }

  console.log('─'.repeat(72));

  if (allPassed) {
    console.log('  ✓ TODOS LOS ESCENARIOS CORRECTOS — reglas de scoring verificadas.\n');
  } else {
    console.log('  ✗ ALGUNOS ESCENARIOS FALLARON — revisar la lógica de scoring.\n');
    process.exitCode = 1;
  }
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('\n[seed] ══ Seed de pruebas — Polla Mundial 2026 ══\n');

  await clean();

  log('Creando usuarios...');
  const ref = await createUser('test_var', 0, true);
  ok(`Réferi: ${ref.username}`);

  const players: Player[] = [];
  for (const sc of SCENARIOS) {
    const p = await createUser(sc.username, sc.monto);
    players.push(p);
    ok(`${sc.username} (${sc.monto} Bs)`);
  }

  const matchIds = await seedFixture();
  await seedPredictions(players, matchIds);
  await calcPoints(matchIds);
  await applySanctions(players, matchIds, ref.id);
  await printReport(players);

  console.log('[seed] ══ Seed completo ══\n');
}

main().catch(err => {
  console.error('[seed] Error fatal:', err);
  process.exit(1);
});
