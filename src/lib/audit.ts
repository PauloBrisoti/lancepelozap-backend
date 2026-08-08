import { prisma } from './prisma';
import { logger } from '../lib/logger';

export async function auditLog(params: {
  storeId?: string | null;
  userId: string;
  acao: string;
  tabelaAfetada: string;
  dadosAntigos?: unknown;
  dadosNovos?: unknown;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        storeId: params.storeId || null,
        userId: params.userId,
        acao: params.acao,
        tabelaAfetada: params.tabelaAfetada,
        dadosAntigos: params.dadosAntigos ? JSON.parse(JSON.stringify(params.dadosAntigos)) : undefined,
        dadosNovos: params.dadosNovos ? JSON.parse(JSON.stringify(params.dadosNovos)) : undefined,
      },
    });
  } catch (error) {
    logger.error('Erro ao registrar audit log:', error);
  }
}
