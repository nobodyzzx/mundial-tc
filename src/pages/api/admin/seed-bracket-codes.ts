import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getAdminUser } from '@/lib/auth-helpers';

/**
 * Bracket R32 — FIFA World Cup 2026 (openfootball/worldcup.json)
 * Orden por fecha de partido (28 jun → 3 jul).
 * Los terceros se expresan como "3ABCDF" (letras de grupos posibles).
 */
const BRACKET_R32 = [
  { home: '2A',     away: '2B' },      // Match 73 — 28 jun
  { home: '1E',     away: '3ABCDF' },  // Match 74 — 29 jun
  { home: '1F',     away: '2C' },      // Match 75 — 29 jun
  { home: '1C',     away: '2F' },      // Match 76 — 29 jun
  { home: '1I',     away: '3CDFGH' },  // Match 77 — 30 jun
  { home: '2E',     away: '2I' },      // Match 78 — 30 jun
  { home: '1A',     away: '3CEFHI' },  // Match 79 — 30 jun
  { home: '1L',     away: '3EHIJK' },  // Match 80 — 1 jul
  { home: '1D',     away: '3BEFIJ' },  // Match 81 — 1 jul
  { home: '1G',     away: '3AEHIJ' },  // Match 82 — 1 jul
  { home: '2K',     away: '2L' },      // Match 83 — 2 jul
  { home: '1H',     away: '2J' },      // Match 84 — 2 jul
  { home: '1B',     away: '3EFGIJ' },  // Match 85 — 2 jul
  { home: '1J',     away: '2H' },      // Match 86 — 3 jul
  { home: '1K',     away: '3DEIJL' },  // Match 87 — 3 jul
  { home: '2D',     away: '2G' },      // Match 88 — 3 jul
];

export const POST: APIRoute = async ({ cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  // Obtener partidos R32 ordenados por fecha (mismo orden que el bracket FIFA)
  const { data: r32, error } = await supabaseAdmin
    .from('matches')
    .select('id, match_date, home_team, away_team')
    .eq('stage', 'knockout')
    .eq('round', 'R32')
    .order('match_date', { ascending: true });

  if (error) return redirect(`/admin/bracket?err=${encodeURIComponent(error.message)}`);
  if (!r32?.length) return redirect('/admin/bracket?err=No+hay+partidos+R32+en+la+BD');
  if (r32.length !== BRACKET_R32.length) {
    return redirect(`/admin/bracket?err=${encodeURIComponent(`Se esperaban ${BRACKET_R32.length} partidos R32, hay ${r32.length}`)}`);
  }

  // Asignar códigos en orden cronológico
  const updates = r32.map((m, i) => ({
    id: m.id,
    home_team: BRACKET_R32[i].home,
    away_team: BRACKET_R32[i].away,
  }));

  for (const u of updates) {
    const { error: e } = await supabaseAdmin
      .from('matches')
      .update({ home_team: u.home_team, away_team: u.away_team })
      .eq('id', u.id);
    if (e) return redirect(`/admin/bracket?err=${encodeURIComponent(e.message)}`);
  }

  return redirect(`/admin/bracket?ok=${BRACKET_R32.length}+partidos+R32+actualizados`);
};
