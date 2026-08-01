import { prisma } from "../lib/prisma";
import { sendWhatsApp } from "./whatsapp.service";
import { startOfDay, addDays, differenceInCalendarDays } from "date-fns";

function log(msg: string) {
  console.log(`[PetLembretes] ${new Date().toISOString()} ${msg}`);
}

function normalizarTelefone(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.startsWith("55") ? digits : `55${digits}`;
}

interface StoreWhatsConfig {
  whatsappApiUrl?: string | null;
  whatsappApiKey?: string | null;
  whatsappEnabled?: boolean | null;
  whatsappSendReminder?: boolean | null;
}

async function enviar(store: StoreWhatsConfig, phone: string | null, message: string) {
  if (!store.whatsappEnabled || !store.whatsappApiUrl || !phone) return false;
  const result = await sendWhatsApp({
    apiUrl: store.whatsappApiUrl,
    apiKey: store.whatsappApiKey || "",
    phone,
    message,
  });
  return result.success;
}

// Lembrete enviado quando a recorrência contínua gera a próxima OS
export async function enviarLembreteRecorrencia(storeId: string, ordemId: string, proximaEntrada: Date, servicos: string, valor: number) {
  try {
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: {
        whatsappApiUrl: true, whatsappApiKey: true,
        whatsappEnabled: true, whatsappSendReminder: true,
      },
    });
    if (!store?.whatsappEnabled || !store.whatsappSendReminder || !store.whatsappApiUrl) return;

    const ordem = await prisma.petServiceOrder.findFirst({
      where: { id: ordemId, storeId },
      include: { pet: { select: { nome: true, tutor: { select: { nome: true, telefone: true } } } } },
    });
    if (!ordem?.pet.tutor?.telefone) return;

    const data = proximaEntrada.toLocaleDateString("pt-BR");
    const msg = `Olá ${ordem.pet.tutor.nome}! Confirmamos a cobrança recorrente de ${servicos} do ${ordem.pet.nome}. A próxima parcela (R$ ${valor.toFixed(2)}) está agendada para ${data}. Obrigado!`;
    const ok = await enviar(store, normalizarTelefone(ordem.pet.tutor.telefone), msg);
    log(`Lembrete recorrência ordem ${ordemId}: ${ok ? "enviado" : "falhou/inválido"}`);
  } catch (err: any) {
    log(`Erro lembrete recorrência: ${err.message}`);
  }
}

// Cron diário: avisa no dia anterior ao check-out da hospedagem
export async function processarLembretesHospedagem() {
  log("Iniciando lembretes de hospedagem (check-out amanhã)...");
  const amanha = addDays(startOfDay(new Date()), 1);
  const depoisDeAmanha = addDays(amanha, 1);

  try {
    const ordens = await prisma.petServiceOrder.findMany({
      where: {
        status: { in: ["AGENDADO", "EM_ANDAMENTO"] },
        dataSaida: { gte: amanha, lt: depoisDeAmanha },
      },
      include: {
        pet: { select: { nome: true, tutor: { select: { nome: true, telefone: true } } } },
        items: { include: { catalog: { select: { nome: true } } } },
      },
    });

    let enviados = 0;
    for (const ordem of ordens) {
      try {
        const store = await prisma.store.findUnique({
          where: { id: ordem.storeId },
          select: {
            whatsappApiUrl: true, whatsappApiKey: true,
            whatsappEnabled: true, whatsappSendReminder: true,
          },
        });
        if (!store?.whatsappEnabled || !store.whatsappSendReminder || !store.whatsappApiUrl) continue;
        const tutor = ordem.pet.tutor;
        if (!tutor?.telefone) continue;
        const dataSaida = ordem.dataSaida ? ordem.dataSaida.toLocaleDateString("pt-BR") : "amanhã";
        const msg = `Olá ${tutor.nome}! Lembrete: ${ordem.pet.nome} conclui o período (${ordem.items.map(i => i.catalog?.nome).filter(Boolean).join(", ") || "serviço"}) amanhã (${dataSaida}). Estaremos à disposição!`;
        const ok = await enviar(store, normalizarTelefone(tutor.telefone), msg);
        if (ok) {
          enviados++;
          log(`Lembrete hospedagem ${ordem.id} enviado`);
        }
      } catch (err: any) {
        log(`Erro ordem ${ordem.id}: ${err.message}`);
      }
    }
    log(`Lembretes de hospedagem enviados: ${enviados}`);
  } catch (err: any) {
    log(`Erro geral: ${err.message}`);
  }
}

// Botão manual "Lembrar tutor" (retorna erro se WhatsApp não configurado)
export async function lembrarOrdem(storeId: string, orderId: string) {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      whatsappApiUrl: true, whatsappApiKey: true,
      whatsappEnabled: true, whatsappSendReminder: true,
    },
  });
  if (!store?.whatsappEnabled || !store.whatsappApiUrl) {
    return { ok: false, error: "WhatsApp não configurado nesta loja" };
  }

  const ordem = await prisma.petServiceOrder.findFirst({
    where: { id: orderId, storeId },
    include: {
      pet: {
        select: {
          nome: true,
          tutor: { select: { nome: true, telefone: true } },
        },
      },
      items: { include: { catalog: { select: { nome: true } } } },
    },
  });
  if (!ordem) return { ok: false, error: "Ordem não encontrada" };
  const tutor = ordem.pet.tutor;
  const phone = normalizarTelefone(tutor?.telefone);
  if (!phone) return { ok: false, error: "Tutor sem telefone cadastrado" };

  const quando = new Date(ordem.dataEntrada);
  const data = quando.toLocaleDateString("pt-BR");
  const hora = ordem.horaInicio ? ` às ${ordem.horaInicio}` : "";
  const msg = `Olá ${tutor?.nome}! Passando pra lembrar: ${ordem.pet.nome} tem ${ordem.items.map(i => i.catalog?.nome).filter(Boolean).join(", ") || "serviço"} agendado para ${data}${hora}. Qualquer dúvida, fale com a gente!`;

  const ok = await enviar(store, phone, msg);
  return ok ? { ok: true } : { ok: false, error: "Falha ao enviar mensagem" };
}
