import { prisma } from '../lib/prisma';
import { wuzapiService, WuzapiMessageResponse } from './WuzapiService';
import { logger } from '../lib/logger';

function log(msg: string) {
  logger.debug(`[PetLembretes] ${new Date().toISOString()} ${msg}`);
}

/**
 * Busca a sessão WhatsApp conectada para a store.
 */
async function getConnectedToken(storeId: string): Promise<string | null> {
  const instance = await prisma.whatsAppInstance.findFirst({
    where: { storeId, status: 'CONNECTED' },
  });
  return instance?.token || null;
}

/**
 * Envia mensagem de texto via WuzAPI.
 */
async function sendText(storeId: string, phone: string, message: string): Promise<WuzapiMessageResponse> {
  const token = await getConnectedToken(storeId);
  if (!token) {
    log(`sendText: nenhuma sessão conectada para store ${storeId}`);
    return { success: false, error: 'Nenhuma sessão WhatsApp conectada' };
  }
  return wuzapiService.sendText(token, phone, message);
}

/**
 * Envia lembrete de recorrência (próxima entrada agendada).
 */
export async function enviarLembreteRecorrencia(
  storeId: string,
  ordemId: string,
  proximaEntrada: Date,
  servicos: string,
  valor: number,
) {
  try {
    const order = await prisma.petServiceOrder.findUnique({
      where: { id: ordemId },
      include: { pet: { include: { tutor: true } } },
    });

    if (!order?.pet?.tutor?.telefone) {
      log(`enviarLembreteRecorrencia: sem telefone para OS ${ordemId}`);
      return;
    }

    const phone = order.pet.tutor.telefone;
    const dataFmt = proximaEntrada.toLocaleDateString('pt-BR');
    const valorFmt = valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const message = [
      `Olá! Lembrete do seu pet 🐾`,
      ``,
      `Próxima entrada: ${dataFmt}`,
      `Serviços: ${servicos}`,
      `Valor: ${valorFmt}`,
      ``,
      `Se precisar reagendar, entre em contato.`,
    ].join('\n');

    const result = await sendText(storeId, phone, message);
    log(`enviarLembreteRecorrencia: OS ${ordemId} → ${result.success ? 'enviado' : 'falhou'}`);
  } catch (error) {
    logger.error('[PetLembretes] Erro ao enviar lembrete de recorrência:', error);
  }
}

/**
 * Processa lembretes de hospedagem pendentes.
 */
export async function processarLembretesHospedagem() {
  try {
    const hospedagens = await prisma.petServiceOrder.findMany({
      where: {
        status: { in: ['EM_ANDAMENTO', 'AGENDADO'] },
      },
      include: {
        pet: { include: { tutor: true } },
        items: { include: { catalog: true } },
      },
    });

    // Filtrar apenas os que têm serviço de hospedagem
    const comHospedagem = hospedagens.filter(h =>
      h.items.some(i => i.catalog?.nome?.toLowerCase().includes('hospedagem'))
    );

    for (const hosp of comHospedagem) {
      if (!hosp.pet?.tutor?.telefone) continue;

      const phone = hosp.pet.tutor.telefone;
      const message = [
        `Olá! Atualização sobre a hospedagem do seu pet 🐾`,
        ``,
        `${hosp.pet.nome} está bem e conosco!`,
        `Se tiver alguma dúvida, é só responder esta mensagem.`,
      ].join('\n');

      const result = await sendText(hosp.storeId, phone, message);
      log(`processarLembretesHospedagem: OS ${hosp.id} → ${result.success ? 'enviado' : 'falhou'}`);
    }

    log(`processarLembretesHospedagem: ${comHospedagem.length} lembretes processados`);
  } catch (error) {
    logger.error('[PetLembretes] Erro ao processar lembretes de hospedagem:', error);
  }
}

/**
 * Envia lembrete de agendamento de ordem de serviço.
 */
export async function lembrarOrdem(storeId: string, orderId: string) {
  try {
    const order = await prisma.petServiceOrder.findUnique({
      where: { id: orderId },
      include: {
        pet: { include: { tutor: true } },
        items: { include: { catalog: true } },
      },
    });

    if (!order?.pet?.tutor?.telefone) {
      return { ok: false, error: 'Sem telefone cadastrado' };
    }

    const phone = order.pet.tutor.telefone;
    const servicos = order.items.map(i => i.catalog?.nome).filter(Boolean).join(', ');
    const dataFmt = order.dataEntrada
      ? new Date(order.dataEntrada).toLocaleDateString('pt-BR')
      : 'a definir';

    const message = [
      `Olá! Lembrete do agendamento do seu pet 🐾`,
      ``,
      `Pet: ${order.pet.nome}`,
      `Data: ${dataFmt}`,
      `Serviços: ${servicos || 'Não informado'}`,
      ``,
      `Aguardamos você!`,
    ].join('\n');

    const result = await sendText(storeId, phone, message);
    log(`lembrarOrdem: OS ${orderId} → ${result.success ? 'enviado' : 'falhou'}`);

    return result.success
      ? { ok: true }
      : { ok: false, error: result.error || 'Falha no envio' };
  } catch (error) {
    logger.error('[PetLembretes] Erro ao enviar lembrete de ordem:', error);
    return { ok: false, error: 'Erro interno' };
  }
}
