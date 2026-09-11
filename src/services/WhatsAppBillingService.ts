import { prisma } from '../lib/prisma';
import { wuzapiService } from './WuzapiService';
import { logger } from '../lib/logger';

function log(msg: string) {
  logger.debug(`[WhatsAppBilling] ${msg}`);
}

/**
 * Processar régua de cobrança para todas as lojas com billing habilitado.
 * Roda diariamente via cron (ex: 09:00 Brasília).
 *
 * Lógica:
 * 1. Busca todas as configs com billingEnabled=true
 * 2. Para cada config, busca regras ativas
 * 3. Para cada regra, busca parcelas pendentes que combinam com o offset
 * 4. Envia mensagem e marca como enviada (via campos lembreteD2/D0/D1 no AccountReceivable)
 */
export async function processarReguaCobranca() {
  try {
    const configs = await prisma.whatsAppConfig.findMany({
      where: { billingEnabled: true },
      include: {
        rules: { where: { ativo: true } },
        store: { select: { id: true, nomeFantasia: true } },
      },
    });

    if (configs.length === 0) {
      log('Nenhuma loja com régua de cobrança ativa');
      return;
    }

    log(`Processando ${configs.length} lojas com régua ativa`);

    for (const config of configs) {
      if (config.rules.length === 0) continue;

      // Buscar sessão conectada para esta loja
      const instance = await prisma.whatsAppInstance.findFirst({
        where: { storeId: config.storeId, status: 'CONNECTED' },
      });

      if (!instance) {
        log(`Loja ${config.store.id}: sem sessão WhatsApp conectada, pulando`);
        continue;
      }

      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      for (const rule of config.rules) {
        // Calcular data alvo
        const dataAlvo = new Date(hoje);
        dataAlvo.setDate(dataAlvo.getDate() - rule.diasOffset);

        // Buscar parcelas vencendo na data alvo
        const parcelas = await prisma.accountReceivable.findMany({
          where: {
            storeId: config.storeId,
            status: 'PENDENTE',
            dataVencimento: dataAlvo,
          },
          include: { customer: true },
        });

        for (const parcela of parcelas) {
          // Verificar se já enviou este tipo de lembrete
          const jaEnviou = verificarLembreteEnviado(parcela, rule.diasOffset);
          if (jaEnviou) continue;

          if (!parcela.customer?.telefoneWhatsapp) continue;

          const phone = parcela.customer.telefoneWhatsapp;
          const valorFmt = Number(parcela.valorParcela).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
          const pixCopia = 'Chave Pix Copia e Cola da loja'; // Futuro: buscar da config da loja

          const message = rule.mensagem
            .replace('{valor}', valorFmt)
            .replace('{pix}', pixCopia)
            .replace('{cliente}', parcela.customer.nomeCompleto || '')
            .replace('{parcela}', `${parcela.numeroParcela}/${parcela.totalParcelas}`);

          const result = await wuzapiService.sendText(instance.token, phone, message);

          // Marcar lembrete como enviado
          await marcarLembreteEnviado(parcela.id, rule.diasOffset);

          // Registrar log
          await prisma.whatsAppMessageLog.create({
            data: {
              storeId: config.storeId,
              configId: config.id,
              tipo: 'COBRANCA',
              phone,
              message,
              status: result.success ? 'ENVIADO' : 'ERRO',
              externalId: result.id,
              referenceType: 'AccountReceivable',
              referenceId: parcela.id,
              errorMsg: result.error,
            },
          });

          log(`Cobrança: loja ${config.store.id}, parcela ${parcela.id} → ${result.success ? 'enviado' : 'falhou'}`);
        }
      }
    }

    log('Regua de cobrança processada');
  } catch (error) {
    logger.error('[WhatsAppBilling] Erro ao processar régua de cobrança:', error);
  }
}

/**
 * Verificar se o lembrete já foi enviado para este offset
 */
function verificarLembreteEnviado(parcela: any, diasOffset: number): boolean {
  if (diasOffset <= -2 && parcela.lembreteD2Enviado) return true;
  if (diasOffset === 0 && parcela.lembreteD0Enviado) return true;
  if (diasOffset >= 1 && parcela.lembreteD1posEnviado) return true;
  return false;
}

/**
 * Marcar lembrete como enviado no parcela
 */
async function marcarLembreteEnviado(parcelaId: string, diasOffset: number) {
  const data: any = {};

  if (diasOffset <= -2) data.lembreteD2Enviado = true;
  if (diasOffset === 0) data.lembreteD0Enviado = true;
  if (diasOffset >= 1) data.lembreteD1posEnviado = true;

  await prisma.accountReceivable.update({
    where: { id: parcelaId },
    data,
  });
}
