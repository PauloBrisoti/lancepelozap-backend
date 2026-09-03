import { logger } from '../lib/logger';

function log(msg: string) {
  logger.debug(`[PetLembretes] ${new Date().toISOString()} ${msg}`);
}

// ── WhatsApp integration removed (Fase 2: WuzAPI) ──
// Funções mantidas como no-op para não quebrar chamadores existentes.

export async function enviarLembreteRecorrencia(_storeId: string, _ordemId: string, _proximaEntrada: Date, _servicos: string, _valor: number) {
  log("enviarLembreteRecorrencia: desativado (WhatsApp removido)");
}

export async function processarLembretesHospedagem() {
  log("processarLembretesHospedagem: desativado (WhatsApp removido)");
}

export async function lembrarOrdem(_storeId: string, _orderId: string) {
  log("lembrarOrdem: desativado (WhatsApp removido)");
  return { ok: false, error: "WhatsApp não disponível nesta versão" };
}
