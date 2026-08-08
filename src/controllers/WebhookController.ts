import { Request, Response } from 'express';
import { timingSafeEqual, createHmac } from 'crypto';
import { prisma } from '../lib/prisma';

import { logger } from '../lib/logger';
/**
 * Webhook do Mercado Pago.
 *
 * Defesa em profundidade (recomendação oficial MP):
 *   1. Validar a assinatura HMAC do header `x-signature` contra o segredo do webhook.
 *   2. NUNCA confiar no payload: consultar a API oficial do MP para confirmar o status real.
 *   3. Idempotência: o `data.id` do evento é registrado em `webhook_events`
 *      (unique eventId+eventType) — mesmo evento entregue 2x é ignorado na 2ª.
 *   4. Anti-replay: o timestamp da assinatura precisa estar dentro de ±5 minutos.
 *
 * Antes deste controller, qualquer pessoa podia POSTar aqui e liberar assinaturas
 * (status PAGO) de graça — o payload era aceito sem validação.
 */

// ============================================================
// CONFIG (lida por request — nunca hardcoded; testável por env)
// ============================================================

function getConfig() {
  return {
    accessToken: process.env.MP_ACCESS_TOKEN || '',
    /** Segredo do webhook configurado no painel do MP (Notificações/Webhooks). */
    webhookSecret: process.env.MP_WEBHOOK_SECRET || '',
  };
}

const MP_API_BASE = 'https://api.mercadopago.com';

/** Janela de tolerância do timestamp da assinatura (anti-replay). */
const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

/** Status do MP que consideramos "pago/autorizado" para renovar a assinatura. */
const PAID_STATUSES = new Set(['authorized', 'active', 'processed']);

// ============================================================
// VALIDAÇÃO DE ASSINATURA (HMAC SHA256)
// ============================================================

/**
 * Verifica a assinatura do webhook do Mercado Pago.
 *
 * O header `x-signature` tem o formato: `ts=TIMESTAMP,v1=HEX_SIGNATURE`.
 * O `data.id` (ou query.id) + o timestamp formam o manifest assinado com HMAC-SHA256
 * usando o segredo do webhook. O timestamp é validado dentro de ±5 min (anti-replay):
 * uma captura reenviada depois da janela é rejeitada.
 */
function verifySignature(req: Request, dataId: string): boolean {
  const { webhookSecret } = getConfig();
  if (!webhookSecret) {
    logger.warn('MP_WEBHOOK_SECRET não configurado — webhook não pode validar assinatura.');
    return false;
  }

  const signatureHeader = req.headers['x-signature'] as string | undefined;
  if (!signatureHeader) {
    logger.warn('Webhook MP recebido sem header x-signature.');
    return false;
  }

  // Parse: "ts=...,v1=..."
  const parts = signatureHeader.split(',').reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const ts = parts['ts'];
  const v1 = parts['v1'];
  if (!ts || !v1) return false;

  // Anti-replay: o ts precisa ser um número inteiro e estar dentro da janela.
  const tsSeconds = Number(ts);
  if (!Number.isInteger(tsSeconds) || tsSeconds <= 0) {
    logger.warn('Webhook MP rejeitado: timestamp inválido.');
    return false;
  }
  if (Math.abs(Date.now() - tsSeconds * 1000) > SIGNATURE_TOLERANCE_MS) {
    logger.warn('Webhook MP rejeitado: timestamp fora da janela (replay?).');
    return false;
  }

  // O manifest é "dataId.ts" (ordem documentada pelo MP).
  const manifest = `${dataId}.${ts}`;

  const expected = createHmac('sha256', webhookSecret).update(manifest).digest('hex');

  // Comparação constante-tempo para evitar timing attacks.
  if (expected.length !== v1.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch {
    return false;
  }
}

// ============================================================
// CONFIRMAÇÃO OFICIAL (API do Mercado Pago)
// ============================================================

interface MPPreapproval {
  id: string;
  status: string;
  reason?: string;
  next_payment_date?: string;
  auto_recurring?: { transaction_amount?: number };
}

async function fetchPreapprovalFromMP(preapprovalId: string): Promise<MPPreapproval | null> {
  const { accessToken } = getConfig();
  if (!accessToken) {
    logger.error('MP_ACCESS_TOKEN não configurado — impossível confirmar assinatura na API.');
    return null;
  }
  try {
    const res = await fetch(`${MP_API_BASE}/preapproval/${preapprovalId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      logger.error(`API MP retornou ${res.status} para preapproval ${preapprovalId}`);
      return null;
    }
    return (await res.json()) as MPPreapproval;
  } catch (err) {
    logger.error(`Erro ao consultar API MP: ${(err as Error).message}`);
    return null;
  }
}

// ============================================================
// CONTROLLER
// ============================================================

export class WebhookController {
  static async handleMercadoPago(req: Request, res: Response) {
    try {
      const { type, data } = req.body;
      const queryId = req.query.id as string;
      const topic = req.query.topic as string;

      // 1. Resposta rápida para pings/healthchecks do MP.
      if (type === 'ping' || req.method === 'GET') {
        return res.status(200).send('OK');
      }

      // Só tratamos assinaturas (preapproval).
      const isSubscription =
        type === 'subscription_preapproval' || topic === 'subscription_preapproval';
      if (!isSubscription) {
        // Outros tipos de notificação não são processados, mas devolvemos 200.
        return res.status(200).send('OK');
      }

      const preapprovalId = data?.id || queryId;
      if (!preapprovalId) {
        logger.warn('Webhook MP sem preapproval id.');
        return res.status(200).send('OK');
      }

      // 2. Validar assinatura (camada 1).
      if (!verifySignature(req, String(preapprovalId))) {
        logger.warn(`Webhook MP rejeitado: assinatura inválida (id=${preapprovalId}).`);
        return res.status(401).send('Unauthorized');
      }

      // 3. Confirmar status na API oficial (camada 2 — fonte de verdade).
      const mpData = await fetchPreapprovalFromMP(String(preapprovalId));
      if (!mpData) {
        logger.warn(`Webhook MP: não foi possível confirmar preapproval ${preapprovalId} na API.`);
        return res.status(202).send('Accepted'); // MP fará retry
      }

      // 4. Localizar a assinatura no banco.
      const subscription = await prisma.subscription.findFirst({
        where: { mpPreapprovalId: String(preapprovalId) },
      });
      if (!subscription) {
        logger.info(`Webhook MP: preapproval ${preapprovalId} não possui assinatura local.`);
        return res.status(200).send('OK');
      }

      // 5. Idempotência: só atualiza se houver mudança efetiva de status.
      const isPaid = PAID_STATUSES.has(mpData.status);
      const novoStatus = isPaid ? 'PAGO' : 'PENDENTE';

      if (subscription.statusPagamento === novoStatus && subscription.mpStatus === mpData.status) {
        logger.info(`Webhook MP: assinatura ${subscription.id} sem alteração (${novoStatus}).`);
        return res.status(200).send('OK');
      }

      // 6. Renovar vencimento apenas quando efetivamente pago.
      const dataVencimento = isPaid
        ? mpData.next_payment_date
          ? new Date(mpData.next_payment_date)
          : addMonths(new Date(), 1)
        : subscription.dataVencimento;

      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          statusPagamento: novoStatus,
          mpStatus: mpData.status,
          dataVencimento,
        },
      });

      // 7. Registrar o evento processado (chave de idempotência). O unique
      // (eventId+eventType) torna concorrente/reentrega inofensiva: se o MP
      // entregar o mesmo data.id de novo, este INSERT falha com P2002 e o
      // webhook responde 200 sem reprocessar (nenhum crédito/renovação dupla).
      try {
        await prisma.webhookEvent.create({
          data: {
            eventId: String(preapprovalId),
            eventType: type || topic || 'subscription_preapproval',
            preapprovalId: String(preapprovalId),
            subscriptionId: subscription.id,
          },
        });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') {
          logger.info(`Webhook MP: evento ${preapprovalId} já processado (idempotência).`);
        } else {
          throw err;
        }
      }

      logger.info(
        `Assinatura ${subscription.id} atualizada via webhook: ${novoStatus} (MP: ${mpData.status}).`
      );
      return res.status(200).send('OK');
    } catch (error) {
      logger.error(`Erro no Webhook do Mercado Pago: ${(error as Error).message}`);
      // 500 faz o MP reenviar; melhor que engolir silenciosamente.
      return res.status(500).send('Internal Error');
    }
  }
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}
