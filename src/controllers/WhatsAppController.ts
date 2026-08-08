import { Request, Response } from 'express';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { asyncHandler } from "../lib/asyncHandler";
import { sendWhatsApp } from '../services/whatsapp.service';

// Máscara de chave: exibe apenas o início/fim (ex.: abcd****wxyz)
function maskSecret(secret?: string | null): string {
  if (!secret) return '';
  if (secret.length <= 8) return '****';
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
}

function isMasked(value?: string | null): boolean {
  return !!value && value.includes('****');
}

export class WhatsAppController {
  // ==================== CONFIG ====================

  getConfig = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: {
          whatsappApiUrl: true, whatsappApiKey: true,
          whatsappEnabled: true, whatsappSendConfirmation: true,
          whatsappSendReminder: true, whatsappSendBirthday: true,
          whatsappSendMarketing: true,
        },
      });
      res.json({
        ...store,
        whatsappApiKey: maskSecret(store?.whatsappApiKey),
      });
    
  }, "obter config");

  updateConfig = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      const {
        whatsappApiUrl, whatsappApiKey, whatsappEnabled,
        whatsappSendConfirmation, whatsappSendReminder,
        whatsappSendBirthday, whatsappSendMarketing,
      } = req.body;

      // Se veio mascarado ou vazio, mantém a chave existente
      let chaveFinal = whatsappApiKey;
      if (!whatsappApiKey || isMasked(whatsappApiKey)) {
        const store = await prisma.store.findUnique({ where: { id: storeId }, select: { whatsappApiKey: true } });
        chaveFinal = store?.whatsappApiKey || null;
      }

      const updated = await prisma.store.update({
        where: { id: storeId },
        data: {
          whatsappApiUrl,
          whatsappApiKey: chaveFinal,
          whatsappEnabled: whatsappEnabled ?? false,
          whatsappSendConfirmation: whatsappSendConfirmation ?? false,
          whatsappSendReminder: whatsappSendReminder ?? false,
          whatsappSendBirthday: whatsappSendBirthday ?? false,
          whatsappSendMarketing: whatsappSendMarketing ?? false,
        },
        select: {
          whatsappApiUrl: true, whatsappEnabled: true,
          whatsappSendConfirmation: true, whatsappSendReminder: true,
          whatsappSendBirthday: true, whatsappSendMarketing: true,
        },
      });

      res.json(updated);
    
  }, "atualizar config");

  testConnection = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      const store = await prisma.store.findUnique({ where: { id: storeId } });
      if (!store?.whatsappApiUrl) {
        return res.status(400).json({ error: 'URL da API WhatsApp não configurada' });
      }

      const result = await sendWhatsApp({
        apiUrl: store.whatsappApiUrl,
        apiKey: store.whatsappApiKey || '',
        phone: store.telefoneWhatsapp || '5511999999999',
        message: '🔧 Teste de conexão — Sistema Gestão Lance Pelo Zap',
      });

      res.json(result);
    
  }, "test connection");

  // ==================== QR CODE ====================

  getQRCode = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      const store = await prisma.store.findUnique({ where: { id: storeId } });
      const apiUrl = store?.whatsappApiUrl;
      const apiKey = store?.whatsappApiKey || '';

      if (!apiUrl) return res.status(400).json({ error: 'WhatsApp não configurado' });

      const baseUrl = apiUrl.replace(/\/message\/sendText\/[^/]+$/, '');
      const instanceMatch = apiUrl.match(/\/message\/sendText\/([^/]+)$/);
      const instanceName = instanceMatch ? instanceMatch[1] : 'default';

      const headers = {
        'Content-Type': 'application/json',
        apikey: apiKey,
      };

      // 1. Logout to reset state
      await fetch(`${baseUrl}/instance/logout/${instanceName}`, {
        method: 'DELETE', headers,
      }).catch((e) => {
        logger.warn("Falha ao deslogar instância WhatsApp (reset)", { err: e, action: "whatsapp_instance_logout" });
      });

      // 2. Small delay for reset
      await new Promise(r => setTimeout(r, 1000));

      // 3. Request connection (generates QR)
      const connectRes = await fetch(`${baseUrl}/instance/connect/${instanceName}`, { headers });
      const connectData = await connectRes.json();

      // If QR is already available, return it
      if (connectData?.base64) {
        const qrBase64 = connectData.base64;
        return res.json({ qrcode: qrBase64.startsWith('data:') ? qrBase64 : `data:image/png;base64,${qrBase64}` });
      }

      if (connectData?.code) {
        return res.json({ qrcode: `data:image/png;base64,${connectData.code}` });
      }

      // 4. Poll for QR code (max 30 seconds)
      const maxAttempts = 15;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 2000));

        const pollRes = await fetch(`${baseUrl}/instance/connect/${instanceName}`, { headers });
        const pollData = await pollRes.json();

        if (pollData?.base64) {
          const qrBase64 = pollData.base64;
          return res.json({ qrcode: qrBase64.startsWith('data:') ? qrBase64 : `data:image/png;base64,${qrBase64}` });
        }

        if (pollData?.code) {
          return res.json({ qrcode: `data:image/png;base64,${pollData.code}` });
        }

        // Check if already connected
        const stateRes = await fetch(`${baseUrl}/instance/connectionState/${instanceName}`, { headers });
        const stateData = await stateRes.json();
        if (stateData?.instance?.state === 'open' || stateData?.instance?.connectionStatus === 'open') {
          return res.json({ connected: true, message: 'WhatsApp já está conectado!' });
        }
      }

      return res.status(408).json({ error: 'Tempo limite excedido para gerar QR Code. Acesse o Manager manualmente.' });
    
  }, "obter qr code");

  getQRCodeStatus = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      const store = await prisma.store.findUnique({ where: { id: storeId } });
      const apiUrl = store?.whatsappApiUrl;
      const apiKey = store?.whatsappApiKey || '';

      if (!apiUrl) return res.status(400).json({ error: 'WhatsApp não configurado' });

      const baseUrl = apiUrl.replace(/\/message\/sendText\/[^/]+$/, '');
      const instanceMatch = apiUrl.match(/\/message\/sendText\/([^/]+)$/);
      const instanceName = instanceMatch ? instanceMatch[1] : 'default';

      const stateRes = await fetch(`${baseUrl}/instance/connectionState/${instanceName}`, {
        headers: { apikey: apiKey },
      });
      const stateData = await stateRes.json();

      const isConnected = stateData?.instance?.state === 'open';
      return res.json({
        connected: isConnected,
        state: stateData?.instance?.state || 'close',
        number: stateData?.instance?.number || null,
        profileName: stateData?.instance?.profileName || null,
      });
    
  }, "obter qr code status");

  // ==================== SEND ====================

  sendMessage = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      const { customerId, message } = req.body;
      if (!customerId || !message) {
        return res.status(400).json({ error: 'customerId e message são obrigatórios' });
      }

      const store = await prisma.store.findUnique({ where: { id: storeId } });
      if (!store?.whatsappApiUrl) {
        return res.status(400).json({ error: 'WhatsApp não configurado. Vá em Configurações > WhatsApp.' });
      }

      const customer = await prisma.customer.findFirst({
        where: { id: customerId, storeId },
      });
      if (!customer) return res.status(404).json({ error: 'Cliente não encontrado' });
      if (!customer.telefoneWhatsapp) {
        return res.status(400).json({ error: 'Cliente não possui WhatsApp cadastrado' });
      }

      const result = await sendWhatsApp({
        apiUrl: store.whatsappApiUrl,
        apiKey: store.whatsappApiKey || '',
        phone: customer.telefoneWhatsapp,
        message,
      });

      await prisma.messageLog.create({
        data: {
          storeId,
          customerId: customer.id,
          tipo: 'AVULSO',
          conteudo: message,
          status: result.success ? 'ENVIADO' : 'ERRO',
          erro: result.error || null,
        },
      });

      res.json({ sent: result.success, error: result.error });
    
  }, "enviar message");

  sendPortalLink = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      const { customerId } = req.body;
      if (!customerId) return res.status(400).json({ error: 'customerId obrigatório' });

      const customer = await prisma.customer.findFirst({ where: { id: customerId, storeId } });
      if (!customer) return res.status(404).json({ error: 'Cliente não encontrado' });
      if (!customer.telefoneWhatsapp) {
        return res.status(400).json({ error: 'Cliente não possui WhatsApp' });

      }

      const store = await prisma.store.findUnique({ where: { id: storeId } });
      if (!store?.whatsappApiUrl) {
        return res.status(400).json({ error: 'WhatsApp não configurado' });
      }

      let token = customer.portalToken;
      if (!token) {
        const { randomUUID } = await import('crypto');
        token = randomUUID();
        await prisma.customer.update({ where: { id: customer.id }, data: { portalToken: token } });
      }

      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const portalUrl = `${baseUrl}/portal/${token}`;
      const message = `Olá ${customer.nomeCompleto.split(' ')[0]}! 👋\n\nAcesse seu portal de cliente para consultar compras e pendências:\n${portalUrl}`;

      const result = await sendWhatsApp({
        apiUrl: store.whatsappApiUrl,
        apiKey: store.whatsappApiKey || '',
        phone: customer.telefoneWhatsapp,
        message,
      });

      await prisma.messageLog.create({
        data: {
          storeId, customerId: customer.id, tipo: 'PORTAL',
          conteudo: message, status: result.success ? 'ENVIADO' : 'ERRO',
          erro: result.error || null,
          metadata: { portalUrl } as any,
        },
      });

      res.json({ sent: result.success, error: result.error, portalUrl });
    
  }, "enviar portal do cliente link");

  // ==================== TEMPLATES ====================

  listTemplates = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      const templates = await prisma.whatsAppTemplate.findMany({
        where: { storeId },
        orderBy: { nome: 'asc' },
      });
      res.json(templates);
    
  }, "listar templates");

  createTemplate = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      const { nome, categoria, conteudo } = req.body;
      if (!nome || !conteudo) {
        return res.status(400).json({ error: 'nome e conteudo são obrigatórios' });
      }

      const template = await prisma.whatsAppTemplate.create({
        data: { storeId, nome, categoria: categoria || 'MARKETING', conteudo },
      });

      res.status(201).json(template);
    
  }, "criar template");

  updateTemplate = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;
      const { nome, categoria, conteudo, ativo } = req.body;

      const template = await prisma.whatsAppTemplate.findFirst({ where: { id, storeId } });
      if (!template) return res.status(404).json({ error: 'Template não encontrado' });

      const updated = await prisma.whatsAppTemplate.update({
        where: { id },
        data: { nome, categoria, conteudo, ativo },
      });

      res.json(updated);
    
  }, "atualizar template");

  deleteTemplate = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;

      const template = await prisma.whatsAppTemplate.findFirst({ where: { id, storeId } });
      if (!template) return res.status(404).json({ error: 'Template não encontrado' });

      await prisma.whatsAppTemplate.delete({ where: { id } });
      res.json({ message: 'Template excluído' });
    
  }, "excluir template");

  // ==================== LOGS ====================

  listLogs = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      const { limit = '50', offset = '0', customerId } = req.query;
      const where: any = { storeId };
      if (customerId) where.customerId = customerId as string;

      const logs = await prisma.messageLog.findMany({
        where,
        orderBy: { sentAt: 'desc' },
        take: Number(limit),
        skip: Number(offset),
        include: { customer: { select: { id: true, nomeCompleto: true, telefoneWhatsapp: true } } },
      });

      res.json(logs);
    
  }, "listar logs");

  // ==================== CAMPANHA ====================

  sendCampaign = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      const { customerIds, message } = req.body;
      if (!customerIds?.length || !message) {
        return res.status(400).json({ error: 'customerIds e message são obrigatórios' });
      }

      const store = await prisma.store.findUnique({ where: { id: storeId } });
      if (!store?.whatsappApiUrl) {
        return res.status(400).json({ error: 'WhatsApp não configurado' });
      }

      const customers = await prisma.customer.findMany({
        where: { id: { in: customerIds }, storeId, aceitaMarketing: true },
      });

      if (customers.length === 0) {
        return res.status(400).json({ error: 'Nenhum cliente com aceitaMarketing encontrado' });
      }

      const results: { customerId: string; nome: string; sent: boolean; error?: string }[] = [];

      for (const customer of customers) {
        if (!customer.telefoneWhatsapp) {
          results.push({ customerId: customer.id, nome: customer.nomeCompleto, sent: false, error: 'Sem WhatsApp' });
          continue;
        }

        const result = await sendWhatsApp({
          apiUrl: store.whatsappApiUrl,
          apiKey: store.whatsappApiKey || '',
          phone: customer.telefoneWhatsapp,
          message,
        });

        await prisma.messageLog.create({
          data: {
            storeId, customerId: customer.id, tipo: 'MARKETING',
            conteudo: message, status: result.success ? 'ENVIADO' : 'ERRO',
            erro: result.error || null,
          },
        });

        results.push({ customerId: customer.id, nome: customer.nomeCompleto, sent: result.success, error: result.error });
      }

      res.json({ total: customers.length, enviados: results.filter(r => r.sent).length, erros: results.filter(r => !r.sent).length, results });
    
  }, "enviar campaign");
}
