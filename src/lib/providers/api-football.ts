/**
 * Proveedor API-Football (api-sports.io) → normaliza a ApiMatch.
 *
 * Importante: el plan FREE no permite consultar por `season` (solo 2022–2024),
 * pero SÍ permite `fixtures?date=YYYY-MM-DD` y `fixtures?live=all` con datos
 * actuales (Mundial 2026 incluido). Por eso aquí se consulta por fecha / en vivo,
 * no por temporada. Se filtra a la liga del Mundial (league id 1).
 *
 * Cuota free: 100 requests/día → el cron debe hacer polling inteligente (Fase 3).
 */
import type { ApiMatch } from '../match-types';

const BASE = 'https://v3.football.api-sports.io';
const WC_LEAGUE = 1; // World Cup

async function afFetch(path: string): Promise<any[]> {
  const key = import.meta.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('API_FOOTBALL_KEY no configurada');

  const res = await fetch(`${BASE}${path}`, { headers: { 'x-apisports-key': key } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API-Football ${res.status}: ${body}`);
  }
  const data = await res.json();
  const errs = data.errors;
  if (errs && (Array.isArray(errs) ? errs.length > 0 : Object.keys(errs).length > 0)) {
    throw new Error('API-Football errors: ' + JSON.stringify(errs));
  }
  return data.response ?? [];
}

// ── Mapeo de status (short de API-Football → status de la app) ────
const LIVE = new Set(['1H', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT']);
const FINISHED = new Set(['FT', 'AET', 'PEN']);

function mapStatus(short: string): ApiMatch['status'] {
  if (FINISHED.has(short)) return 'FINISHED';
  if (short === 'HT') return 'PAUSED';
  if (LIVE.has(short)) return 'IN_PLAY';
  if (short === 'PST') return 'POSTPONED';
  if (short === 'CANC') return 'CANCELLED';
  if (short === 'ABD' || short === 'SUSP' || short === 'AWD' || short === 'WO') {
    return short === 'AWD' || short === 'WO' ? 'AWARDED' : 'SUSPENDED';
  }
  return 'SCHEDULED'; // NS, TBD
}

function mapDuration(short: string): ApiMatch['score']['duration'] {
  if (short === 'PEN') return 'PENALTY_SHOOTOUT';
  if (short === 'AET') return 'EXTRA_TIME';
  return 'REGULAR';
}

// "Group Stage - 1" / "Round of 16" / "Final" → código de stage estilo football-data.
function mapRoundToStage(round: string): string {
  const r = round.toLowerCase();
  if (r.includes('group')) return 'GROUP_STAGE';
  if (r.includes('round of 32')) return 'LAST_32';
  if (r.includes('round of 16')) return 'LAST_16';
  if (r.includes('quarter')) return 'QUARTER_FINALS';
  if (r.includes('semi')) return 'SEMI_FINALS';
  if (r.includes('3rd place') || r.includes('third place')) return 'THIRD_PLACE';
  if (r.includes('final')) return 'FINAL';
  return round;
}

// "Group Stage - 1" → 1 (matchday); knockouts → null.
function parseMatchday(round: string): number | null {
  const m = round.match(/-\s*(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : null;
}

function normalize(f: any): ApiMatch {
  const short: string = f.fixture?.status?.short ?? 'NS';
  const homeWin = f.teams?.home?.winner;
  const awayWin = f.teams?.away?.winner;
  let winner: ApiMatch['score']['winner'] = null;
  if (homeWin === true) winner = 'HOME_TEAM';
  else if (awayWin === true) winner = 'AWAY_TEAM';
  else if (FINISHED.has(short)) winner = 'DRAW';

  const round: string = f.league?.round ?? '';
  return {
    id: f.fixture.id,
    utcDate: f.fixture.date,
    status: mapStatus(short),
    stage: mapRoundToStage(round),
    group: null, // API-Football no trae la letra de grupo en el round (es matchday)
    matchday: parseMatchday(round),
    minute: f.fixture?.status?.elapsed ?? null,
    homeTeam: { name: f.teams?.home?.name ?? '' },
    awayTeam: { name: f.teams?.away?.name ?? '' },
    score: {
      winner,
      duration: mapDuration(short),
      fullTime: {
        home: f.score?.fulltime?.home ?? f.goals?.home ?? null,
        away: f.score?.fulltime?.away ?? f.goals?.away ?? null,
      },
      halfTime: { home: f.score?.halftime?.home ?? null, away: f.score?.halftime?.away ?? null },
      penalties: { home: f.score?.penalty?.home ?? null, away: f.score?.penalty?.away ?? null },
    },
  };
}

function utcDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

async function wcByDate(date: string): Promise<ApiMatch[]> {
  const r = await afFetch(`/fixtures?date=${date}`);
  return r.filter((f) => f.league?.id === WC_LEAGUE).map(normalize);
}

function dedupe(matches: ApiMatch[]): ApiMatch[] {
  const map = new Map<number, ApiMatch>();
  for (const m of matches) map.set(m.id, m);
  return [...map.values()];
}

/** Partidos del Mundial en vivo ahora (1 request). */
export async function getLiveMatches(): Promise<ApiMatch[]> {
  const r = await afFetch('/fixtures?live=all');
  return r.filter((f) => f.league?.id === WC_LEAGUE).map(normalize);
}

/** Partidos terminados recientemente (hoy + ayer UTC, por la frontera de medianoche). */
export async function getFinishedMatches(): Promise<ApiMatch[]> {
  const [today, yesterday] = await Promise.all([wcByDate(utcDate(0)), wcByDate(utcDate(-1))]);
  return dedupe([...today, ...yesterday]).filter((m) => m.status === 'FINISHED');
}

/**
 * Fixtures del día (todos los estados: en vivo, terminados, programados) en 1 sola
 * request — la cuota free es 100/día, así que se minimizan las llamadas. Solo añade
 * "ayer" en la madrugada UTC (<05:00), por partidos que cruzan la medianoche.
 * El sync deriva los terminados filtrando status === 'FINISHED' de este resultado.
 */
export async function getFixtures(): Promise<ApiMatch[]> {
  const dates = [utcDate(0)];
  if (new Date().getUTCHours() < 5) dates.push(utcDate(-1));
  const batches = await Promise.all(dates.map(wcByDate));
  return dedupe(batches.flat());
}
