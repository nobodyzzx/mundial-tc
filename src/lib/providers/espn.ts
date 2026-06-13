/**
 * Proveedor ESPN (API oculta, no oficial) → normaliza a ApiMatch.
 *
 * Endpoint público de ESPN, sin API key ni auth, con datos en tiempo real:
 *   https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard
 *   …/scoreboard?dates=YYYYMMDD
 *
 * Ventajas frente a api-football/football-data: gratis, sin key, sin cuota práctica
 * y actualización en vivo (es el feed propio de ESPN). El slug del Mundial es
 * `fifa.world`, así que el endpoint ya viene scopeado al torneo (no hay que filtrar).
 *
 * Notas:
 *  - ESPN agrupa las fechas en horario del este de EEUU (EDT). Para no perder
 *    partidos de medianoche se consulta una pequeña ventana de días (UTC) y se
 *    deduplica por id. Como no hay cuota, varias requests no cuestan.
 *  - Se empareja con la BD por hora+equipos (ver lib/match-link.ts, igual que
 *    api-football): los external_id de ESPN difieren de los del sembrado.
 */
import type { ApiMatch } from '../match-types';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';

function toIntOrNull(v: unknown): number | null {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isNaN(n) ? null : n;
}

// status.type.{state,name,completed} → status de la app.
function mapStatus(type: any): ApiMatch['status'] {
  const state: string = type?.state ?? '';
  const name: string = type?.name ?? '';
  if (name === 'STATUS_POSTPONED') return 'POSTPONED';
  if (name === 'STATUS_CANCELED' || name === 'STATUS_CANCELLED') return 'CANCELLED';
  if (name === 'STATUS_ABANDONED' || name === 'STATUS_SUSPENDED') return 'SUSPENDED';
  if (state === 'pre') return 'SCHEDULED';
  if (state === 'in') return name === 'STATUS_HALFTIME' ? 'PAUSED' : 'IN_PLAY';
  // state === 'post'
  return type?.completed ? 'FINISHED' : 'FINISHED';
}

// Nombre de la fase del torneo (leagues[0].season.type.name) → código de stage.
function mapStageName(name: string): string {
  const n = (name ?? '').toLowerCase();
  if (n.includes('group')) return 'GROUP_STAGE';
  if (n.includes('round of 32')) return 'LAST_32';
  if (n.includes('round of 16')) return 'LAST_16';
  if (n.includes('quarter')) return 'QUARTER_FINALS';
  if (n.includes('semi')) return 'SEMI_FINALS';
  if (n.includes('third') || n.includes('3rd')) return 'THIRD_PLACE';
  if (n.includes('final')) return 'FINAL';
  return name || 'GROUP_STAGE';
}

function teamName(c: any): string {
  return c?.team?.displayName ?? c?.team?.name ?? c?.team?.shortDisplayName ?? '';
}

function normalize(ev: any, stageName: string): ApiMatch {
  const comp = ev?.competitions?.[0] ?? {};
  const type = comp?.status?.type ?? {};
  const status = mapStatus(type);
  const competitors: any[] = comp?.competitors ?? [];
  const home = competitors.find(c => c.homeAway === 'home') ?? competitors[0] ?? {};
  const away = competitors.find(c => c.homeAway === 'away') ?? competitors[1] ?? {};

  const started = (type?.state ?? '') !== 'pre';
  const hs = started ? toIntOrNull(home.score) : null;
  const as = started ? toIntOrNull(away.score) : null;

  let winner: ApiMatch['score']['winner'] = null;
  if (home.winner === true) winner = 'HOME_TEAM';
  else if (away.winner === true) winner = 'AWAY_TEAM';
  else if (status === 'FINISHED') winner = 'DRAW';

  const name: string = type?.name ?? '';
  const duration: ApiMatch['score']['duration'] =
    /PEN|SHOOTOUT/i.test(name) ? 'PENALTY_SHOOTOUT' :
    /AET|EXTRA/i.test(name) ? 'EXTRA_TIME' : 'REGULAR';

  return {
    id: Number(ev?.id),
    utcDate: ev?.date,
    status,
    stage: mapStageName(stageName),
    group: null,                 // ESPN no expone la letra de grupo en el scoreboard
    matchday: null,
    minute: (type?.state ?? '') === 'in' ? toIntOrNull(comp?.status?.displayClock) : null,
    homeTeam: { name: teamName(home) },
    awayTeam: { name: teamName(away) },
    score: {
      winner,
      duration,
      fullTime: { home: hs, away: as },
      halfTime: { home: null, away: null },
      // shootoutScore solo aparece en eliminatorias con penales; si no, null.
      penalties: { home: toIntOrNull(home.shootoutScore), away: toIntOrNull(away.shootoutScore) },
    },
  };
}

function ymd(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function fetchDate(yyyymmdd?: string): Promise<ApiMatch[]> {
  const u = `${BASE}/scoreboard${yyyymmdd ? `?dates=${yyyymmdd}` : ''}`;
  const res = await fetch(u);
  if (!res.ok) throw new Error(`ESPN ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  const stageName: string = data?.leagues?.[0]?.season?.type?.name ?? '';
  return (data?.events ?? []).map((ev: any) => normalize(ev, stageName));
}

function dedupe(ms: ApiMatch[]): ApiMatch[] {
  const map = new Map<number, ApiMatch>();
  for (const m of ms) if (!Number.isNaN(m.id)) map.set(m.id, m);
  return [...map.values()];
}

/** Fixtures del Mundial en un rango de offsets de día (UTC), tolerante por fecha. */
export async function getFixturesRange(fromOffset: number, toOffset: number): Promise<ApiMatch[]> {
  const out: ApiMatch[] = [];
  for (let o = fromOffset; o <= toOffset; o++) {
    try { out.push(...(await fetchDate(ymd(o)))); } catch { /* fecha sin datos → se omite */ }
  }
  return dedupe(out);
}

/**
 * Fixtures recientes (ayer/hoy/mañana UTC). La ventana de 3 días cubre los partidos
 * de medianoche que ESPN agrupa por fecha EDT. Sin cuota → sin gate.
 */
export async function getFixtures(): Promise<ApiMatch[]> {
  return getFixturesRange(-1, 1);
}

/** Partidos terminados recientemente. */
export async function getFinishedMatches(): Promise<ApiMatch[]> {
  return (await getFixturesRange(-1, 1)).filter(m => m.status === 'FINISHED');
}

/** Partidos en vivo ahora. */
export async function getLiveMatches(): Promise<ApiMatch[]> {
  return (await getFixturesRange(-1, 0)).filter(m => m.status === 'IN_PLAY' || m.status === 'PAUSED');
}

// Ventana del Mundial 2026 (ESPN acepta rango `?dates=INICIO-FIN` en una request).
const WC_RANGE = '20260611-20260719';

/** TODO el calendario del Mundial en una sola request (rango de fechas de ESPN). */
export async function getAllFixtures(): Promise<ApiMatch[]> {
  return dedupe(await fetchDate(WC_RANGE));
}
