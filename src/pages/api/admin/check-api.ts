import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getAdminUser } from '@/lib/auth-helpers';

export const GET: APIRoute = async ({ cookies }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });

  const key = import.meta.env.FOOTBALL_API_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: 'FOOTBALL_API_KEY no configurada' }), { status: 500 });
  }

  const res = await fetch('https://api.football-data.org/v4/competitions', {
    headers: { 'X-Auth-Token': key },
  });
  const data = await res.json();

  if (!res.ok) {
    return new Response(JSON.stringify({ error: `API ${res.status}`, detail: data }), { status: 200 });
  }

  const competitions = (data.competitions ?? []).map((c: any) => ({
    code: c.code,
    name: c.name,
    area: c.area?.name,
    plan: c.plan,
  }));

  return new Response(JSON.stringify({ competitions, count: competitions.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
