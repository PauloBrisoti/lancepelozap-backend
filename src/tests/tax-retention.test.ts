import { describe, it, expect } from 'vitest';
import { TaxRetentionService } from '../services/TaxRetentionService';

describe('TaxRetentionService', () => {
  it('calcula tributos com arredondamento ao centavo', () => {
    const result = TaxRetentionService.calculate(123.45, [
      { tipo: 'ISS', aliquota: 2.5 },
      { tipo: 'IRRF', aliquota: 1.5 },
      { tipo: 'PIS', aliquota: 0.65 },
    ]);

    expect(result).toEqual([
      { tipo: 'ISS', aliquota: 2.5, valorBase: 123.45, valorRetido: 3.09 },
      { tipo: 'IRRF', aliquota: 1.5, valorBase: 123.45, valorRetido: 1.85 },
      { tipo: 'PIS', aliquota: 0.65, valorBase: 123.45, valorRetido: 0.8 },
    ]);
  });

  it('respeita base mínima, regra inativa e base específica', () => {
    const result = TaxRetentionService.calculate(1000, [
      { tipo: 'ISS', aliquota: 5, baseMinima: 2000 },
      { tipo: 'IRRF', aliquota: 1.5, ativo: false },
      { tipo: 'PIS', aliquota: 0.65, baseCalculo: 500 },
    ]);

    expect(result).toEqual([
      { tipo: 'PIS', aliquota: 0.65, valorBase: 500, valorRetido: 3.25 },
    ]);
  });

  it('rejeita alíquota fora do intervalo e tipo duplicado', () => {
    expect(() =>
      TaxRetentionService.calculate(100, [{ tipo: 'ISS', aliquota: 101 }])
    ).toThrow(/Alíquota inválida/);

    expect(() =>
      TaxRetentionService.calculate(100, [
        { tipo: 'ISS', aliquota: 5 },
        { tipo: 'ISS', aliquota: 3 },
      ])
    ).toThrow(/duplicada/);
  });

  it('formata competência como YYYY-MM', () => {
    expect(TaxRetentionService.formatCompetencia(new Date('2026-11-05T12:00:00Z'))).toBe('2026-11');
    expect(() => TaxRetentionService.normalizeCompetencia('11/2026')).toThrow(/YYYY-MM/);
  });
});
