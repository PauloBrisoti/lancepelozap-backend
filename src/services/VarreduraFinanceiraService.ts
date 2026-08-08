import { prisma } from "../lib/prisma";
import { logger } from '../lib/logger';
import { startOfDay, differenceInCalendarDays, format } from "date-fns";
import { sendEmail } from "./email.service";
import { escapeHtml } from "./email.service";
import { getVarreduraConfig, VarreduraConfig } from "./configuracaoFinanceira";

export { getVarreduraConfig, VarreduraConfig };

// ============================================================
// Configurações da Varredura Financeira
// Armazenadas em SystemSetting (chave: 'VARRE_') — ver configuracaoFinanceira.ts.
// Defaults compatíveis com o comportamento atual do produto:
//   - escalonamento [1, 3, 7]: LEMBRETE_1, LEMBRETE_2, AVISO_BLOQUEIO
//   - bloqueio (MARCAR_VENCIDO) somente após bloqueioAposDias, ou seja,
//     depois do AVISO_BLOQUEIO (7 dias) — nunca no primeiro dia de atraso
//   - toleranciaAcessoDias também é usada pelo middleware de auth (período de graça)
// ============================================================

export interface PlanoItem {
  clientId: string;
  cliente: string;
  email: string;
  subscriptionId: string;
  valor: number;
  diasAtraso: number;
  dataVencimento: string;
  acoes: string[];
  bloqueioAutomaticoAtivo: boolean;
}

export interface PlanoVarredura {
  data: string;
  itens: PlanoItem[];
  resumo: {
    marcarVencido: number;
    lembretes1: number;
    lembretes2: number;
    avisosBloqueio: number;
    total: number;
  };
}

function log(msg: string) {
  logger.debug(`[VarreduraFinanceira] ${new Date().toISOString()} ${msg}`);
}

/**
 * Busca a assinatura vigente de cada cliente (a mais recente por createdAt).
 * Mesmo critério do checkActiveSubscription (middleware/auth.ts) — é ela que
 * decide o acesso do lojista.
 */
async function assinaturasVigentes() {
  const subs = await prisma.subscription.findMany({
    where: { statusPagamento: { not: "CANCELADO" } },
    orderBy: [{ clientId: "asc" }, { createdAt: "desc" }],
    include: { client: { select: { id: true, nomeCompleto: true, email: true } } },
  });

  const porCliente = new Map<string, (typeof subs)[number]>();
  for (const sub of subs) {
    if (!porCliente.has(sub.clientId)) porCliente.set(sub.clientId, sub);
  }
  return Array.from(porCliente.values());
}

/**
 * Monta o plano (dry-run) da varredura — NUNCA executa nada.
 * Pode ser chamado quantas vezes quiser; é o "simular" do fluxo.
 */
export async function buildPlan(): Promise<PlanoVarredura> {
  const hoje = startOfDay(new Date());
  const config = await getVarreduraConfig();
  const subs = await assinaturasVigentes();
  const notificacoesExistentes = await prisma.cobrancaNotificacao.findMany({
    where: { subscriptionId: { in: subs.map((s) => s.id) } },
    select: { subscriptionId: true, tipo: true },
  });
  const jaNotificados = new Set(notificacoesExistentes.map((n) => `${n.subscriptionId}:${n.tipo}`));

  const itens: PlanoItem[] = [];
  for (const sub of subs) {
    const diasAtraso = differenceInCalendarDays(hoje, startOfDay(sub.dataVencimento));
    const acoes: string[] = [];
    const [lembrete1, lembrete2, avisoBloqueio] = config.escalonamento;

    if (diasAtraso >= 1) {
      if (diasAtraso >= lembrete1 && !jaNotificados.has(`${sub.id}:LEMBRETE_1`)) acoes.push("LEMBRETE_1");
      if (diasAtraso >= lembrete2 && !jaNotificados.has(`${sub.id}:LEMBRETE_2`)) acoes.push("LEMBRETE_2");
      if (diasAtraso >= avisoBloqueio && !jaNotificados.has(`${sub.id}:AVISO_BLOQUEIO`)) acoes.push("AVISO_BLOQUEIO");
    }

    const pendenteVencido =
      sub.statusPagamento === "PENDENTE" &&
      diasAtraso >= config.bloqueioAposDias &&
      sub.bloqueioAutomaticoAtivo;

    if (pendenteVencido) acoes.push("MARCAR_VENCIDO");

    if (acoes.length === 0) continue;

    itens.push({
      clientId: sub.clientId,
      cliente: sub.client.nomeCompleto,
      email: sub.client.email,
      subscriptionId: sub.id,
      valor: Number(sub.valorMensalidade),
      diasAtraso,
      dataVencimento: format(sub.dataVencimento, "yyyy-MM-dd"),
      acoes,
      bloqueioAutomaticoAtivo: sub.bloqueioAutomaticoAtivo,
    });
  }

  const resumo = {
    marcarVencido: itens.filter((i) => i.acoes.includes("MARCAR_VENCIDO")).length,
    lembretes1: itens.filter((i) => i.acoes.includes("LEMBRETE_1")).length,
    lembretes2: itens.filter((i) => i.acoes.includes("LEMBRETE_2")).length,
    avisosBloqueio: itens.filter((i) => i.acoes.includes("AVISO_BLOQUEIO")).length,
    total: itens.length,
  };

  return {
    data: format(hoje, "yyyy-MM-dd"),
    itens: itens.sort((a, b) => b.diasAtraso - a.diasAtraso),
    resumo,
  };
}

const LABEL_ACOES: Record<string, string> = {
  MARCAR_VENCIDO: "Marcar como VENCIDO (bloqueia acesso)",
  LEMBRETE_1: "Enviar cobrança amigável (lembrete 1)",
  LEMBRETE_2: "Enviar cobrança firme (lembrete 2)",
  AVISO_BLOQUEIO: "Enviar aviso de bloqueio",
};

function templateNotificacao(cliente: string, diasAtraso: number, valor: number, tipo: string): string {
  const nome = escapeHtml(cliente);
  const corpo: Record<string, { titulo: string; texto: string }> = {
    LEMBRETE_1: {
      titulo: "Lembrete de pagamento",
      texto: "notamos que sua mensalidade venceu e ainda não identificamos o pagamento.",
    },
    LEMBRETE_2: {
      titulo: "Pagamento em atraso",
      texto: "sua mensalidade segue em aberto. Para evitar a suspensão do serviço, regularize o quanto antes.",
    },
    AVISO_BLOQUEIO: {
      titulo: "Aviso: suspensão de acesso",
      texto: "sua assinatura está com atraso e seu acesso será suspenso em breve. Regularize o pagamento para evitar a interrupção do serviço.",
    },
  };
  const c = corpo[tipo] || corpo.LEMBRETE_1;
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
    <h2 style="color:#b45309">${c.titulo}</h2>
    <p>Olá, <strong>${nome}</strong>!</p>
    <p>${c.texto}</p>
    <p>Valor em aberto: <strong>R$ ${valor.toFixed(2)}</strong> (${diasAtraso} dia(s) de atraso)</p>
    <p style="color:#6b7280;font-size:12px">Caso o pagamento já tenha sido efetuado, desconsidere esta mensagem.</p>
  </div>`;
}

async function enviarNotificacao(item: PlanoItem, tipo: string): Promise<boolean> {
  try {
    await sendEmail(
      item.email,
      `Lance Pelo Zap — ${LABEL_ACOES[tipo].replace(/^Enviar /, "")}`,
      templateNotificacao(item.cliente, item.diasAtraso, item.valor, tipo)
    );
    return true;
  } catch (err: any) {
    log(`Falha ao enviar ${tipo} para ${item.email}: ${err?.message}`);
    return false;
  }
}

/**
 * Executa o plano. Idempotente por dia: se já existe ScanRun para hoje, retorna o existente.
 * Ordem: 1) marca VENCIDO (bloqueio), 2) registra notificações + envia e-mails (best-effort),
 * 3) audit log, 4) registra o run.
 */
export async function executePlan(
  plano: PlanoVarredura,
  disparadoPor: string
): Promise<{ jaExecutadoHoje: boolean; resultado: any }> {
  const config = await getVarreduraConfig();
  const dataHoje = startOfDay(new Date());

  const runExistente = await prisma.scanRun.findUnique({
    where: { data: dataHoje },
  });
  if (runExistente) {
    log(`Varredura de hoje já executada (${runExistente.id}) — ignorando duplicata.`);
    return { jaExecutadoHoje: true, resultado: runExistente.resultado };
  }

  const resultado: any = {
    marcadasVencido: 0,
    notificacoesEnviadas: 0,
    notificacoesFalhas: 0,
    detalhes: [] as any[],
  };

  for (const item of plano.itens) {
    const detalhe: any = {
      clientId: item.clientId,
      cliente: item.cliente,
      diasAtraso: item.diasAtraso,
      valor: item.valor,
      acoes: item.acoes,
      emailEnviados: [] as string[],
      emailFalhas: [] as string[],
    };

    if (item.acoes.includes("MARCAR_VENCIDO")) {
      await prisma.subscription.update({
        where: { id: item.subscriptionId },
        data: { statusPagamento: "VENCIDO" },
      });
      await prisma.saasAuditLog.create({
        data: {
          clientId: item.clientId,
          acao: "MARCAR_VENCIDO",
          payload: { subscriptionId: item.subscriptionId, diasAtraso: item.diasAtraso },
          criadoPor: disparadoPor,
        },
      });
      detalhe.marcadaVencido = true;
      resultado.marcadasVencido++;
    }

    const tipos = item.acoes.filter((a) => a !== "MARCAR_VENCIDO");
    for (const tipo of tipos) {
      await prisma.cobrancaNotificacao.create({
        data: { subscriptionId: item.subscriptionId, tipo },
      });
      await prisma.saasAuditLog.create({
        data: {
          clientId: item.clientId,
          acao: "NOTIFICACAO",
          payload: { subscriptionId: item.subscriptionId, tipo },
          criadoPor: disparadoPor,
        },
      });

      if (config.enviarNotificacoes) {
        const ok = await enviarNotificacao(item, tipo);
        if (ok) {
          detalhe.emailEnviados.push(tipo);
          resultado.notificacoesEnviadas++;
        } else {
          detalhe.emailFalhas.push(tipo);
          resultado.notificacoesFalhas++;
        }
      }
    }

    resultado.detalhes.push(detalhe);
  }

  await prisma.scanRun.create({
    data: {
      data: dataHoje,
      disparadoPor,
      plano: JSON.parse(JSON.stringify(plano)),
      resultado: JSON.parse(JSON.stringify(resultado)),
      status: "EXECUTADO",
    },
  });

  log(`Varredura executada: ${resultado.marcadasVencido} marcadas VENCIDO, ${resultado.notificacoesEnviadas} e-mails enviados.`);
  return { jaExecutadoHoje: false, resultado };
}

/**
 * Relatório diário para o dono do SaaS.
 */
export async function enviarRelatorio(plano: PlanoVarredura, resultado: any, disparadoPor: string) {
  const config = await getVarreduraConfig();
  if (!config.relatorioEmail) return;

  const linhas = (resultado?.detalhes || [])
    .map(
      (d: any) =>
        `<li><strong>${escapeHtml(d.cliente)}</strong> — ${d.diasAtraso} dia(s) de atraso, R$ ${Number(d.valor).toFixed(2)}` +
        (d.marcadaVencido ? " — <strong>marcada como VENCIDO</strong>" : "") +
        (d.emailEnviados?.length ? ` — e-mails: ${d.emailEnviados.join(", ")}` : "") +
        (d.emailFalhas?.length ? ` — <span style="color:#dc2626">FALHA: ${d.emailFalhas.join(", ")}</span>` : "") +
        `</li>`
    )
    .join("");

  try {
    await sendEmail(
      config.relatorioEmail,
      `Varredura Financeira — ${plano.data} (${disparadoPor})`,
      `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2 style="color:#059669">Varredura Financeira — ${plano.data}</h2>
        <p><strong>Execução:</strong> ${escapeHtml(disparadoPor)}</p>
        <p><strong>Marcadas como VENCIDO:</strong> ${resultado?.marcadasVencido || 0}</p>
        <p><strong>E-mails enviados:</strong> ${resultado?.notificacoesEnviadas || 0} (falhas: ${resultado?.notificacoesFalhas || 0})</p>
        ${linhas ? `<h3>Detalhes</h3><ul>${linhas}</ul>` : "<p>Nenhuma ação necessária.</p>"}
      </div>`
    );
  } catch (err: any) {
    log(`Falha ao enviar relatório: ${err?.message}`);
  }
}

export async function executarVarreduraAutomatica() {
  try {
    const plano = await buildPlan();
    const { jaExecutadoHoje, resultado } = await executePlan(plano, "cron");
    if (!jaExecutadoHoje) {
      await enviarRelatorio(plano, resultado, "cron");
    }
  } catch (error: any) {
    log(`ERRO na varredura automática: ${error?.message}`);
  }
}
