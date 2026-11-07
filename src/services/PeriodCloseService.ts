import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { auditLog } from '../lib/audit';
import { HttpError } from '../lib/asyncHandler';

type DbClient = Prisma.TransactionClient | typeof prisma;

export class PeriodCloseService {
  /**
   * Verifica se a data fornecida pertence a um período contábil já fechado para a loja.
   */
  static async isPeriodClosed(
    storeId: string,
    targetDate: Date | string,
    tx?: Prisma.TransactionClient
  ): Promise<boolean> {
    const d = new Date(targetDate);
    if (isNaN(d.getTime())) return false;

    const ano = d.getUTCFullYear();
    const mes = d.getUTCMonth() + 1;
    const db: DbClient = tx ?? prisma;

    const close = await db.periodClose.findUnique({
      where: {
        storeId_ano_mes: { storeId, ano, mes },
      },
    });

    return !!close;
  }

  /**
   * Garante que o período contábil esteja ABERTO para a operação.
   * Lança HTTP 409 (Conflict) caso o período já tenha sido fechado.
   */
  static async assertPeriodIsOpen(
    storeId: string,
    targetDate: Date | string,
    tx?: Prisma.TransactionClient,
    operacao: string = 'lançamentos'
  ): Promise<void> {
    const closed = await this.isPeriodClosed(storeId, targetDate, tx);
    if (!closed) return;

    const d = new Date(targetDate);
    const mesFormatado = String(d.getUTCMonth() + 1).padStart(2, '0');
    const ano = d.getUTCFullYear();

    throw new HttpError(
      `Período contábil fechado para ${mesFormatado}/${ano}. Não são permitidas alterações retroativas de ${operacao}.`,
      409
    );
  }

  /**
   * Alias retrocompatível. Prefira `assertPeriodIsOpen`.
   * @deprecated
   */
  static async assertPeriodOpen(
    storeId: string,
    targetDate: Date | string,
    operacao: string = 'lançamentos'
  ): Promise<void> {
    return this.assertPeriodIsOpen(storeId, targetDate, undefined, operacao);
  }

  /**
   * Fecha formalmente o período contábil de um mês/ano para a loja.
   */
  static async closePeriod(params: {
    storeId: string;
    ano: number;
    mes: number;
    userId: string;
    observacao?: string;
  }) {
    const { storeId, ano, mes, userId, observacao } = params;

    if (mes < 1 || mes > 12) {
      throw new Error('Mês inválido (deve ser entre 1 e 12).');
    }

    const agora = new Date();
    if (ano > agora.getFullYear() || (ano === agora.getFullYear() && mes > agora.getMonth() + 1)) {
      throw new Error('Não é permitido fechar períodos futuros.');
    }

    const record = await prisma.periodClose.upsert({
      where: { storeId_ano_mes: { storeId, ano, mes } },
      update: {
        closedBy: userId,
        observacao,
        closedAt: new Date(),
      },
      create: {
        storeId,
        ano,
        mes,
        closedBy: userId,
        observacao,
      },
    });

    await auditLog({
      storeId,
      userId,
      acao: 'FECHAMENTO_PERIODO',
      tabelaAfetada: 'period_closes',
      dadosNovos: { ano, mes, observacao },
    });

    return record;
  }

  /**
   * Reabre um período previamente fechado (exige justificativa formal de auditoria).
   */
  static async reopenPeriod(params: {
    storeId: string;
    ano: number;
    mes: number;
    userId: string;
    motivo: string;
  }) {
    const { storeId, ano, mes, userId, motivo } = params;

    if (!motivo || motivo.trim().length < 10) {
      throw new Error('Justificativa obrigatória (mínimo de 10 caracteres) para reabertura de período contábil.');
    }

    const existing = await prisma.periodClose.findUnique({
      where: { storeId_ano_mes: { storeId, ano, mes } },
    });

    if (!existing) {
      throw new Error(`O período ${String(mes).padStart(2, '0')}/${ano} não está fechado.`);
    }

    await prisma.periodClose.delete({
      where: { storeId_ano_mes: { storeId, ano, mes } },
    });

    await auditLog({
      storeId,
      userId,
      acao: 'REABERTURA_PERIODO',
      tabelaAfetada: 'period_closes',
      dadosAntigos: existing,
      dadosNovos: { motivo },
    });

    return { message: `Período ${String(mes).padStart(2, '0')}/${ano} reaberto com sucesso.` };
  }

  /**
   * Lista os períodos fechados de uma loja.
   */
  static async list(storeId: string) {
    return prisma.periodClose.findMany({
      where: { storeId },
      orderBy: [{ ano: 'desc' }, { mes: 'desc' }],
    });
  }
}
