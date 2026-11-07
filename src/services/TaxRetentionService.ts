import { Prisma, TaxRetention } from '@prisma/client';
import { HttpError } from '../lib/asyncHandler';

export const TAX_RETENTION_TYPES = ['IRRF', 'ISS', 'PIS', 'COFINS', 'CSLL', 'INSS'] as const;
export type TaxRetentionType = (typeof TAX_RETENTION_TYPES)[number];

export type TaxRetentionOrigin = 'VENDA' | 'ORDEM_SERVICO' | 'CONTA_PAGAR' | 'MANUAL';
export type TaxRetentionStatus = 'RETIDO' | 'RECOLHIDO' | 'DISPENSADO';

/**
 * Regra de retenção aplicável ao documento.
 * `aliquota` é percentual (ex.: 5 = 5%). `baseCalculo` permite usar uma base
 * diferente do valor total do documento (ex.: ISS sobre o valor dos serviços,
 * não sobre o total com peças). `baseMinima` dispensa a retenção abaixo do piso.
 */
export interface TaxRetentionRule {
  tipo: TaxRetentionType;
  aliquota: number;
  baseCalculo?: number;
  baseMinima?: number;
  ativo?: boolean;
}

export interface TaxRetentionDocument {
  storeId: string;
  referenceId?: string | null;
  origemTipo: TaxRetentionOrigin;
  valorBase: number;
  data?: Date;
  competencia?: string;
  status?: TaxRetentionStatus;
}

export interface CalculatedRetention {
  tipo: TaxRetentionType;
  aliquota: number;
  valorBase: number;
  valorRetido: number;
}

export class TaxRetentionService {
  private static readonly MAX_ALIQUOTA = 100;

  /**
   * Competência fiscal no formato YYYY-MM.
   */
  static formatCompetencia(date: Date = new Date()): string {
    const d = new Date(date);
    if (isNaN(d.getTime())) {
      throw new HttpError('Data inválida para apuração da competência fiscal.', 400);
    }
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  static normalizeCompetencia(competencia: string): string {
    const value = String(competencia).trim();
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
    if (!match) {
      throw new HttpError('Competência inválida. Use o formato YYYY-MM.', 400);
    }
    return value;
  }

  /**
   * Calcula as retenções sem tocar no banco. Retorna somente tributos com
   * valor retido maior que zero, arredondado ao centavo.
   */
  static calculate(
    valorBase: number,
    rules: readonly TaxRetentionRule[]
  ): CalculatedRetention[] {
    const base = Number(valorBase);
    if (!Number.isFinite(base) || base < 0) {
      throw new HttpError('Valor base inválido para cálculo de retenções.', 400);
    }

    const seen = new Set<string>();
    const result: CalculatedRetention[] = [];

    for (const rule of rules) {
      if (rule.ativo === false) continue;

      if (!(TAX_RETENTION_TYPES as readonly string[]).includes(rule.tipo)) {
        throw new HttpError(`Tipo de retenção inválido: ${rule.tipo}.`, 400);
      }

      if (seen.has(rule.tipo)) {
        throw new HttpError(`Regra de retenção duplicada para ${rule.tipo}.`, 400);
      }
      seen.add(rule.tipo);

      const aliquota = Number(rule.aliquota);
      if (!Number.isFinite(aliquota) || aliquota < 0 || aliquota > this.MAX_ALIQUOTA) {
        throw new HttpError(`Alíquota inválida para ${rule.tipo}: ${rule.aliquota}.`, 400);
      }

      const baseCalculo = rule.baseCalculo !== undefined ? Number(rule.baseCalculo) : base;
      if (!Number.isFinite(baseCalculo) || baseCalculo <= 0) continue;

      if (rule.baseMinima !== undefined && baseCalculo < Number(rule.baseMinima)) continue;

      const baseCents = Math.round(baseCalculo * 100);
      const aliquotaBasisPoints = Math.round(aliquota * 100);
      const retidoCents = Math.round((baseCents * aliquotaBasisPoints) / 10000);

      if (retidoCents <= 0) continue;

      result.push({
        tipo: rule.tipo,
        aliquota,
        valorBase: baseCents / 100,
        valorRetido: retidoCents / 100,
      });
    }

    return result;
  }

  /**
   * Calcula e registra as retenções dentro da transação de consolidação.
   * Idempotente por (storeId, referenceId, competencia, tipo).
   */
  static async record(
    tx: Prisma.TransactionClient,
    document: TaxRetentionDocument,
    rules: readonly TaxRetentionRule[]
  ): Promise<TaxRetention[]> {
    if (!document.storeId) {
      throw new HttpError('storeId é obrigatório para registrar retenções.', 400);
    }

    const dataRetencao = document.data ? new Date(document.data) : new Date();
    if (isNaN(dataRetencao.getTime())) {
      throw new HttpError('Data de retenção inválida.', 400);
    }

    const competencia = document.competencia
      ? this.normalizeCompetencia(document.competencia)
      : this.formatCompetencia(dataRetencao);

    const calculated = this.calculate(document.valorBase, rules);
    if (calculated.length === 0) return [];

    const referenceId = document.referenceId || null;
    const existingTypes = new Set<string>();

    if (referenceId) {
      const existing = await tx.taxRetention.findMany({
        where: {
          storeId: document.storeId,
          referenceId,
          competencia,
          tipo: { in: calculated.map((line) => line.tipo) },
        },
        select: { tipo: true },
      });
      existing.forEach((item) => existingTypes.add(item.tipo));
    }

    const created: TaxRetention[] = [];

    for (const line of calculated) {
      if (existingTypes.has(line.tipo)) continue;

      const retention = await tx.taxRetention.create({
        data: {
          storeId: document.storeId,
          tipo: line.tipo,
          aliquota: line.aliquota,
          valorBase: line.valorBase,
          valorRetido: line.valorRetido,
          competencia,
          dataRetencao,
          referenceId,
          origemTipo: document.origemTipo,
          status: document.status ?? 'RETIDO',
        },
      });

      created.push(retention);
    }

    return created;
  }

  /**
   * Alias de intenção para o ponto de consolidação fiscal.
   */
  static calculateAndRecord(
    tx: Prisma.TransactionClient,
    document: TaxRetentionDocument,
    rules: readonly TaxRetentionRule[]
  ): Promise<TaxRetention[]> {
    return this.record(tx, document, rules);
  }
}
