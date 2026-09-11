import { prisma } from '../lib/prisma';
import { wuzapiService } from './WuzapiService';
import { logger } from '../lib/logger';

function log(msg: string) {
  logger.debug(`[WhatsAppTrigger] ${msg}`);
}

/**
 * Buscar token WhatsApp conectado para a loja
 */
async function getToken(storeId: string): Promise<string | null> {
  const instance = await prisma.whatsAppInstance.findFirst({
    where: { storeId, status: 'CONNECTED' },
  });
  return instance?.token || null;
}

/**
 * Buscar config WhatsApp da loja
 */
async function getConfig(storeId: string) {
  return prisma.whatsAppConfig.findUnique({ where: { storeId } });
}

/**
 * Registrar log de mensagem enviada
 */
async function logMessage(data: {
  storeId: string;
  configId?: string;
  tipo: string;
  phone: string;
  message: string;
  status: string;
  externalId?: string;
  referenceType?: string;
  referenceId?: string;
  errorMsg?: string;
}) {
  try {
    await prisma.whatsAppMessageLog.create({ data });
  } catch (error) {
    logger.error('[WhatsAppTrigger] Erro ao registrar log:', error);
  }
}

/**
 * Enviar recibo de pagamento ao cliente
 * Chamado após baixa de pagamento (payReceivable)
 */
export async function enviarReciboPagamento(storeId: string, receivableId: string) {
  try {
    const config = await getConfig(storeId);
    if (!config) return;

    const token = await getToken(storeId);
    if (!token) {
      log(`enviarReciboPagamento: sem sessão conectada para loja ${storeId}`);
      return;
    }

    const receivable = await prisma.accountReceivable.findUnique({
      where: { id: receivableId },
      include: {
        customer: true,
        sale: true,
      },
    });

    if (!receivable?.customer?.telefoneWhatsapp) {
      log(`enviarReciboPagamento: sem telefone para receivable ${receivableId}`);
      return;
    }

    const phone = receivable.customer.telefoneWhatsapp;
    const valorFmt = Number(receivable.valorParcela).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const dataFmt = new Date().toLocaleDateString('pt-BR');

    let message: string;

    if (config.sendReceiptPdf) {
      // Futuro: gerar PDF e enviar como documento
      // Por enquanto, envia texto
      message = [
        `✅ Pagamento confirmado!`,
        ``,
        `Cliente: ${receivable.customer.nomeCompleto}`,
        `Valor: ${valorFmt}`,
        `Data: ${dataFmt}`,
        `Parcela: ${receivable.numeroParcela}/${receivable.totalParcelas}`,
        ``,
        `Obrigado pela preferência! 🐾`,
      ].join('\n');
    } else {
      message = [
        `✅ Pagamento confirmado!`,
        ``,
        `Cliente: ${receivable.customer.nomeCompleto}`,
        `Valor: ${valorFmt}`,
        `Data: ${dataFmt}`,
        `Parcela: ${receivable.numeroParcela}/${receivable.totalParcelas}`,
        ``,
        `Obrigado pela preferência! 🐾`,
      ].join('\n');
    }

    const result = await wuzapiService.sendText(token, phone, message);

    await logMessage({
      storeId,
      configId: config.id,
      tipo: 'RECIBO',
      phone,
      message,
      status: result.success ? 'ENVIADO' : 'ERRO',
      externalId: result.id,
      referenceType: 'AccountReceivable',
      referenceId: receivableId,
      errorMsg: result.error,
    });

    log(`enviarReciboPagamento: ${receivableId} → ${result.success ? 'enviado' : 'falhou'}`);
  } catch (error) {
    logger.error('[WhatsAppTrigger] Erro ao enviar recibo:', error);
  }
}

/**
 * Enviar resumo de venda no crediário ao cliente
 * Chamado ao fechar venda com formaPagamento = CREDIARIO
 */
export async function enviarResumoCrediario(storeId: string, saleId: string) {
  try {
    const config = await getConfig(storeId);
    if (!config) return;

    const token = await getToken(storeId);
    if (!token) {
      log(`enviarResumoCrediario: sem sessão conectada para loja ${storeId}`);
      return;
    }

    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        customer: true,
        receivables: { orderBy: { numeroParcela: 'asc' } },
      },
    });

    if (!sale?.customer?.telefoneWhatsapp) {
      log(`enviarResumoCrediario: sem telefone para venda ${saleId}`);
      return;
    }

    if (!sale.receivables || sale.receivables.length === 0) {
      log(`enviarResumoCrediario: sem parcelas para venda ${saleId}`);
      return;
    }

    const phone = sale.customer.telefoneWhatsapp;
    const valorTotal = Number(sale.valorTotalLiquido).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const parcelas = sale.receivables.map(r => {
      const dataVenc = new Date(r.dataVencimento).toLocaleDateString('pt-BR');
      const valor = Number(r.valorParcela).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      return `  ${r.numeroParcela}ª parcela: ${valor} — vence em ${dataVenc}`;
    }).join('\n');

    const message = [
      `📋 Resumo da sua compra (Crediário)`,
      ``,
      `Cliente: ${sale.customer.nomeCompleto}`,
      `Valor total: ${valorTotal}`,
      `Parcelas: ${sale.receivables.length}x`,
      ``,
      `Cronograma de pagamentos:`,
      parcelas,
      ``,
      `Para pagar, use a chave Pix Copia e Cola da loja.`,
      `Qualquer dúvida, é só responder esta mensagem! 🐾`,
    ].join('\n');

    const result = await wuzapiService.sendText(token, phone, message);

    await logMessage({
      storeId,
      configId: config.id,
      tipo: 'CREDIARIO',
      phone,
      message,
      status: result.success ? 'ENVIADO' : 'ERRO',
      externalId: result.id,
      referenceType: 'Sale',
      referenceId: saleId,
      errorMsg: result.error,
    });

    log(`enviarResumoCrediario: ${saleId} → ${result.success ? 'enviado' : 'falhou'}`);
  } catch (error) {
    logger.error('[WhatsAppTrigger] Erro ao enviar resumo crediário:', error);
  }
}
