/**
 * Eventos en vivo Nivel 1: avisa al grupo de WhatsApp cuando un partido ARRANCA
 * y cuando hay un GOL (con goleador, minuto, penal/autogol cuando el proveedor lo
 * expone). Se alimenta de los fixtures que `sync` ya trajo del proveedor — NO hace
 * ninguna llamada extra a la API: sync sigue siendo el único que lo toca.
 *
 * Idempotencia y timeline: cada evento es una fila en `match_events`
 *   - arranque: type='kickoff' (0-0, una vez por partido)
 *   - gol:      type='goal' con el marcador alcanzado (cada gol da un par (h,a)
 *               único dentro del partido) + goleador/minuto.
 * Índice único (match_id, type, home_score, away_score) → no duplica.
 *
 * dryRun: arma los mensajes y los devuelve SIN enviar ni escribir (para preview).
 * Best-effort: nunca lanza ni rompe el sync. Devuelve los textos (enviados o, en
 * dryRun, los que se enviarían).
 */
import type { ApiMatch, GoalEvent } from './match-types';
import { supabaseAdmin } from './supabase';
import { linkMatches, type DbMatchRow } from './match-link';
import { spanishName, teamFlag } from './isoFlags';
import { sendWhatsApp } from './whatsapp';

type EventRow = {
  match_id: string;
  type: 'kickoff' | 'goal' | 'halftime';
  home_score: number;
  away_score: number;
  scorer?: string | null;
  minute?: string | null;
  penalty?: boolean;
  own_goal?: boolean;
};

async function exists(matchId: string, type: string, h: number, a: number): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('match_events')
    .select('id')
    .eq('match_id', matchId)
    .eq('type', type)
    .eq('home_score', h)
    .eq('away_score', a)
    .limit(1);
  return !!data?.length;
}

/**
 * Reclama un evento de forma ATÓMICA: INSERT ... ON CONFLICT DO NOTHING.
 * Devuelve el id de la fila si ESTA llamada la insertó (ganó la carrera), o null
 * si ya existía (otra corrida concurrente la reclamó). Así, con varios `sync`
 * simultáneos, solo uno envía el aviso. Evita el doble envío que el chequeo
 * "consultar y luego actuar" no podía evitar.
 */
async function claim(row: EventRow): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('match_events')
    .upsert(row, { onConflict: 'match_id,type,home_score,away_score', ignoreDuplicates: true })
    .select('id');
  if (error || !data?.length) return null;
  return data[0].id;
}

/** Último marcador de gol ya registrado (fallback sin lista de goles). */
async function prevGoalScore(matchId: string): Promise<{ h: number; a: number }> {
  const { data } = await supabaseAdmin
    .from('match_events')
    .select('home_score, away_score')
    .eq('match_id', matchId)
    .eq('type', 'goal')
    .order('created_at', { ascending: false })
    .limit(1);
  const r = data?.[0];
  return r ? { h: r.home_score, a: r.away_score } : { h: 0, a: 0 };
}

/**
 * Contexto del gol según el marcador previo: abre / empata / rompe el empate /
 * amplía / descuenta. Se deriva del marcador (no requiere datos extra). Cadena
 * vacía si no aporta (no debería pasar con un gol que cambia el score en 1).
 */
function goalContext(prevH: number, prevA: number, h: number, a: number): string {
  const homeScored = h > prevH;
  const sFor = homeScored ? h : a;             // goles del que anotó (después)
  const sAgainst = homeScored ? a : h;
  const bFor = sFor - 1, bAgainst = sAgainst;  // marcador antes de este gol
  if (bFor === 0 && bAgainst === 0) return 'abre el marcador';
  if (sFor === sAgainst) return '¡empata el partido!';
  if (bFor === bAgainst && sFor > sAgainst) return 'rompe el empate';
  if (bFor > bAgainst) return 'amplía la ventaja';
  if (sFor < sAgainst) return 'descuenta';
  return '';
}

function goalText(homeName: string, awayName: string, h: number, a: number, g: Partial<GoalEvent>, ctx = ''): string {
  const tag = g.ownGoal ? ' _(en propia puerta)_' : g.penalty ? ' _(de penal)_' : '';
  const min = g.minute ? ` _${g.minute}_` : '';
  const c = ctx ? ` — _${ctx}_` : '';
  return [
    (g.scorer ? `⚽ *¡GOOOL de ${g.scorer}!*${tag}` : `⚽ *¡GOOOL!*${tag}`) + c,
    `${teamFlag(homeName)} ${spanishName(homeName)} *${h} - ${a}* ${spanishName(awayName)} ${teamFlag(awayName)}${min}`,
  ].join('\n');
}

function annulText(homeName: string, awayName: string, h: number, a: number): string {
  return [
    '🚫 *GOL ANULADO* _(VAR)_',
    `El marcador vuelve a ${teamFlag(homeName)} ${spanishName(homeName)} *${h} - ${a}* ${spanishName(awayName)} ${teamFlag(awayName)}`,
  ].join('\n');
}

/** Máximo de nombres listados por bando antes de pasar a "+N". */
const MAX_NOMBRES = 3;

/** Lista de apodos en negrita: 1-3 con "y" final, más → "*A*, *B*, *C* +N". */
function listaNombres(nombres: string[]): string {
  if (nombres.length <= MAX_NOMBRES) {
    const neg = nombres.map((n) => `*${n}*`);
    if (neg.length === 1) return neg[0];
    return `${neg.slice(0, -1).join(', ')} y ${neg[neg.length - 1]}`;
  }
  return `${nombres.slice(0, MAX_NOMBRES).map((n) => `*${n}*`).join(', ')} +${nombres.length - MAX_NOMBRES}`;
}

const verbo = (n: number, sing: string, plur: string): string => (n === 1 ? sing : plur);

/**
 * Línea-teaser de puntaje en vivo: con el marcador que dejó este gol, ¿quiénes
 * "clavan" el exacto (se alegran) y quiénes tenían el marcador anterior y lo
 * pierden (lloran)? Conteo BRUTO: no descuenta sanciones ni jornadas incompletas
 * (eso recién se resuelve al cerrar) — es un teaser, no el marcador oficial.
 *
 * En GRUPOS el exacto vale +3, así que lo decimos. En ELIMINATORIA el puntaje
 * depende del final (penales), así que solo decimos "lo tienen clavado" y, si va
 * empatado, avisamos que puede cambiar todo. Una sola lectura a `predictions`
 * (índice por match_id, 100% caché). Nunca rompe: ante cualquier error, sin línea.
 */
async function teaserPuntaje(
  matchId: string,
  prevH: number,
  prevA: number,
  h: number,
  a: number,
  stage: string,
): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from('predictions')
      .select('user_home, user_away, profiles(username)')
      .eq('match_id', matchId)
      .or(`and(user_home.eq.${h},user_away.eq.${a}),and(user_home.eq.${prevH},user_away.eq.${prevA})`);
    if (!data?.length) return '';

    const nombre = (r: any): string => r.profiles?.username ?? 'Alguien';
    const alegres = data.filter((r: any) => r.user_home === h && r.user_away === a).map(nombre);
    const llorones = data.filter((r: any) => r.user_home === prevH && r.user_away === prevA).map(nombre);
    if (!alegres.length && !llorones.length) return '';

    const isGroup = stage === 'group';
    const segs: string[] = [];

    if (alegres.length) {
      segs.push(
        isGroup
          ? `${listaNombres(alegres)} ${verbo(alegres.length, 'se alegra', 'se alegran')} con el ${h}-${a} (clavan el exacto, +3)`
          : `${listaNombres(alegres)} ${verbo(alegres.length, 'tiene', 'tienen')} el ${h}-${a} clavado`,
      );
    } else {
      segs.push(`Nadie clavó el ${h}-${a}`);
    }

    if (llorones.length) {
      segs.push(
        isGroup
          ? `${listaNombres(llorones)} ${verbo(llorones.length, 'llora', 'lloran')} su ${prevH}-${prevA} 😭`
          : `${listaNombres(llorones)} lo ${verbo(llorones.length, 'perdió', 'perdieron')} 😭`,
      );
    }

    let line = `🎯 ${segs.join(' · ')}`;
    if (!isGroup && h === a) line += '\n   ⚠️ Si se va a penales, cambia todo 👀';
    return line;
  } catch {
    return '';
  }
}

/**
 * Tease para el aviso de gol anulado: ¿quién tenía clavado el marcador que el
 * VAR borró? Esos "festejaron por adelantado". Conteo bruto (no descuenta
 * sanciones): es un guiño, no el marcador oficial. Nunca rompe.
 */
async function teaserAnulado(matchId: string, ph: number, pa: number): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from('predictions')
      .select('profiles(username)')
      .eq('match_id', matchId)
      .eq('user_home', ph)
      .eq('user_away', pa);
    if (!data?.length) return '';
    const nombres = data.map((r: any) => r.profiles?.username ?? 'Alguien');
    return `🙈 Oh oh... ${listaNombres(nombres)} ya ${verbo(nombres.length, 'festejaba', 'festejaban')} su ${ph}-${pa} por adelantado`;
  } catch {
    return '';
  }
}

/** Quién tiene clavado el marcador al entretiempo (guiño, conteo bruto). */
async function teaserMediotiempo(matchId: string, h: number, a: number): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from('predictions')
      .select('profiles(username)')
      .eq('match_id', matchId)
      .eq('user_home', h)
      .eq('user_away', a);
    if (!data?.length) return '';
    const nombres = data.map((r: any) => r.profiles?.username ?? 'Alguien');
    return `🎯 Al descanso, ${listaNombres(nombres)} ${verbo(nombres.length, 'tiene', 'tienen')} clavado el ${h}-${a}`;
  } catch {
    return '';
  }
}

export async function emitLiveEvents(
  fixtures: ApiMatch[],
  dbRows: DbMatchRow[],
  provider: string,
  opts: { dryRun?: boolean } = {},
): Promise<string[]> {
  const dryRun = opts.dryRun === true;
  const out: string[] = [];

  // Reclamo atómico → envío. En dryRun solo lee (no escribe ni envía) y muestra
  // los avisos aún no registrados.
  const emit = async (text: string, source: string, row: EventRow): Promise<void> => {
    if (dryRun) {
      if (!(await exists(row.match_id, row.type, row.home_score, row.away_score))) out.push(text);
      return;
    }
    const claimedId = await claim(row);
    if (!claimedId) return; // otra corrida ya lo reclamó → no duplicar
    out.push(text);
    const res = await sendWhatsApp(text, source);
    // Si el envío falla, liberar la fila para reintentar en la próxima corrida.
    if (!res.ok) await supabaseAdmin.from('match_events').delete().eq('id', claimedId);
  };

  try {
    const live = fixtures.filter(f => f.status === 'IN_PLAY' || f.status === 'PAUSED');
    if (!live.length) return out;

    const link = linkMatches(live, dbRows, provider);

    for (const f of live) {
      const matchId = link.get(f);
      if (!matchId) continue;

      const db = dbRows.find(d => d.id === matchId);
      const home = db?.home_team ?? f.homeTeam.name;
      const away = db?.away_team ?? f.awayTeam.name;
      const stage = db?.stage ?? 'group';
      const curH = f.score.fullTime.home ?? 0;
      const curA = f.score.fullTime.away ?? 0;

      // 1. Arranque del partido.
      if (!(await exists(matchId, 'kickoff', 0, 0))) {
        const text = [
          '🟢 *¡ARRANCÓ EL PARTIDO!*',
          `${teamFlag(home)} *${spanishName(home)}* vs *${spanishName(away)}* ${teamFlag(away)}`,
          '',
          '⚽ ¡Que ruede la pelota! Suerte a todos.',
        ].join('\n');
        await emit(text, 'live-kickoff', { match_id: matchId, type: 'kickoff', home_score: 0, away_score: 0 });
      }

      // 1.5 Gol anulado (VAR): el marcador en vivo está por debajo de algún gol
      // ya anunciado. Solo con marcador válido (no null) para no reaccionar a un
      // glitch transitorio del proveedor. Se borran los goles fantasma (así un
      // nuevo gol al mismo marcador se vuelve a anunciar) y se avisa la corrección
      // UNA vez: el DELETE..RETURNING es atómico, solo el poll que borró filas
      // gana la carrera y envía. En dryRun solo se detecta (no borra ni envía).
      if (f.score.fullTime.home != null && f.score.fullTime.away != null) {
        const phantomFilter = `home_score.gt.${curH},away_score.gt.${curA}`;
        // Corrección + tease a quien ya "festejaba" el marcador anulado (el gol
        // fantasma de mayor total entre los borrados).
        const annulMsg = async (rows: { home_score: number; away_score: number }[]) => {
          const top = rows.reduce((m, r) =>
            r.home_score + r.away_score > m.home_score + m.away_score ? r : m);
          const teaser = await teaserAnulado(matchId, top.home_score, top.away_score);
          const base = annulText(home, away, curH, curA);
          return teaser ? `${base}\n${teaser}` : base;
        };
        if (dryRun) {
          const { data: phantom } = await supabaseAdmin
            .from('match_events').select('home_score, away_score')
            .eq('match_id', matchId).eq('type', 'goal').or(phantomFilter);
          if (phantom?.length) out.push(await annulMsg(phantom));
        } else {
          const { data: phantom } = await supabaseAdmin
            .from('match_events').delete()
            .eq('match_id', matchId).eq('type', 'goal').or(phantomFilter)
            .select('home_score, away_score');
          if (phantom?.length) {
            const text = await annulMsg(phantom);
            out.push(text);
            await sendWhatsApp(text, 'live-annul');
          }
        }
      }

      // 2. Goles.
      if (f.goals && f.goals.length) {
        // Camino preferido (ESPN): cada gol con su goleador y marcador acumulado.
        let h = 0, a = 0;
        for (const g of f.goals) {
          const prevH = h, prevA = a;
          if (g.side === 'home') h++; else a++;
          if (await exists(matchId, 'goal', h, a)) continue;
          const ctx = goalContext(prevH, prevA, h, a);
          const teaser = await teaserPuntaje(matchId, prevH, prevA, h, a, stage);
          const base = goalText(home, away, h, a, g, ctx);
          const text = teaser ? `${base}\n${teaser}` : base;
          await emit(text, 'live-goal', {
            match_id: matchId, type: 'goal', home_score: h, away_score: a,
            scorer: g.scorer, minute: g.minute, penalty: g.penalty, own_goal: g.ownGoal,
          });
        }
      } else if (curH + curA > 0 && !(await exists(matchId, 'goal', curH, curA))) {
        // Fallback (proveedor sin detalle): inferir el lado por diferencia.
        const prev = await prevGoalScore(matchId);
        const side = curH > prev.h && curA === prev.a ? 'home'
          : curA > prev.a && curH === prev.h ? 'away' : null;
        const scorer = side === 'home' ? spanishName(home) : side === 'away' ? spanishName(away) : null;
        const ctx = side ? goalContext(prev.h, prev.a, curH, curA) : '';
        const teaser = await teaserPuntaje(matchId, prev.h, prev.a, curH, curA, stage);
        const base = goalText(home, away, curH, curA, { scorer }, ctx);
        const text = teaser ? `${base}\n${teaser}` : base;
        await emit(text, 'live-goal', {
          match_id: matchId, type: 'goal', home_score: curH, away_score: curA,
        });
      }

      // 3. Entretiempo: un aviso por partido cuando ESPN reporta el descanso
      //    (status PAUSED = STATUS_HALFTIME). Idempotente por (match, halftime).
      if (f.status === 'PAUSED' && !(await exists(matchId, 'halftime', curH, curA))) {
        const teaser = await teaserMediotiempo(matchId, curH, curA);
        const text = [
          '⏸️ *ENTRETIEMPO*',
          `${teamFlag(home)} ${spanishName(home)} *${curH} - ${curA}* ${spanishName(away)} ${teamFlag(away)}`,
          ...(teaser ? ['', teaser] : []),
        ].join('\n');
        await emit(text, 'live-halftime', { match_id: matchId, type: 'halftime', home_score: curH, away_score: curA });
      }
    }
  } catch {
    /* los eventos en vivo nunca deben romper el sync */
  }
  return out;
}
