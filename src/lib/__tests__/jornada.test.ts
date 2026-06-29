import { describe, it, expect } from 'vitest';
import {
  JORNADA_CLOSE_MS,
  REVEAL_BEFORE_MS,
  isCutoffPassed,
  boliviaDayKey,
  MATCH_MAX_MS,
  countsUnresolved,
  jornadaLockState,
} from '@/lib/jornada';

describe('isCutoffPassed', () => {
  it('retorna true si falta <= JORNADA_CLOSE_MS', () => {
    const firstMatchMs = 1_000_000_000_000;
    const nowMs        = firstMatchMs - JORNADA_CLOSE_MS;
    expect(isCutoffPassed(firstMatchMs, nowMs)).toBe(true);
  });
  it('retorna false si falta más que JORNADA_CLOSE_MS', () => {
    const firstMatchMs = 1_000_000_000_000;
    const nowMs        = firstMatchMs - JORNADA_CLOSE_MS - 1;
    expect(isCutoffPassed(firstMatchMs, nowMs)).toBe(false);
  });
});

describe('boliviaDayStart / boliviaDayKey', () => {
  // 03:00 BOT = 07:00 UTC. Un partido a las 06:59 UTC (02:59 BOT) cae en el día anterior.
  const diaJuevesBOT = new Date('2026-06-18T07:00:00Z'); // 03:00 BOT jueves

  it('partido a 02:59 BOT cae en día anterior', () => {
    const ms = new Date('2026-06-18T06:59:00Z').getTime();
    expect(boliviaDayKey(ms)).toBe(boliviaDayKey(diaJuevesBOT.getTime() - 86400000));
  });
  it('partido a 03:00 BOT cae en el día correcto', () => {
    const ms = new Date('2026-06-18T07:00:00Z').getTime();
    expect(boliviaDayKey(ms)).toBe(boliviaDayKey(diaJuevesBOT.getTime()));
  });
  it('partido a medianoche (00:00 BOT) cae con el día anterior', () => {
    const ms = new Date('2026-06-19T04:00:00Z').getTime(); // 00:00 BOT
    expect(boliviaDayKey(ms)).toBe(boliviaDayKey(diaJuevesBOT.getTime()));
  });
});

describe('countsUnresolved', () => {
  it('retorna true dentro de MATCH_MAX_MS', () => {
    const kickoff = 1_000_000_000_000;
    expect(countsUnresolved(kickoff, kickoff)).toBe(true);
    expect(countsUnresolved(kickoff, kickoff + MATCH_MAX_MS - 1)).toBe(true);
  });
  it('retorna false después de MATCH_MAX_MS', () => {
    const kickoff = 1_000_000_000_000;
    expect(countsUnresolved(kickoff, kickoff + MATCH_MAX_MS)).toBe(false);
    expect(countsUnresolved(kickoff, kickoff + MATCH_MAX_MS + 1000)).toBe(false);
  });
});

describe('jornadaLockState', () => {
  const firstMatchMs = 1_000_000_000_000;


  it('closed si cutoff pasado', () => {
    expect(jornadaLockState({
      firstMatchMs,
      nowMs: firstMatchMs - JORNADA_CLOSE_MS,
      sameDayStarted: false,
      hasMatchInProgress: false,
      hasEarlierUnfinished: false,
    })).toBe('closed');
  });

  it('prevPending si hay partidos anteriores sin terminar y no empezó el día', () => {
    expect(jornadaLockState({
      firstMatchMs,
      nowMs: firstMatchMs - JORNADA_CLOSE_MS - 10000,
      sameDayStarted: false,
      hasMatchInProgress: false,
      hasEarlierUnfinished: true,
    })).toBe('prevPending');
  });

  it('ongoingLock si sameDayStarted', () => {
    expect(jornadaLockState({
      firstMatchMs,
      nowMs: firstMatchMs - JORNADA_CLOSE_MS - 10000,
      sameDayStarted: true,
      hasMatchInProgress: false,
      hasEarlierUnfinished: false,
    })).toBe('ongoingLock');
  });

  it('ongoingLock si hay partido en curso', () => {
    expect(jornadaLockState({
      firstMatchMs,
      nowMs: firstMatchMs - JORNADA_CLOSE_MS - 10000,
      sameDayStarted: false,
      hasMatchInProgress: true,
      hasEarlierUnfinished: false,
    })).toBe('ongoingLock');
  });

  it('open cuando no hay bloqueo', () => {
    expect(jornadaLockState({
      firstMatchMs,
      nowMs: firstMatchMs - JORNADA_CLOSE_MS - 10000,
      sameDayStarted: false,
      hasMatchInProgress: false,
      hasEarlierUnfinished: false,
    })).toBe('open');
  });

  it('closed tiene prioridad sobre prevPending', () => {
    expect(jornadaLockState({
      firstMatchMs,
      nowMs: firstMatchMs - JORNADA_CLOSE_MS,
      sameDayStarted: false,
      hasMatchInProgress: false,
      hasEarlierUnfinished: true,
    })).toBe('closed');
  });

  it('ongoingLock sobre prevPending si ya empezó el día', () => {
    expect(jornadaLockState({
      firstMatchMs,
      nowMs: firstMatchMs - JORNADA_CLOSE_MS - 10000,
      sameDayStarted: true,
      hasMatchInProgress: false,
      hasEarlierUnfinished: true,
    })).toBe('ongoingLock');
  });

  it('REVEAL_BEFORE_MS es menor que JORNADA_CLOSE_MS', () => {
    expect(REVEAL_BEFORE_MS).toBeLessThan(JORNADA_CLOSE_MS);
  });
});
