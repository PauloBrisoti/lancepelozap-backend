import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export interface WhatsAppConfigData {
  billingEnabled: boolean;
  disclaimerAccepted: boolean;
  sendReceiptText: boolean;
  sendReceiptPdf: boolean;
}

export interface BillingRuleData {
  id?: string;
  ruleType: string;
  diasOffset: number;
  mensagem: string;
  ativo: boolean;
}

const DEFAULT_RULES: Omit<BillingRuleData, 'id'>[] = [
  {
    ruleType: 'DIAS_ANTES_VENC',
    diasOffset: -2,
    mensagem: 'Olá! Lembrete: sua parcela vence em 2 dias. Valor: {valor}. Pix Copia e Cola: {pix}',
    ativo: false,
  },
  {
    ruleType: 'DIA_VENC',
    diasOffset: 0,
    mensagem: 'Olá! Sua parcela vence HOJE. Valor: {valor}. Pix Copia e Cola: {pix}',
    ativo: false,
  },
  {
    ruleType: 'DIAS_APOS_VENC',
    diasOffset: 1,
    mensagem: 'Olá! Sua parcela está em atraso. Valor: {valor}. Regularize para evitar bloqueio. Pix Copia e Cola: {pix}',
    ativo: false,
  },
];

class WhatsAppConfigService {
  /**
   * Buscar ou criar config de WhatsApp para uma loja
   */
  async getOrCreateConfig(storeId: string) {
    let config = await prisma.whatsAppConfig.findUnique({
      where: { storeId },
      include: { rules: { orderBy: { diasOffset: 'asc' } } },
    });

    if (!config) {
      config = await prisma.whatsAppConfig.create({
        data: {
          storeId,
          rules: {
            create: DEFAULT_RULES,
          },
        },
        include: { rules: { orderBy: { diasOffset: 'asc' } } },
      });
      logger.info(`[WhatsAppConfig] Config criada para loja ${storeId}`);
    }

    return config;
  }

  /**
   * Atualizar configuração da loja
   */
  async updateConfig(storeId: string, data: Partial<WhatsAppConfigData>) {
    const config = await this.getOrCreateConfig(storeId);

    // Se estáativando billing, exige disclaimer aceito
    if (data.billingEnabled && !data.disclaimerAccepted && !config.disclaimerAccepted) {
      throw new Error('Você precisa aceitar o disclaimer de segurança antes de ativar a régua de cobrança.');
    }

    const updated = await prisma.whatsAppConfig.update({
      where: { id: config.id },
      data,
      include: { rules: { orderBy: { diasOffset: 'asc' } } },
    });

    logger.info(`[WhatsAppConfig] Config atualizada para loja ${storeId}: ${JSON.stringify(data)}`);
    return updated;
  }

  /**
   * Atualizar uma regra de cobrança
   */
  async updateRule(configId: string, ruleId: string, data: Partial<BillingRuleData>) {
    const rule = await prisma.whatsAppBillingRule.findFirst({
      where: { id: ruleId, configId },
    });

    if (!rule) {
      throw new Error('Regra não encontrada');
    }

    return prisma.whatsAppBillingRule.update({
      where: { id: ruleId },
      data,
    });
  }

  /**
   * Criar nova regra de cobrança
   */
  async createRule(configId: string, data: Omit<BillingRuleData, 'id'>) {
    return prisma.whatsAppBillingRule.create({
      data: {
        configId,
        ruleType: data.ruleType,
        diasOffset: data.diasOffset,
        mensagem: data.mensagem,
        ativo: data.ativo,
      },
    });
  }

  /**
   * Deletar regra de cobrança
   */
  async deleteRule(configId: string, ruleId: string) {
    const rule = await prisma.whatsAppBillingRule.findFirst({
      where: { id: ruleId, configId },
    });

    if (!rule) {
      throw new Error('Regra não encontrada');
    }

    return prisma.whatsAppBillingRule.delete({ where: { id: ruleId } });
  }
}

export const whatsappConfigService = new WhatsAppConfigService();
