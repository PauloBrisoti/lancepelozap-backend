import { Request, Response } from 'express';
import { whatsappConfigService } from '../services/WhatsAppConfigService';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export class WhatsAppConfigController {
  /**
   * GET /api/whatsapp/config
   * Buscar configuração WhatsApp da loja
   */
  static async getConfig(req: Request, res: Response): Promise<void> {
    try {
      const { storeId } = req.user!;
      const config = await whatsappConfigService.getOrCreateConfig(storeId);
      res.json(config);
    } catch (error: any) {
      logger.error('[WhatsAppConfig] Erro ao buscar config:', error);
      res.status(500).json({ error: 'Erro ao buscar configuração' });
    }
  }

  /**
   * PUT /api/whatsapp/config
   * Atualizar configuração WhatsApp da loja
   */
  static async updateConfig(req: Request, res: Response): Promise<void> {
    try {
      const { storeId } = req.user!;
      const { billingEnabled, disclaimerAccepted, sendReceiptText, sendReceiptPdf } = req.body;

      const config = await whatsappConfigService.updateConfig(storeId, {
        billingEnabled,
        disclaimerAccepted,
        sendReceiptText,
        sendReceiptPdf,
      });

      res.json(config);
    } catch (error: any) {
      logger.error('[WhatsAppConfig] Erro ao atualizar config:', error);
      res.status(400).json({ error: error.message || 'Erro ao atualizar configuração' });
    }
  }

  /**
   * GET /api/whatsapp/config/rules
   * Listar regras de cobrança
   */
  static async getRules(req: Request, res: Response): Promise<void> {
    try {
      const { storeId } = req.user!;
      const config = await whatsappConfigService.getOrCreateConfig(storeId);
      res.json(config.rules);
    } catch (error: any) {
      logger.error('[WhatsAppConfig] Erro ao buscar regras:', error);
      res.status(500).json({ error: 'Erro ao buscar regras' });
    }
  }

  /**
   * POST /api/whatsapp/config/rules
   * Criar regra de cobrança
   */
  static async createRule(req: Request, res: Response): Promise<void> {
    try {
      const { storeId } = req.user!;
      const config = await whatsappConfigService.getOrCreateConfig(storeId);
      const rule = await whatsappConfigService.createRule(config.id, req.body);
      res.status(201).json(rule);
    } catch (error: any) {
      logger.error('[WhatsAppConfig] Erro ao criar regra:', error);
      res.status(400).json({ error: error.message || 'Erro ao criar regra' });
    }
  }

  /**
   * PUT /api/whatsapp/config/rules/:ruleId
   * Atualizar regra de cobrança
   */
  static async updateRule(req: Request, res: Response): Promise<void> {
    try {
      const { storeId } = req.user!;
      const { ruleId } = req.params;
      const config = await whatsappConfigService.getOrCreateConfig(storeId);
      const rule = await whatsappConfigService.updateRule(config.id, ruleId as string, req.body);
      res.json(rule);
    } catch (error: any) {
      logger.error('[WhatsAppConfig] Erro ao atualizar regra:', error);
      res.status(400).json({ error: error.message || 'Erro ao atualizar regra' });
    }
  }

  /**
   * DELETE /api/whatsapp/config/rules/:ruleId
   * Deletar regra de cobrança
   */
  static async deleteRule(req: Request, res: Response): Promise<void> {
    try {
      const { storeId } = req.user!;
      const { ruleId } = req.params;
      const config = await whatsappConfigService.getOrCreateConfig(storeId);
      await whatsappConfigService.deleteRule(config.id, ruleId as string);
      res.json({ message: 'Regra removida' });
    } catch (error: any) {
      logger.error('[WhatsAppConfig] Erro ao deletar regra:', error);
      res.status(400).json({ error: error.message || 'Erro ao deletar regra' });
    }
  }

  /**
   * GET /api/whatsapp/logs
   * Listar logs de mensagens enviadas
   */
  static async getLogs(req: Request, res: Response): Promise<void> {
    try {
      const { storeId } = req.user!;
      const { tipo, page = '1', limit = '50' } = req.query;

      const skip = (Number(page) - 1) * Number(limit);

      const where: any = { storeId };
      if (tipo) where.tipo = tipo;

      const [logs, total] = await Promise.all([
        prisma.whatsAppMessageLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: Number(limit),
        }),
        prisma.whatsAppMessageLog.count({ where }),
      ]);

      res.json({ logs, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
    } catch (error: any) {
      logger.error('[WhatsAppConfig] Erro ao buscar logs:', error);
      res.status(500).json({ error: 'Erro ao buscar logs' });
    }
  }
}
