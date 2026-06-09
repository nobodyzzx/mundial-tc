#!/usr/bin/env tsx
/**
 * scripts/seed-tutorial.ts
 * Pobla el proyecto de PRUEBA para grabar tutoriales.
 *
 * Estado simulado: INICIO DE LA PRIMERA JORNADA
 *   - 4 partidos próximos (Jornada 1), sin resultados
 *   - 8 jugadores con 0 pts y SIN predicciones → flujo de "primera vez"
 *   - VAR: Yeye
 *
 * Flujos cubiertos:
 *   1. Cambiar contraseña (login con Mundial2026 → cambiar en perfil)
 *   2. Ingresar pronósticos de Jornada 1 + compartir por WhatsApp
 *
 * Uso:
 *   pnpm tsx scripts/seed-tutorial.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as fs from 'fs';

// ── Cargar .env.test ──────────────────────────────────────────

const envPath = path.resolve(process.cwd(), '.env.test');
if (!fs.existsSync(envPath)) {
  console.error('Error: .env.test no encontrado.');
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

const DOMAIN   = '@tutorial.polla.local';
const PASSWORD = 'Mundial2026';

function log(msg: string)  { console.log(`[tutorial] ${msg}`); }
function ok(msg: string)   { console.log(`[tutorial] ✓ ${msg}`); }
function fail(msg: string) { console.error(`[tutorial] ✗ ${msg}`); }

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_');
}

// ── 1. Limpiar ────────────────────────────────────────────────

async function clean() {
  log('Limpiando datos de tutorial anteriores...');

  // Eliminar en orden para evitar bloqueos por FK
  await db.from('sanctions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await db.from('predictions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await db.from('matches').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  ok('Partidos y predicciones eliminados.');

  const { data: authData } = await db.auth.admin.listUsers({ perPage: 1000 });
  const tutorialUsers = (authData?.users ?? []).filter(u => u.email?.endsWith(DOMAIN));

  if (tutorialUsers.length) {
    const ids = tutorialUsers.map(u => u.id);
    await db.from('profiles').delete().in('id', ids);
    for (const { id } of tutorialUsers) {
      await db.auth.admin.deleteUser(id);
    }
    ok(`${tutorialUsers.length} usuarios de tutorial eliminados.`);
  }

  // Limpiar perfiles huérfanos de seeds anteriores
  await db.from('profiles').delete().like('username', 'test_%');
}

// ── 2. Crear usuario ──────────────────────────────────────────

interface Player { id: string; username: string; }

async function createUser(username: string, monto: number, esReferi = false): Promise<Player> {
  const email = `${toSlug(username)}${DOMAIN}`;
  let userId: string;

  const { data: authData, error: authErr } = await db.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
  });

  if (authErr) {
    if (authErr.message.includes('already been registered')) {
      const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
      const existing = list?.users.find(u => u.email === email);
      if (!existing) { fail(`No se pudo recuperar usuario: ${email}`); process.exit(1); }
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

// ── 3. Fixture ────────────────────────────────────────────────
//
// 4 partidos de Jornada 1 terminados + 1 Cuartos de Final abierto.
// La Jornada 1 se marca como terminada para que el partido de
// eliminatorias no quede bloqueado por la lógica de "jornada anterior abierta".

const MATCHES = [
  {
    home_team: 'México',    away_team: 'Ecuador',
    match_date: '2026-06-12 21:00:00+00',
    stage: 'group', group_name: 'A', jornada: 'Jornada 1',
    home_score: 2, away_score: 1,
    is_finished: true, status: 'FINISHED',
  },
  {
    home_team: 'Argentina', away_team: 'Bolivia',
    match_date: '2026-06-12 18:00:00+00',
    stage: 'group', group_name: 'B', jornada: 'Jornada 1',
    home_score: 0, away_score: 0,
    is_finished: true, status: 'FINISHED',
  },
  {
    home_team: 'Brasil',    away_team: 'Colombia',
    match_date: '2026-06-13 21:00:00+00',
    stage: 'group', group_name: 'C', jornada: 'Jornada 1',
    home_score: 1, away_score: 1,
    is_finished: true, status: 'FINISHED',
  },
  {
    home_team: 'Uruguay',   away_team: 'Chile',
    match_date: '2026-06-13 18:00:00+00',
    stage: 'group', group_name: 'D', jornada: 'Jornada 1',
    home_score: 3, away_score: 2,
    is_finished: true, status: 'FINISHED',
  },
  {
    home_team: 'México',    away_team: 'Argentina',
    match_date: '2026-06-15 21:00:00+00',
    stage: 'knockout', round: 'Cuartos de Final', jornada: 'Cuartos de Final',
    is_finished: false, status: 'SCHEDULED',
  },
];

async function seedFixture(): Promise<Map<string, string>> {
  log('Insertando fixture...');
  const matchIds = new Map<string, string>();

  for (const m of MATCHES) {
    const row: Record<string, unknown> = {
      home_team: m.home_team, away_team: m.away_team,
      match_date: m.match_date, stage: m.stage,
      jornada: m.jornada, is_finished: m.is_finished, status: m.status,
    };
    if (m.group_name)         row.group_name  = m.group_name;
    if (m.round)              row.round        = m.round;
    if ('home_score' in m)    row.home_score   = m.home_score;
    if ('away_score' in m)    row.away_score   = m.away_score;

    const { data, error } = await db.from('matches').insert(row).select('id').single();
    if (error) { fail(`Fixture: ${m.home_team} vs ${m.away_team}: ${error.message}`); process.exit(1); }
    matchIds.set(`${m.home_team}|${m.jornada}`, data.id);
  }

  ok(`${MATCHES.length} partidos insertados.`);
  return matchIds;
}

// ── 4. Predicciones de Jornada 1 ─────────────────────────────
//
// Resultados reales:
//   México 2-1 Ecuador     → local gana
//   Argentina 0-0 Bolivia  → empate
//   Brasil 1-1 Colombia    → empate
//   Uruguay 3-2 Chile      → local gana

const J1_PREDS: Record<string, [number, number][]> = {
  //              MéxEcu  ArgBol  BraCol  UruChi
  Pedro:   [[2,1],[0,0],[1,1],[3,2]],  // todo exacto → 7+7+7+7 = 28 pts
  Sofía:   [[2,0],[0,0],[1,1],[2,1]],  // 3 resultado + 1 exacto
  Jorge:   [[1,0],[1,0],[2,1],[2,1]],  // 1 exacto resto errado
  Ana:     [[2,1],[1,0],[0,0],[3,2]],  // 2 exacto 1 result 1 errado
  Luis:    [[1,0],[0,1],[1,1],[3,2]],  // mixto
  Carlos:  [[0,1],[1,1],[0,0],[1,0]],  // solo 1 result
  Roberto: [[0,1],[1,1],[2,0],[1,0]],  // casi todo errado
  María:   [[0,2],[1,1],[0,1],[0,1]],  // todo errado
};

async function seedPredictions(players: { id: string; username: string }[], matchIds: Map<string, string>): Promise<void> {
  log('Insertando predicciones de Jornada 1...');

  const J1_KEYS = [
    'México|Jornada 1',
    'Argentina|Jornada 1',
    'Brasil|Jornada 1',
    'Uruguay|Jornada 1',
  ];

  const rows: Record<string, unknown>[] = [];
  for (const p of players) {
    const preds = J1_PREDS[p.username];
    if (!preds) continue;
    for (let i = 0; i < J1_KEYS.length; i++) {
      const matchId = matchIds.get(J1_KEYS[i]);
      if (!matchId) continue;
      rows.push({ user_id: p.id, match_id: matchId, user_home: preds[i][0], user_away: preds[i][1] });
    }
  }

  const { error } = await db.from('predictions').insert(rows);
  if (error) { fail(`Predicciones: ${error.message}`); process.exit(1); }
  ok(`${rows.length} predicciones insertadas.`);
}

async function calcPoints(matchIds: Map<string, string>): Promise<void> {
  log('Calculando puntos...');
  const finishedKeys = ['México|Jornada 1', 'Argentina|Jornada 1', 'Brasil|Jornada 1', 'Uruguay|Jornada 1'];
  for (const key of finishedKeys) {
    const matchId = matchIds.get(key);
    if (!matchId) continue;
    const { error } = await db.rpc('calculate_match_points_safe', { p_match_id: matchId });
    if (error) { fail(`calcPoints ${key}: ${error.message}`); }
  }
  ok('Puntos calculados.');
}

// ── 5. Resumen ────────────────────────────────────────────────

async function printSummary() {
  console.log('\n' + '─'.repeat(60));
  console.log('  TABLA TUTORIAL');
  console.log('─'.repeat(60));

  const { data: profiles } = await db
    .from('profiles')
    .select('username, puntos_totales')
    .eq('participa', true)
    .order('puntos_totales', { ascending: false });

  for (const p of profiles ?? []) {
    console.log(`    ${p.username.padEnd(10)}  ${p.puntos_totales} pts`);
  }

  console.log('\n  Credenciales (contraseña: Mundial2026):');
  const PLAYERS = ['Pedro', 'Carlos', 'María', 'Jorge', 'Ana', 'Sofía', 'Luis', 'Roberto'];
  for (const name of PLAYERS) {
    console.log(`    ${name.padEnd(10)}  ${toSlug(name)}${DOMAIN}`);
  }
  console.log(`    ${'Yeye'.padEnd(10)}  yeye${DOMAIN}  (VAR/Réferi)`);
  console.log('─'.repeat(60) + '\n');
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('\n[tutorial] ══ Seed tutorial — Primera Jornada ══\n');

  await clean();

  log('Creando usuarios...');
  await createUser('Yeye', 0, true);
  ok('VAR: Yeye');

  const PLAYERS = [
    { name: 'Pedro',   monto: 120 },
    { name: 'Carlos',  monto: 120 },
    { name: 'María',   monto: 120 },
    { name: 'Jorge',   monto:  70 },
    { name: 'Ana',     monto:  70 },
    { name: 'Sofía',   monto: 120 },
    { name: 'Luis',    monto: 120 },
    { name: 'Roberto', monto: 120 },
  ];

  const players: { id: string; username: string }[] = [];
  for (const p of PLAYERS) {
    const player = await createUser(p.name, p.monto);
    players.push(player);
    ok(`${p.name}  (${toSlug(p.name)}${DOMAIN})`);
  }

  const matchIds = await seedFixture();
  await seedPredictions(players, matchIds);
  await calcPoints(matchIds);
  await printSummary();

  console.log('[tutorial] ══ Seed completo — listo para grabar ══\n');
}

main().catch(err => {
  console.error('[tutorial] Error fatal:', err);
  process.exit(1);
});
