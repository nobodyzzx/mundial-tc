import type { ApiMatch } from '@/lib/match-types';
import { describe, it, expect } from 'vitest';
import { normTeam, teamKey, isPlaceholderName, linkMatches } from '@/lib/match-link';

function makeApiMatch(overrides: Partial<ApiMatch> & { id: number; utcDate: string; homeTeam: { name: string }; awayTeam: { name: string } }): ApiMatch {
  return {
    status: 'FINISHED',
    stage: 'GROUP_STAGE',
    group: null,
    matchday: null,
    score: { winner: null, duration: 'REGULAR', fullTime: { home: null, away: null } },
    ...overrides,
  };
}

describe('normTeam', () => {
  it('normaliza a lowercase y sin acentos', () => {
    expect(normTeam('Estados Unidos')).toBe('estadosunidos');
  });
  it('aplica ALIAS conocidos', () => {
    expect(normTeam('USA')).toBe('unitedstates');
    expect(normTeam('Korea Republic')).toBe('southkorea');
    expect(normTeam('Côte d\'Ivoire')).toBe('ivorycoast');
  });
  it('quita caracteres no-letra', () => {
    expect(normTeam('Saudi-Arabia')).toBe('saudiarabia');
    expect(normTeam('Congo DR')).toBe('congodr');
  });
  it('retorna el nombre si no tiene alias', () => {
    expect(normTeam('Bolivia')).toBe('bolivia');
  });
});

describe('teamKey', () => {
  it('ordena los equipos alfabéticamente', () => {
    const a = teamKey('Bolivia', 'Argentina');
    const b = teamKey('Argentina', 'Bolivia');
    expect(a).toBe(b);
    expect(a).toContain('argentina');
  });
});

describe('isPlaceholderName', () => {
  it('identifica placeholders de bracket', () => {
    expect(isPlaceholderName('W74')).toBe(true);
    expect(isPlaceholderName('3ABCDF')).toBe(true);
    expect(isPlaceholderName('2A')).toBe(true);
    expect(isPlaceholderName('TBD')).toBe(true);
  });
  it('identifica nombres reales', () => {
    expect(isPlaceholderName('Argentina')).toBe(false);
    expect(isPlaceholderName('Bolivia')).toBe(false);
  });
});

describe('linkMatches', () => {
  it('empareja por external_id con football-data', () => {
    const apiMatch = makeApiMatch({ id: 10, utcDate: 'x', homeTeam: { name: 'A' }, awayTeam: { name: 'B' } });
    const out = linkMatches(
      [apiMatch],
      [{ id: 'db1', external_id: 10, match_date: 'x', home_team: 'A', away_team: 'B' }],
      'football-data',
    );
    expect(out.size).toBe(1);
    expect(out.get(apiMatch)).toBe('db1');
  });

  it('ignora db sin external_id con football-data', () => {
    const out = linkMatches(
      [makeApiMatch({ id: 10, utcDate: 'x', homeTeam: { name: 'A' }, awayTeam: { name: 'B' } })],
      [{ id: 'db1', external_id: null, match_date: 'x', home_team: 'A', away_team: 'B' }],
      'football-data',
    );
    expect(out.size).toBe(0);
  });

  it('empareja por hora+equipos con espn', () => {
    const out = linkMatches(
      [makeApiMatch({ id: 100, utcDate: '2026-06-18T16:00:00Z', homeTeam: { name: 'Bolivia' }, awayTeam: { name: 'Argentina' } })],
      [{ id: 'db1', external_id: null, match_date: '2026-06-18T16:00:00Z', home_team: 'Bolivia', away_team: 'Argentina' }],
      'espn',
    );
    expect(out.size).toBe(1);
  });

  it('empareja por hora usando placeholder (eliminatoria sin bracket definido)', () => {
    const out = linkMatches(
      [makeApiMatch({ id: 100, utcDate: '2026-06-18T16:00:00Z', homeTeam: { name: 'W74' }, awayTeam: { name: 'W75' } })],
      [{ id: 'db1', external_id: null, match_date: '2026-06-18T16:00:00Z', home_team: 'W74', away_team: 'W75' }],
      'espn',
    );
    expect(out.size).toBe(1);
  });

  it('respeta normalización de equipos con espn', () => {
    const out = linkMatches(
      [makeApiMatch({ id: 100, utcDate: '2026-06-18T16:00:00Z', homeTeam: { name: 'USA' }, awayTeam: { name: 'Korea Republic' } })],
      [{ id: 'db1', external_id: null, match_date: '2026-06-18T16:00:00Z', home_team: 'USA', away_team: 'South Korea' }],
      'espn',
    );
    expect(out.size).toBe(1);
  });

  it('funciona con api-football', () => {
    const out = linkMatches(
      [makeApiMatch({ id: 100, utcDate: '2026-06-18T16:00:00Z', homeTeam: { name: 'Bolivia' }, awayTeam: { name: 'Argentina' } })],
      [{ id: 'db1', external_id: null, match_date: '2026-06-18T16:00:00Z', home_team: 'Bolivia', away_team: 'Argentina' }],
      'api-football',
    );
    expect(out.size).toBe(1);
  });
});
