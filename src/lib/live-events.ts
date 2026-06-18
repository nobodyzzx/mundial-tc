/**
 * Eventos en vivo Nivel 1: avisa al grupo de WhatsApp cuando un partido ARRANCA
 * y cuando hay un GOL. Se alimenta de los fixtures que `sync` ya trajo del
 * proveedor (ESPN) — NO hace ninguna llamada extra a la API, así que sync sigue
 * siendo el único que toca al proveedor.
 *
 * Idempotencia sin tocar el esquema: cada evento queda sellado en `sync_logs`
 * (source 'live-event'):
 *   - arranque: endpoint `kickoff:<matchId>`        (una vez por partido)
 *   - gol:      endpoint `goal:<matchId>:<h>-<a>`    (una vez por marcador)
 * El estado de marcador previo se recupera del último log de gol del partido,
 * para nombrar al equipo que anotó. Best-effort: nunca lanza ni rompe el sync.
 */
import type { ApiMatch } from './match-types';
import { supabaseAdmin } from './supabase';
import { linkMatches, type DbMatchRow } from './match-link';
import { spanishName, teamFlag } from './isoFlags';
import { sendWhatsApp } from './whatsapp';

const SRC = 'live-event';

async function alreadyLogged(endpoint: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('sync_logs')
    .select('id')
    .eq('source', SRC)
    .eq('endpoint', endpoint)
    .is('error', null)
    .limit(1);
  return !!data?.length;
}

async function seal(endpoint: string): Promise<void> {
  await supabaseAdmin.from('sync_logs').insert({
    source: SRC, endpoint, response_status: 200, matches_updated: 0, error: null,
  });
}

/** Último marcador anunciado de este partido (del log de gol más reciente). */
async function prevScore(matchId: string): Promise<{ h: number; a: number }> {
  const { data } = await supabaseAdmin
    .from('sync_logs')
    .select('endpoint')
    .eq('source', SRC)
    .like('endpoint', `goal:${matchId}:%`)
    .is('error', null)
    .order('created_at', { ascending: false })
    .limit(1);
  const ep = data?.[0]?.endpoint ?? '';
  const m = ep.match(/:(\d+)-(\d+)$/);
  return m ? { h: parseInt(m[1], 10), a: parseInt(m[2], 10) } : { h: 0, a: 0 };
}

export async function emitLiveEvents(
  fixtures: ApiMatch[],
  dbRows: DbMatchRow[],
  provider: string,
): Promise<void> {
  try {
    const live = fixtures.filter(f => f.status === 'IN_PLAY' || f.status === 'PAUSED');
    if (!live.length) return;

    const link = linkMatches(live, dbRows, provider);

    for (const f of live) {
      const matchId = link.get(f);
      if (!matchId) continue;

      const db = dbRows.find(d => d.id === matchId);
      const home = db?.home_team ?? f.homeTeam.name;
      const away = db?.away_team ?? f.awayTeam.name;
      const h = f.score.fullTime.home ?? 0;
      const a = f.score.fullTime.away ?? 0;

      // 1. Arranque del partido.
      const koKey = `kickoff:${matchId}`;
      if (!(await alreadyLogged(koKey))) {
        const text = [
          '🟢 *¡ARRANCÓ EL PARTIDO!*',
          `${teamFlag(home)} *${spanishName(home)}* vs *${spanishName(away)}* ${teamFlag(away)}`,
          '',
          '⚽ ¡Que ruede la pelota! Suerte a todos.',
        ].join('\n');
        if ((await sendWhatsApp(text, 'live-kickoff')).ok) await seal(koKey);
      }

      // 2. Gol (cualquier cambio de marcador hacia arriba).
      const goalKey = `goal:${matchId}:${h}-${a}`;
      if (h + a > 0 && !(await alreadyLogged(goalKey))) {
        const prev = await prevScore(matchId);
        const homeScored = h > prev.h;
        const awayScored = a > prev.a;
        // Si solo un lado subió, nombramos al equipo; si subieron ambos (nos
        // perdimos un estado intermedio) anunciamos solo el marcador.
        const scorer = homeScored && !awayScored ? spanishName(home)
          : awayScored && !homeScored ? spanishName(away)
          : null;
        const minLine = f.minute ? ` _(min ${f.minute})_` : '';
        const text = [
          scorer ? `⚽ *¡GOOOL de ${scorer}!*` : '⚽ *¡GOOOL!*',
          `${teamFlag(home)} ${spanishName(home)} *${h} - ${a}* ${spanishName(away)} ${teamFlag(away)}${minLine}`,
        ].join('\n');
        if ((await sendWhatsApp(text, 'live-goal')).ok) await seal(goalKey);
      }
    }
  } catch {
    /* los eventos en vivo nunca deben romper el sync */
  }
}
