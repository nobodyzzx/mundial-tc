import { describe, it, expect } from 'vitest';
import {
  haPagadoDeposito,
  haPagadoCompleto,
  aportePozo,
  cuotaReferi,
  estadoPago,
  resumenPozo,
  DEPOSITO_BS,
  PAGO_COMPLETO_BS,
  CUOTA_REFERI_BS,
  APORTE_POZO_MAX_BS,
} from '@/lib/payments';

describe('haPagadoDeposito', () => {
  it('retorna false con null/undefined', () => {
    expect(haPagadoDeposito(null)).toBe(false);
    expect(haPagadoDeposito(undefined)).toBe(false);
  });
  it('retorna false con 0', () => {
    expect(haPagadoDeposito(0)).toBe(false);
  });
  it('retorna false por debajo del mínimo', () => {
    expect(haPagadoDeposito(DEPOSITO_BS - 1)).toBe(false);
  });
  it('retorna true con el mínimo exacto', () => {
    expect(haPagadoDeposito(DEPOSITO_BS)).toBe(true);
  });
  it('retorna true por encima del mínimo', () => {
    expect(haPagadoDeposito(DEPOSITO_BS + 10)).toBe(true);
  });
});

describe('haPagadoCompleto', () => {
  it('retorna false con null/undefined', () => {
    expect(haPagadoCompleto(null)).toBe(false);
    expect(haPagadoCompleto(undefined)).toBe(false);
  });
  it('retorna false por debajo de completo', () => {
    expect(haPagadoCompleto(PAGO_COMPLETO_BS - 1)).toBe(false);
  });
  it('retorna true con el completo exacto', () => {
    expect(haPagadoCompleto(PAGO_COMPLETO_BS)).toBe(true);
  });
  it('retorna true por encima de completo', () => {
    expect(haPagadoCompleto(PAGO_COMPLETO_BS + 50)).toBe(true);
  });
});

describe('aportePozo', () => {
  it('retorna 0 si no llegó al depósito', () => {
    expect(aportePozo(DEPOSITO_BS - 1)).toBe(0);
    expect(aportePozo(0)).toBe(0);
    expect(aportePozo(null)).toBe(0);
  });
  it('retorna monto - cuotaReferi si llegó al depósito', () => {
    expect(aportePozo(DEPOSITO_BS)).toBe(DEPOSITO_BS - CUOTA_REFERI_BS);
  });
  it('topea al APORTE_POZO_MAX_BS', () => {
    expect(aportePozo(PAGO_COMPLETO_BS)).toBe(APORTE_POZO_MAX_BS);
    expect(aportePozo(200)).toBe(APORTE_POZO_MAX_BS);
  });
});

describe('cuotaReferi', () => {
  it('retorna 0 si no pagó depósito', () => {
    expect(cuotaReferi(0)).toBe(0);
    expect(cuotaReferi(null)).toBe(0);
  });
  it('retorna CUOTA_REFERI_BS si pagó depósito', () => {
    expect(cuotaReferi(DEPOSITO_BS)).toBe(CUOTA_REFERI_BS);
    expect(cuotaReferi(PAGO_COMPLETO_BS)).toBe(CUOTA_REFERI_BS);
    expect(cuotaReferi(200)).toBe(CUOTA_REFERI_BS);
  });
});

describe('estadoPago', () => {
  it('retorna pendiente con 0/null', () => {
    expect(estadoPago(0)).toBe('pendiente');
    expect(estadoPago(null)).toBe('pendiente');
  });
  it('retorna parcial entre depósito y completo', () => {
    expect(estadoPago(DEPOSITO_BS)).toBe('parcial');
    expect(estadoPago(DEPOSITO_BS + 10)).toBe('parcial');
  });
  it('retorna completo al alcanzar PAGO_COMPLETO_BS', () => {
    expect(estadoPago(PAGO_COMPLETO_BS)).toBe('completo');
    expect(estadoPago(PAGO_COMPLETO_BS + 1)).toBe('completo');
  });
});

describe('resumenPozo', () => {
  it('retorna ceros con lista vacía', () => {
    const r = resumenPozo([]);
    expect(r.total).toBe(0);
    expect(r.pozo).toBe(0);
    expect(r.referi).toBe(0);
    expect(r.participantes).toBe(0);
  });

  it('ignora null/undefined', () => {
    const r = resumenPozo([null, undefined, 0]);
    expect(r.pendientes).toBe(3);
    expect(r.participantes).toBe(0);
    expect(r.total).toBe(0);
  });

  it('suma pozo y referi con pagos parciales', () => {
    const r = resumenPozo([DEPOSITO_BS]);
    expect(r.total).toBe(DEPOSITO_BS);
    expect(r.pozo).toBe(DEPOSITO_BS - CUOTA_REFERI_BS);
    expect(r.referi).toBe(CUOTA_REFERI_BS);
    expect(r.parciales).toBe(1);
    expect(r.participantes).toBe(1);
  });

  it('topea el pozo con pagos completos', () => {
    const r = resumenPozo([PAGO_COMPLETO_BS]);
    expect(r.total).toBe(PAGO_COMPLETO_BS);
    expect(r.pozo).toBe(APORTE_POZO_MAX_BS);
    expect(r.referi).toBe(CUOTA_REFERI_BS);
    expect(r.completos).toBe(1);
  });

  it('invariante: total === pozo + referi si nadie sobrepasa el tope', () => {
    const montos = [0, DEPOSITO_BS, DEPOSITO_BS + 10, PAGO_COMPLETO_BS];
    const r = resumenPozo(montos);
    expect(r.total).toBe(r.pozo + r.referi);
  });
});
