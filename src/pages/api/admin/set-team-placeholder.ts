import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getAdminUser } from '@/lib/auth-helpers';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  const form = await request.formData();
  const matchId   = form.get('match_id')?.toString().trim();
  const homeTeam  = form.get('home_team')?.toString().trim();
  const awayTeam  = form.get('away_team')?.toString().trim();

  if (!matchId) return new Response('match_id requerido', { status: 400 });

  const updates: Record<string, string> = {};
  if (homeTeam) updates.home_team = homeTeam;
  if (awayTeam) updates.away_team = awayTeam;

  if (!Object.keys(updates).length)
    return redirect('/admin/bracket?err=sin+cambios');

  const { error } = await supabaseAdmin
    .from('matches')
    .update(updates)
    .eq('id', matchId);

  if (error) return redirect(`/admin/bracket?err=${encodeURIComponent(error.message)}`);

  return redirect('/admin/bracket?ok=1');
};
