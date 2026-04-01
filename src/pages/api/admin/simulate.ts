import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getAdminUser } from '@/lib/auth-helpers';

function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randScore(r: () => number): number {
  const v = r();
  if (v < 0.30) return 0;
  if (v < 0.60) return 1;
  if (v < 0.85) return 2;
  if (v < 0.95) return 3;
  return 4;
}

// El jugador "estrella" tiene tendencia a acertar
function biasedPred(rng: () => number, hs: number | null, as_: number | null) {
  if (hs === null || as_ === null) return { h: randScore(rng), a: randScore(rng) };
  const r = rng();
  if (r < 0.40) return { h: hs, a: as_ };                               // exacto
  if (r < 0.65) {                                                        // resultado correcto
    const off = rng() > 0.5 ? 1 : 0;
    if (hs > as_)  return { h: hs + off, a: Math.max(0, as_ - off) };
    if (as_ > hs)  return { h: Math.max(0, hs - off), a: as_ + off };
    return { h: hs, a: as_ };
  }
  return { h: randScore(rng), a: randScore(rng) };
}

export const POST: APIRoute = async ({ cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  const { data: players } = await supabaseAdmin
    .from('profiles').select('id, username')
    .eq('es_referi', false).order('created_at', { ascending: true });

  const { data: allMatches } = await supabaseAdmin
    .from('matches')
    .select('id, stage, jornada, is_finished, match_date, home_score, away_score, winner_penalties')
    .order('match_date', { ascending: true });

  if (!players?.length)    return redirect(`/admin?err=${encodeURIComponent('No hay jugadores registrados')}`);
  if (!allMatches?.length) return redirect(`/admin?err=${encodeURIComponent('Carga los datos de prueba primero')}`);

  const n = players.length;
  const now = Date.now();

  // Clasificar partidos según su estado temporal
  const finished:  typeof allMatches = [];
  const openSoon:  typeof allMatches = []; // abierto: >2h
  const closedPre: typeof allMatches = []; // cerrado pre-partido: <2h, sin terminar

  for (const m of allMatches) {
    const matchTime = new Date(m.match_date).getTime();
    const diff = matchTime - now; // ms hasta el partido
    if (m.is_finished) {
      finished.push(m);
    } else if (diff <= 0) {
      finished.push(m);   // pasado sin resultado → tratar como terminado para generar pronósticos
    } else if (diff > 2 * 3_600_000) {
      openSoon.push(m);   // >2h → abierto
    } else {
      closedPre.push(m);  // <2h → cerrado pero no jugado aún
    }
  }

  // Agrupar terminados por jornada (orden cronológico)
  const finishedByJornada = new Map<string, typeof allMatches>();
  for (const m of finished) {
    const k = m.jornada ?? 'Sin jornada';
    if (!finishedByJornada.has(k)) finishedByJornada.set(k, []);
    finishedByJornada.get(k)!.push(m);
  }
  const jornadaKeys = [...finishedByJornada.keys()];
  const j1Key = jornadaKeys[0];
  const j2Key = jornadaKeys[1] ?? null;
  const j3Key = jornadaKeys[jornadaKeys.length - 1]; // más reciente

  // ── Escenarios ────────────────────────────────────────────
  //
  //  ESTRELLA    (1):  Todo pronosticado + alta precisión
  //  REGULAR     (≈25%): Todo pronosticado, precisión normal
  //  TARDÍO      (≈15%): Se perdió J1 (fuera de horario al registrarse)
  //  INCOMPLETO  (≈15%): J2 incompleta → esa jornada = 0 pts
  //  SIN_J3      (≈10%): No pronosticó J3 (olvidó, estaba ocupado)
  //  AMARILLA    (≈10%): Todo pronosticado + recibe 🟨
  //  ROJA_J3     (≈10%): Todo pronosticado + 🟥 en J3 (reciente) → J3 = 0
  //  DOBLE_ROJA  (≈10%): J1+J2 pronosticados + 🟥🟥 → expulsado, J2 = 0
  //  CASUAL      (resto): Todo pronosticado, aleatorio
  //
  type Scenario = 'ESTRELLA'|'REGULAR'|'TARDÍO'|'INCOMPLETO'|'SIN_J3'|'AMARILLA'|'ROJA_J3'|'DOBLE_ROJA'|'CASUAL';

  function assign(i: number): Scenario {
    if (i === 0) return 'ESTRELLA';
    const pct = i / Math.max(n - 1, 1);
    if (pct < 0.25) return 'REGULAR';
    if (pct < 0.38) return 'TARDÍO';
    if (pct < 0.51) return 'INCOMPLETO';
    if (pct < 0.61) return 'SIN_J3';
    if (pct < 0.71) return 'AMARILLA';
    if (pct < 0.81) return 'ROJA_J3';
    if (pct < 0.91) return 'DOBLE_ROJA';
    return 'CASUAL';
  }

  const scenarios = players.map((_, i) => assign(i));
  const predRows: any[] = [];

  for (let pi = 0; pi < n; pi++) {
    const player = players[pi];
    const sc = scenarios[pi];
    const rng = makeRng(pi * 1337 + 7);

    // ── Partidos terminados ──────────────────────────────
    for (const [jKey, jMatches] of finishedByJornada) {
      let toPredict = [...jMatches];

      if (sc === 'TARDÍO'     && jKey === j1Key) toPredict = [];
      if (sc === 'INCOMPLETO' && jKey === j2Key) toPredict = jMatches.slice(0, Math.max(1, jMatches.length - 1));
      if (sc === 'SIN_J3'     && jKey === j3Key) toPredict = [];
      if (sc === 'DOBLE_ROJA' && jKey === j3Key) toPredict = [];

      for (const m of toPredict) {
        const { h, a } = sc === 'ESTRELLA'
          ? biasedPred(rng, m.home_score, m.away_score)
          : { h: randScore(rng), a: randScore(rng) };

        // Penales en fase eliminatoria
        let homePen: number | null = null;
        let awayPen: number | null = null;
        let winnerPen: string | null = null;
        if (m.stage === 'knockout') {
          // Siempre predecir ganador en penales (por si acaso empatan)
          if (sc === 'ESTRELLA' && m.winner_penalties) {
            // Estrella acerta 70% del tiempo
            winnerPen = rng() < 0.70 ? m.winner_penalties : (m.winner_penalties === 'home' ? 'away' : 'home');
          } else {
            winnerPen = rng() < 0.5 ? 'home' : 'away';
          }
          // Si predice empate, también genera marcador de penales
          if (h === a) {
            homePen = 3 + Math.floor(rng() * 4);
            awayPen = 3 + Math.floor(rng() * 4);
            if (homePen === awayPen) awayPen++;
            winnerPen = homePen > awayPen ? 'home' : 'away';
          }
        }

        predRows.push({ user_id: player.id, match_id: m.id, user_home: h, user_away: a,
          user_home_pen: homePen, user_away_pen: awayPen, user_winner_penalties: winnerPen });
      }
    }

    // ── Cuartos (abierto: algunos ya pronosticaron) ───────
    //  ESTRELLA, REGULAR y AMARILLA ya enviaron sus pronósticos
    //  → muestra tarjetas verdes + bloqueadas en el formulario
    const earlyBirds: Scenario[] = ['ESTRELLA', 'REGULAR', 'AMARILLA'];
    if (earlyBirds.includes(sc)) {
      for (const m of openSoon) {
        const h = randScore(rng);
        const a = randScore(rng);
        let homePen: number | null = null;
        let awayPen: number | null = null;
        let winnerPen: string | null = null;
        if (m.stage === 'knockout' && h === a) {
          homePen = 3 + Math.floor(rng() * 4);
          awayPen = 3 + Math.floor(rng() * 4);
          if (homePen === awayPen) awayPen++;
          winnerPen = homePen > awayPen ? 'home' : 'away';
        }
        predRows.push({ user_id: player.id, match_id: m.id,
          user_home: h, user_away: a,
          user_home_pen: homePen, user_away_pen: awayPen, user_winner_penalties: winnerPen });
      }
    }
    // Los demás no han pronosticado Cuartos aún → verán el formulario con tarjetas rojas
  }

  // ── Insertar pronósticos ──────────────────────────────────
  const BATCH = 50;
  for (let i = 0; i < predRows.length; i += BATCH) {
    const { error } = await supabaseAdmin.from('predictions')
      .upsert(predRows.slice(i, i + BATCH), { onConflict: 'user_id,match_id', ignoreDuplicates: true });
    if (error) return redirect(`/admin?err=${encodeURIComponent('Error pronósticos: ' + error.message)}`);
  }

  // ── Calcular puntos (solo terminados) ─────────────────────
  for (const m of finished) {
    await supabaseAdmin.rpc('calculate_match_points_safe', { p_match_id: m.id });
  }

  // ── Sanciones ─────────────────────────────────────────────
  const sanctionRows: any[] = [];
  const redJ3Ids:     string[] = [];
  const doubleRedIds: string[] = [];

  for (let pi = 0; pi < n; pi++) {
    const p = players[pi];
    const sc = scenarios[pi];
    if (sc === 'AMARILLA')   sanctionRows.push({ user_id:p.id, type:'yellow',     reason:'Lenguaje inapropiado en el chat grupal',       active:true, created_by:admin.user.id });
    if (sc === 'ROJA_J3')    { sanctionRows.push({ user_id:p.id, type:'red',       reason:'Pronósticos publicados antes del cierre',       active:true, created_by:admin.user.id }); redJ3Ids.push(p.id); }
    if (sc === 'DOBLE_ROJA') { sanctionRows.push({ user_id:p.id, type:'double_red',reason:'Uso de información privilegiada — expulsión',   active:true, created_by:admin.user.id }); doubleRedIds.push(p.id); }
  }

  if (sanctionRows.length) await supabaseAdmin.from('sanctions').insert(sanctionRows);
  if (doubleRedIds.length) await supabaseAdmin.from('profiles').update({ expulsado:true }).in('id', doubleRedIds);

  // Roja J3: recalcular J3 — la ventana SQL incluye "ahora" (partidos hace 1-2h)
  if (redJ3Ids.length) {
    for (const m of finishedByJornada.get(j3Key) ?? []) {
      await supabaseAdmin.rpc('calculate_match_points_safe', { p_match_id: m.id });
    }
  }

  // Doble roja J2: ventana SQL expiró (48h atrás) → anular manualmente
  if (doubleRedIds.length && j2Key) {
    for (const m of finishedByJornada.get(j2Key) ?? []) {
      await supabaseAdmin.from('predictions')
        .update({ points_earned: 0 })
        .eq('match_id', m.id)
        .in('user_id', doubleRedIds);
    }
  }

  // ── Recalcular puntos_totales ─────────────────────────────
  for (const player of players) {
    const { data: preds } = await supabaseAdmin
      .from('predictions').select('points_earned').eq('user_id', player.id);
    const total = (preds ?? []).reduce((s, r) => s + (r.points_earned ?? 0), 0);
    await supabaseAdmin.from('profiles').update({ puntos_totales: total }).eq('id', player.id);
  }

  // ── Pagos variados ────────────────────────────────────────
  for (let pi = 0; pi < n; pi++) {
    const rng = makeRng(pi * 999 + 1);
    const r = rng();
    await supabaseAdmin.from('profiles')
      .update({ pago_70: r > 0.20, pago_50: r > 0.55 })
      .eq('id', players[pi].id);
  }

  // ── Resumen ───────────────────────────────────────────────
  const count = (s: Scenario) => scenarios.filter(x => x === s).length;
  const summary = [
    `${n} jugadores`,
    `${predRows.length} pronósticos`,
    count('TARDÍO')     ? `${count('TARDÍO')} sin J1 (tarde)`       : '',
    count('INCOMPLETO') ? `${count('INCOMPLETO')} J2 incompleta`     : '',
    count('SIN_J3')     ? `${count('SIN_J3')} sin J3`               : '',
    count('AMARILLA')   ? `${count('AMARILLA')} 🟨`                  : '',
    count('ROJA_J3')    ? `${count('ROJA_J3')} 🟥 J3`               : '',
    count('DOBLE_ROJA') ? `${count('DOBLE_ROJA')} 🟥🟥 expulsado`   : '',
  ].filter(Boolean).join(' · ');

  return redirect(`/admin?msg=${encodeURIComponent('Simulación completa · ' + summary)}`);
};
