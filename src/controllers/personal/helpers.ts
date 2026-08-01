import { prisma } from '../../lib/prisma';
import { fromZonedTime } from 'date-fns-tz';
import { getTimezone } from '../../lib/dateUtils';
import { Request } from 'express';

export function getEffectiveUserId(req: Request): string {
  const user = req.user as any;
  if (user?.isImpersonating && user?.targetUserId) {
    return user.targetUserId;
  }
  return user?.id;
}

const DEFAULT_CATEGORIES = [
  { nome: 'Salário', tipo: 'ENTRADA', icone: '💰' },
  { nome: 'Freelance', tipo: 'ENTRADA', icone: '💻' },
  { nome: 'Investimentos', tipo: 'ENTRADA', icone: '📈' },
  { nome: 'Outras Receitas', tipo: 'ENTRADA', icone: '📥' },
  { nome: 'Alimentação', tipo: 'SAIDA', icone: '🍔' },
  { nome: 'Moradia', tipo: 'SAIDA', icone: '🏠' },
  { nome: 'Transporte', tipo: 'SAIDA', icone: '🚗' },
  { nome: 'Saúde', tipo: 'SAIDA', icone: '🏥' },
  { nome: 'Educação', tipo: 'SAIDA', icone: '📚' },
  { nome: 'Lazer', tipo: 'SAIDA', icone: '🎮' },
  { nome: 'Assinaturas', tipo: 'SAIDA', icone: '📋' },
  { nome: 'Compras', tipo: 'SAIDA', icone: '🛍️' },
  { nome: 'Delivery', tipo: 'SAIDA', icone: '📦' },
  { nome: 'Serviços', tipo: 'SAIDA', icone: '🔧' },
  { nome: 'Impostos', tipo: 'SAIDA', icone: '📊' },
  { nome: 'Emergência', tipo: 'SAIDA', icone: '🆘' },
];

export async function ensureCategories(userId: string): Promise<void> {
  const count = await prisma.personalCategory.count({ where: { userId } });
  if (count === 0) {
    await prisma.personalCategory.createMany({
      data: DEFAULT_CATEGORIES.map(c => ({ ...c, userId })),
    });
  }
}

const DEFAULT_WALLETS = [
  { nome: 'Conta Corrente', icone: '🏦' },
  { nome: 'Carteira Física', icone: '👛' },
  { nome: 'Cartão de Crédito', icone: '💳' },
  { nome: 'Poupança', icone: '🏧' },
];

export async function ensureWallets(userId: string): Promise<void> {
  const count = await prisma.personalWallet.count({ where: { userId } });
  if (count === 0) {
    await prisma.personalWallet.createMany({
      data: DEFAULT_WALLETS.map(w => ({ ...w, userId })),
    });
  }
}

export async function getCycleRange(userId: string, mes: number, ano: number): Promise<{ start: Date; end: Date }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { billingCycleStartDay: true },
  });
  const startDay = user?.billingCycleStartDay || 1;
  const tz = getTimezone();

  if (startDay === 1) {
    return {
      start: fromZonedTime(`${ano}-${String(mes).padStart(2, '0')}-01T00:00:00.000`, tz),
      end: fromZonedTime(`${ano}-${String(mes + 1).padStart(2, '0')}-01T00:00:00.000`, tz),
    };
  }

  const startStr = `${ano}-${String(mes).padStart(2, '0')}-${String(startDay).padStart(2, '0')}T00:00:00.000`;
  const endStr = `${ano}-${String(mes + 1).padStart(2, '0')}-${String(startDay).padStart(2, '0')}T00:00:00.000`;
  return {
    start: fromZonedTime(startStr, tz),
    end: fromZonedTime(endStr, tz),
  };
}

export async function getUserBillingDay(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { billingCycleStartDay: true },
  });
  return user?.billingCycleStartDay || 1;
}
