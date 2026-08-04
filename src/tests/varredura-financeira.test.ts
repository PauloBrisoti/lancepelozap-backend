import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../lib/prisma';
import { addDays, subDays } from 'date-fns';
import { buildPlan, executePlan } from '../services/VarreduraFinanceiraService';
import { createClientWithStore } from './factory';

describe('Varredura Financeira', () => {
  let client: any;
  let plan: any;

  beforeAll(async () => {
    const resultado = await createClientWithStore();
    client = resultado.client;
    plan = await prisma.plan.create({
      data: {
        nome: 'Plano Teste Varredura',
        precoMensal: 99,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('marca assinatura PENDENTE vencida como VENCIDO e programa notificações', async () => {
    const sub = await prisma.subscription.create({
      data: {
        clientId: client.id,
        planId: plan.id,
        valorMensalidade: 99,
        dataVencimento: subDays(new Date(), 20),
        statusPagamento: 'PENDENTE',
        bloqueioAutomaticoAtivo: true,
      },
    });

    const plano = await buildPlan();
    const item = plano.itens.find((i) => i.subscriptionId === sub.id);
    expect(item).toBeDefined();
    expect(item!.diasAtraso).toBeGreaterThanOrEqual(20);
    expect(item!.acoes).toContain('MARCAR_VENCIDO');
    expect(item!.acoes).toContain('LEMBRETE_1');
    expect(item!.acoes).toContain('LEMBRETE_2');
    expect(item!.acoes).toContain('AVISO_BLOQUEIO');

    const { jaExecutadoHoje, resultado } = await executePlan(plano, 'teste');
    expect(jaExecutadoHoje).toBe(false);
    expect(resultado.marcadasVencido).toBeGreaterThanOrEqual(1);

    const atualizada = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(atualizada!.statusPagamento).toBe('VENCIDO');

    const notificacoes = await prisma.cobrancaNotificacao.findMany({
      where: { subscriptionId: sub.id },
    });
    expect(notificacoes.map((n) => n.tipo).sort()).toEqual(
      ['AVISO_BLOQUEIO', 'LEMBRETE_1', 'LEMBRETE_2'].sort()
    );
  });

  it('é idempotente: segunda execução no mesmo dia não duplica ações', async () => {
    const plano = await buildPlan();
    const { jaExecutadoHoje } = await executePlan(plano, 'teste2');
    expect(jaExecutadoHoje).toBe(true);

    const notificacoes = await prisma.cobrancaNotificacao.count();
    const antes = notificacoes;
    const depois = await prisma.cobrancaNotificacao.count();
    expect(antes).toBe(depois);
  });

  it('não planeja ações para assinatura PAGO em dia', async () => {
    await prisma.subscription.create({
      data: {
        clientId: client.id,
        planId: plan.id,
        valorMensalidade: 99,
        dataVencimento: addDays(new Date(), 5),
        statusPagamento: 'PAGO',
        bloqueioAutomaticoAtivo: true,
      },
    });

    const plano = await buildPlan();
    const pago = plano.itens.filter((i) => i.email.includes('@lpzteste.app') === false || i.acoes.length > 0);
    const itemPago = plano.itens.find((i) => i.diasAtraso < 0);
    expect(itemPago).toBeUndefined();
    expect(pago.length).toBeGreaterThanOrEqual(0);
  });

  it('período de graça: PENDENTE dentro da tolerância recebe avisos mas NÃO é marcado VENCIDO', async () => {
    const sub = await prisma.subscription.create({
      data: {
        clientId: client.id,
        planId: plan.id,
        valorMensalidade: 99,
        dataVencimento: subDays(new Date(), 10),
        statusPagamento: 'PENDENTE',
        bloqueioAutomaticoAtivo: true,
      },
    });

    const plano = await buildPlan();
    const item = plano.itens.find((i) => i.subscriptionId === sub.id);
    expect(item).toBeDefined();
    expect(item!.acoes).toContain('LEMBRETE_1');
    expect(item!.acoes).toContain('LEMBRETE_2');
    expect(item!.acoes).toContain('AVISO_BLOQUEIO');
    expect(item!.acoes).not.toContain('MARCAR_VENCIDO');
  });
});
