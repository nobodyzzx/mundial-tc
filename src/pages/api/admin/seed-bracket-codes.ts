import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getAdminUser } from '@/lib/auth-helpers';

/**
 * Bracket completo — FIFA World Cup 2026 (fuente: openfootball/worldcup.json)
 * Los números de partido son los oficiales de FIFA (73–104).
 * W73 = Ganador del partido 73, L101 = Perdedor del partido 101.
 *
 * Los slots de cada ronda van en ORDEN DE NÚMERO FIFA (73→104). Se colocan en las filas
 * ordenando por `matches.match_number`, NO por `match_date`: FIFA no numera por hora de
 * inicio (dentro de un día el orden de pateo no coincide con el número), así que ordenar
 * por fecha permutaría los códigos. `match_number` es la fuente de verdad y debe estar
 * sembrado antes (dato propio del calendario; ver migración 20260101000035 y resolver).
 * Si la columna no está alineada con la numeración esperada, el seed ABORTA en vez de
 * colocar códigos a ciegas.
 */
const ROUND_BASE: Record<string, number> = {
  R32: 73, R16: 89, Cuartos: 97, Semifinal: 101, 'Tercer Puesto': 103, Final: 104,
};

const BRACKET: Record<string, { home: string; away: string }[]> = {
  R32: [
    { home: '2A',   away: '2B' },      // M73 — 28 jun
    { home: '1E',   away: '3ABCDF' },  // M74 — 29 jun
    { home: '1F',   away: '2C' },      // M75 — 29 jun
    { home: '1C',   away: '2F' },      // M76 — 29 jun
    { home: '1I',   away: '3CDFGH' },  // M77 — 30 jun
    { home: '2E',   away: '2I' },      // M78 — 30 jun
    { home: '1A',   away: '3CEFHI' },  // M79 — 30 jun
    { home: '1L',   away: '3EHIJK' },  // M80 —  1 jul
    { home: '1D',   away: '3BEFIJ' },  // M81 —  1 jul
    { home: '1G',   away: '3AEHIJ' },  // M82 —  1 jul
    { home: '2K',   away: '2L' },      // M83 —  2 jul
    { home: '1H',   away: '2J' },      // M84 —  2 jul
    { home: '1B',   away: '3EFGIJ' },  // M85 —  2 jul
    { home: '1J',   away: '2H' },      // M86 —  3 jul
    { home: '1K',   away: '3DEIJL' },  // M87 —  3 jul
    { home: '2D',   away: '2G' },      // M88 —  3 jul
  ],
  R16: [
    { home: 'W74',  away: 'W77' },     // M89 —  4 jul
    { home: 'W73',  away: 'W75' },     // M90 —  4 jul
    { home: 'W76',  away: 'W78' },     // M91 —  5 jul
    { home: 'W79',  away: 'W80' },     // M92 —  5 jul
    { home: 'W83',  away: 'W84' },     // M93 —  6 jul
    { home: 'W81',  away: 'W82' },     // M94 —  6 jul
    { home: 'W86',  away: 'W88' },     // M95 —  7 jul
    { home: 'W85',  away: 'W87' },     // M96 —  7 jul
  ],
  Cuartos: [
    { home: 'W89',  away: 'W90' },     // M97 —  9 jul
    { home: 'W93',  away: 'W94' },     // M98 — 10 jul
    { home: 'W91',  away: 'W92' },     // M99 — 11 jul
    { home: 'W95',  away: 'W96' },     // M100 — 11 jul
  ],
  Semifinal: [
    { home: 'W97',  away: 'W98' },     // M101 — 14 jul
    { home: 'W99',  away: 'W100' },    // M102 — 15 jul
  ],
  'Tercer Puesto': [
    { home: 'L101', away: 'L102' },    // M103 — 18 jul
  ],
  Final: [
    { home: 'W101', away: 'W102' },    // M104 — 19 jul
  ],
};

async function seedRound(round: string, slots: { home: string; away: string }[]) {
  const base = ROUND_BASE[round];
  const { data: matches, error } = await supabaseAdmin
    .from('matches')
    .select('id, match_number')
    .eq('stage', 'knockout')
    .eq('round', round)
    .order('match_number', { ascending: true });

  if (error) throw new Error(`Error leyendo ${round}: ${error.message}`);
  if (!matches?.length) return { round, skipped: true, reason: 'sin partidos en BD' };
  if (matches.length !== slots.length) {
    throw new Error(`${round}: se esperaban ${slots.length} partidos, hay ${matches.length}`);
  }

  // El slot i corresponde al partido FIFA `base + i`. Las filas vienen ordenadas por
  // match_number, así que debe calzar 1:1. Si no, la columna no está sembrada/alineada
  // → abortar (colocar por fecha permutaría los códigos).
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].match_number !== base + i) {
      throw new Error(
        `${round}: match_number desalineado (fila ${i} = ${matches[i].match_number ?? 'NULL'}, esperaba ${base + i}). ` +
        `Sembrá matches.match_number con la numeración FIFA antes de los códigos.`
      );
    }
  }

  for (let i = 0; i < matches.length; i++) {
    const { error: e } = await supabaseAdmin
      .from('matches')
      .update({ home_team: slots[i].home, away_team: slots[i].away })
      .eq('id', matches[i].id);
    if (e) throw new Error(`Error actualizando ${round} partido ${i + 1}: ${e.message}`);
  }

  return { round, updated: matches.length };
}

export const POST: APIRoute = async ({ cookies, redirect, url }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  const roundParam = new URL(url).searchParams.get('round'); // opcional: seed solo una ronda
  const roundsToSeed = roundParam
    ? { [roundParam]: BRACKET[roundParam] }
    : BRACKET;

  if (roundParam && !BRACKET[roundParam]) {
    return redirect(`/admin/bracket?err=${encodeURIComponent('Ronda no reconocida: ' + roundParam)}`);
  }

  const results: string[] = [];
  try {
    for (const [round, slots] of Object.entries(roundsToSeed)) {
      const r = await seedRound(round, slots);
      if ('skipped' in r) results.push(`${round}: omitido (${r.reason})`);
      else results.push(`${round}: ${r.updated} partidos actualizados`);
    }
  } catch (e: any) {
    return redirect(`/admin/bracket?err=${encodeURIComponent(e.message)}`);
  }

  return redirect(`/admin/bracket?ok=${encodeURIComponent(results.join(' | '))}`);
};
