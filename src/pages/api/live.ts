/**
 * GET /api/live
 *
 * Endpoint público de solo lectura para la página /live.
 * Devuelve partidos en vivo, próximos y recientes. Sin autenticación:
 * los marcadores del Mundial son información pública. No expone pronósticos
 * ni datos de usuarios.
 */
import type { APIRoute } from 'astro';
import { getLiveData } from '@/lib/live-data';

export const GET: APIRoute = async () => {
  try {
    const data = await getLiveData();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
