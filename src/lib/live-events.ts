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
  type: 'kickoff' | 'goal';
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

async function record(row: EventRow): Promise<void> {
  // El índice único sella la idempotencia; ignoramos choques por carrera.
  await supabaseAdmin.from('match_events').insert(row);
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

function goalText(homeName: string, awayName: string, h: number, a: number, g: Partial<GoalEvent>): string {
  const tag = g.ownGoal ? ' _(en propia puerta)_' : g.penalty ? ' _(de penal)_' : '';
  const min = g.minute ? ` _${g.minute}_` : '';
  return [
    g.scorer ? `⚽ *¡GOOOL de ${g.scorer}!*${tag}` : `⚽ *¡GOOOL!*${tag}`,
    `${teamFlag(homeName)} ${spanishName(homeName)} *${h} - ${a}* ${spanishName(awayName)} ${teamFlag(awayName)}${min}`,
  ].join('\n');
}

export async function emitLiveEvents(
  fixtures: ApiMatch[],
  dbRows: DbMatchRow[],
  provider: string,
  opts: { dryRun?: boolean } = {},
): Promise<string[]> {
  const dryRun = opts.dryRun === true;
  const out: string[] = [];

  // Envía (o, en dryRun, solo acumula) y registra el evento al confirmarse.
  const emit = async (text: string, source: string, row: EventRow): Promise<void> => {
    out.push(text);
    if (dryRun) return;
    if ((await sendWhatsApp(text, source)).ok) await record(row);
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

      // 2. Goles.
      if (f.goals && f.goals.length) {
        // Camino preferido (ESPN): cada gol con su goleador y marcador acumulado.
        let h = 0, a = 0;
        for (const g of f.goals) {
          if (g.side === 'home') h++; else a++;
          if (await exists(matchId, 'goal', h, a)) continue;
          await emit(goalText(home, away, h, a, g), 'live-goal', {
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
        await emit(goalText(home, away, curH, curA, { scorer }), 'live-goal', {
          match_id: matchId, type: 'goal', home_score: curH, away_score: curA,
        });
      }
    }
  } catch {
    /* los eventos en vivo nunca deben romper el sync */
  }
  return out;
}
