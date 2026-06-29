import { describe, it, expect } from 'vitest';
import { fmtFecha, fmtDiaKey } from '@/lib/fechas';

describe('fmtFecha', () => {
  it('formatea fecha completa sin opciones', () => {
    const date = new Date('2026-06-18T16:00:00Z'); // 12:00 BOT
    const result = fmtFecha(date);
    expect(result).toContain('2026');
    expect(result).toContain('12:00');
  });

  it('acepta string ISO', () => {
    const result = fmtFecha('2026-06-18T16:00:00Z');
    expect(result).toContain('12:00');
  });

  it('acepta timestamp numérico', () => {
    const ts = new Date('2026-06-18T16:00:00Z').getTime();
    const result = fmtFecha(ts);
    expect(result).toContain('12:00');
  });

  it('aplica opciones de formato', () => {
    const date = new Date('2026-06-18T16:00:00Z');
    const result = fmtFecha(date, { weekday: 'long' });
    expect(result.toLowerCase()).toContain('jueves');
  });
});

describe('fmtDiaKey', () => {
  it('retorna YYYY-MM-DD en zona Bolivia', () => {
    const date = new Date('2026-06-18T07:00:00Z'); // 03:00 BOT
    expect(fmtDiaKey(date)).toBe('2026-06-18');
  });

  it('un partido de madrugada mantiene su fecha calendario', () => {
    const date = new Date('2026-06-19T04:00:00Z'); // 00:00 BOT
    expect(fmtDiaKey(date)).toBe('2026-06-19');
  });
});
