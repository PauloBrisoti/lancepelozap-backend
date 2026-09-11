import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { wuzapiService } from '../services/WuzapiService';
import { logger } from '../lib/logger';

export class WuzapiController {
  /**
   * POST /api/whatsapp/sessions
   * Criar nova sessão WhatsApp para a empresa
   */
  static async createSession(req: Request, res: Response): Promise<void> {
    try {
      const { storeId } = req.user!;
      const { instanceName } = req.body;

      const name = instanceName || `store_${storeId}`;

      // Verificar se já existe sessão ativa
      const existing = await prisma.whatsAppInstance.findFirst({
        where: { storeId, status: 'CONNECTED' },
      });

      if (existing) {
        res.status(409).json({
          error: 'Sessão já existe. Faça logout antes de criar uma nova.',
          instance: existing,
        });
        return;
      }

      // Criar sessão via WuzAPI
      const { token, qr } = await wuzapiService.createSession(name);

      // Salvar no banco
      const instance = await prisma.whatsAppInstance.create({
        data: {
          storeId,
          instanceName: name,
          token,
          status: 'QR_PENDING',
          phone: '',
        },
      });

      logger.info(`[WuzAPI] Sessão criada para store ${storeId}: ${name}`);

      res.status(201).json({
        id: instance.id,
        instanceName: name,
        qrCode: qr,
        status: 'QR_PENDING',
      });
    } catch (error: any) {
      logger.error('[WuzAPI] Erro ao criar sessão:', error);
      res.status(500).json({ error: error.message || 'Erro ao criar sessão WhatsApp' });
    }
  }

  /**
   * GET /api/whatsapp/sessions/:id/qr
   * Obter QR code de uma sessão pendente
   */
  static async getQRCode(req: Request, res: Response): Promise<void> {
    try {
      const { storeId } = req.user!;
      const id = req.params.id as string;

      const instance = await prisma.whatsAppInstance.findFirst({
        where: { id, storeId },
      });

      if (!instance) {
        res.status(404).json({ error: 'Sessão não encontrada' });
        return;
      }

      if (instance.status === 'CONNECTED') {
        res.json({ status: 'CONNECTED', message: 'Sessão já conectada' });
        return;
      }

      const qr = await wuzapiService.getQRCode(instance.token);

      res.json({
        qrCode: qr,
        status: instance.status,
      });
    } catch (error: any) {
      logger.error('[WuzAPI] Erro ao obter QR:', error);
      res.status(500).json({ error: error.message || 'Erro ao obter QR code' });
    }
  }

  /**
   * GET /api/whatsapp/sessions
   * Listar sessões da empresa
   */
  static async listSessions(req: Request, res: Response): Promise<void> {
    try {
      const { storeId } = req.user!;

      const instances = await prisma.whatsAppInstance.findMany({
        where: { storeId },
        orderBy: { createdAt: 'desc' },
      });

      // Verificar status de cada sessão via WuzAPI
      const enriched = await Promise.all(
        instances.map(async (inst) => {
          if (inst.status === 'QR_PENDING' && inst.token) {
            try {
              const status = await wuzapiService.getSessionStatus(inst.token);
              if (status.connected) {
                await prisma.whatsAppInstance.update({
                  where: { id: inst.id },
                  data: { status: 'CONNECTED', phone: status.user || '' },
                });
                return { ...inst, status: 'CONNECTED', phone: status.user };
              }
            } catch {
              // Sessão não existe mais no WuzAPI
            }
          }
          return inst;
        })
      );

      res.json(enriched);
    } catch (error: any) {
      logger.error('[WuzAPI] Erro ao listar sessões:', error);
      res.status(500).json({ error: 'Erro ao listar sessões' });
    }
  }

  /**
   * GET /api/whatsapp/sessions/:id/status
   * Verificar status de uma sessão específica
   */
  static async getStatus(req: Request, res: Response): Promise<void> {
    try {
      const { storeId } = req.user!;
      const id = req.params.id as string;

      const instance = await prisma.whatsAppInstance.findFirst({
        where: { id, storeId },
      });

      if (!instance) {
        res.status(404).json({ error: 'Sessão não encontrada' });
        return;
      }

      const status = await wuzapiService.getSessionStatus(instance.token);

      // Atualizar status no banco
      await prisma.whatsAppInstance.update({
        where: { id: instance.id },
        data: {
          status: status.connected ? 'CONNECTED' : 'DISCONNECTED',
          phone: status.user || instance.phone,
        },
      });

      res.json({
        id: instance.id,
        connected: status.connected,
        status: status.status,
        phone: status.user || instance.phone,
      });
    } catch (error: any) {
      logger.error('[WuzAPI] Erro ao verificar status:', error);
      res.status(500).json({ error: error.message || 'Erro ao verificar status' });
    }
  }

  /**
   * POST /api/whatsapp/sessions/:id/logout
   * Encerrar sessão WhatsApp
   */
  static async logout(req: Request, res: Response): Promise<void> {
    try {
      const { storeId } = req.user!;
      const id = req.params.id as string;

      const instance = await prisma.whatsAppInstance.findFirst({
        where: { id, storeId },
      });

      if (!instance) {
        res.status(404).json({ error: 'Sessão não encontrada' });
        return;
      }

      await wuzapiService.logout(instance.token);

      await prisma.whatsAppInstance.update({
        where: { id: instance.id },
        data: { status: 'DISCONNECTED' },
      });

      res.json({ message: 'Sessão encerrada' });
    } catch (error: any) {
      logger.error('[WuzAPI] Erro ao fazer logout:', error);
      res.status(500).json({ error: error.message || 'Erro ao encerrar sessão' });
    }
  }

  /**
   * DELETE /api/whatsapp/sessions/:id
   * Remover sessão do banco
   */
  static async deleteSession(req: Request, res: Response): Promise<void> {
    try {
      const { storeId } = req.user!;
      const id = req.params.id as string;

      const instance = await prisma.whatsAppInstance.findFirst({
        where: { id, storeId },
      });

      if (!instance) {
        res.status(404).json({ error: 'Sessão não encontrada' });
        return;
      }

      // Tentar logout antes de deletar
      try {
        await wuzapiService.logout(instance.token);
      } catch {
        // Ignorar erro — pode já estar desconectado
      }

      await prisma.whatsAppInstance.delete({ where: { id: instance.id } });

      res.json({ message: 'Sessão removida' });
    } catch (error: any) {
      logger.error('[WuzAPI] Erro ao remover sessão:', error);
      res.status(500).json({ error: 'Erro ao remover sessão' });
    }
  }

  /**
   * POST /api/whatsapp/send
   * Enviar mensagem de texto (usa sessão da empresa)
   */
  static async sendText(req: Request, res: Response): Promise<void> {
    try {
      const { storeId } = req.user!;
      const { phone, message, instanceId } = req.body;

      if (!phone || !message) {
        res.status(400).json({ error: 'phone e message são obrigatórios' });
        return;
      }

      // Buscar sessão ativa
      const whereClause: any = { storeId, status: 'CONNECTED' };
      if (instanceId) whereClause.id = instanceId;

      const instance = await prisma.whatsAppInstance.findFirst({ where: whereClause });

      if (!instance) {
        res.status(404).json({ error: 'Nenhuma sessão conectada encontrada' });
        return;
      }

      const result = await wuzapiService.sendText(instance.token, phone, message);

      if (result.success) {
        logger.info(`[WuzAPI] Mensagem enviada para ${phone} (empresa ${storeId})`);
        res.json({ success: true, messageId: result.id });
      } else {
        res.status(500).json({ error: result.error || 'Erro ao enviar mensagem' });
      }
    } catch (error: any) {
      logger.error('[WuzAPI] Erro ao enviar mensagem:', error);
      res.status(500).json({ error: error.message || 'Erro ao enviar mensagem' });
    }
  }

  /**
   * POST /api/whatsapp/check-number
   * Verificar se número está no WhatsApp
   */
  static async checkNumber(req: Request, res: Response): Promise<void> {
    try {
      const { storeId } = req.user!;
      const { phone } = req.body;

      if (!phone) {
        res.status(400).json({ error: 'phone é obrigatório' });
        return;
      }

      const instance = await prisma.whatsAppInstance.findFirst({
        where: { storeId, status: 'CONNECTED' },
      });

      if (!instance) {
        res.status(404).json({ error: 'Nenhuma sessão conectada encontrada' });
        return;
      }

      const result = await wuzapiService.checkNumber(instance.token, phone);

      res.json(result);
    } catch (error: any) {
      logger.error('[WuzAPI] Erro ao verificar número:', error);
      res.status(500).json({ error: 'Erro ao verificar número' });
    }
  }

  /**
   * POST /webhooks/wuzapi
   * Webhook receptor da WuzAPI (mensagens recebidas, status de entrega, etc.)
   * Rota pública — validação via HMAC
   */
  static async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      const signature = req.headers['x-hmac-signature'] as string;
      const rawBody = (req as any).rawBody; // Preservado pelo express.raw()

      // Validar HMAC se configurado
      if (WUZAPI_HMAC_KEY && rawBody) {
        const isValid = wuzapiService.validateWebhookSignature(
          rawBody.toString(),
          signature
        );
        if (!isValid) {
          logger.warn('[WuzAPI] Assinatura HMAC inválida no webhook');
          res.status(401).json({ error: 'Invalid signature' });
          return;
        }
      }

      const event = req.body;

      // Processar conforme tipo de evento
      if (event.event === 'message') {
        await handleIncomingMessage(event);
      } else if (event.event === 'readreceipt') {
        await handleReadReceipt(event);
      } else if (event.event === 'connection.update') {
        await handleConnectionUpdate(event);
      }

      res.sendStatus(200);
    } catch (error: any) {
      logger.error('[WuzAPI] Erro no webhook:', error);
      res.sendStatus(200); // Sempre retornar 200 para webhooks
    }
  }
}

const WUZAPI_HMAC_KEY = process.env.WUZAPI_HMAC_KEY || '';

/**
 * Processar mensagem recebida via webhook
 */
async function handleIncomingMessage(event: any): Promise<void> {
  const from = event.from || event.key?.remoteJid || '';
  const body = event.body || event.message?.conversation || '';
  const pushName = event.pushName || '';

  if (!from || !body) return;

  // Remover sufixo @s.whatsapp.net
  const phone = from.replace('@s.whatsapp.net', '').replace('@lid', '');

  logger.info(`[WuzAPI] Mensagem recebida de ${phone}: ${body.substring(0, 50)}...`);

  // Buscar empresa pelo número (se configurado)
  // Futuro: mapear números de WhatsApp para empresas
  // Por enquanto, apenas logar
}

/**
 * Processar confirmação de leitura
 */
async function handleReadReceipt(_event: any): Promise<void> {
  // Confirmação de que a mensagem foi lida
  // Pode ser usado para analytics de engajamento
}

/**
 * Processar mudança de status de conexão
 */
async function handleConnectionUpdate(event: any): Promise<void> {
  const status = event.status || event.state || '';

  if (status === 'open' || status === 'connected') {
    logger.info('[WuzAPI] Conexão WhatsApp restaurada');
  } else if (status === 'close' || status === 'disconnected') {
    logger.warn('[WuzAPI] Conexão WhatsApp perdida');
  }
}
