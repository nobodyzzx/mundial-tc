import type { APIRoute } from 'astro';
import { supabase } from '@/lib/supabase';

export const GET: APIRoute = async ({ cookies }) => {
  const accessToken = cookies.get('sb-access-token')?.value;
  const refreshToken = cookies.get('sb-refresh-token')?.value;
  if (!accessToken || !refreshToken) {
    return new Response(JSON.stringify({ count: 0 }), { status: 200 });
  }

  const { data: { user } } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (!user) return new Response(JSON.stringify({ count: 0 }), { status: 200 });

  const cutoff = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  const [{ data: openMatches }, { data: myPreds }] = await Promise.all([
    supabase.from('matches')
      .select('id')
      .eq('is_finished', false)
      .gt('match_date', cutoff)
      .not('home_team', 'ilike', 'TBD%')
      .not('away_team', 'ilike', 'TBD%')
      .not('home_team', 'ilike', 'Winner%')
      .not('away_team', 'ilike', 'Winner%'),
    supabase.from('predictions').select('match_id').eq('user_id', user.id),
  ]);

  const predictedIds = new Set((myPreds ?? []).map((p: any) => p.match_id));
  const count = (openMatches ?? []).filter((m: any) => !predictedIds.has(m.id)).length;

  return new Response(JSON.stringify({ count }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
