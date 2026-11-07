import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/asyncHandler';

export const DEFAULT_ACCOUNTS = [
  // 1. ATIVO
  { codigo: '1', nome: 'ATIVO', tipo: 'ATIVO', natureza: 'DEVEDORA', nivel: 1, isSintetica: true },
  { codigo: '1.1', nome: 'Ativo Circulante', tipo: 'ATIVO', natureza: 'DEVEDORA', nivel: 2, isSintetica: true },
  { codigo: '1.1.01', nome: 'Disponibilidades', tipo: 'ATIVO', natureza: 'DEVEDORA', nivel: 3, isSintetica: true },
  { codigo: '1.1.01.001', nome: 'Caixa Geral / PDV', tipo: 'ATIVO', natureza: 'DEVEDORA', nivel: 4, isSintetica: false },
  { codigo: '1.1.01.002', nome: 'Bancos Conta Movimento', tipo: 'ATIVO', natureza: 'DEVEDORA', nivel: 4, isSintetica: false },
  { codigo: '1.1.02', nome: 'Créditos e Contas a Receber', tipo: 'ATIVO', natureza: 'DEVEDORA', nivel: 3, isSintetica: true },
  { codigo: '1.1.02.001', nome: 'Clientes (Crediário / Fiado)', tipo: 'ATIVO', natureza: 'DEVEDORA', nivel: 4, isSintetica: false },
  { codigo: '1.1.03', nome: 'Estoques', tipo: 'ATIVO', natureza: 'DEVEDORA', nivel: 3, isSintetica: true },
  { codigo: '1.1.03.001', nome: 'Estoque de Mercadorias para Revenda', tipo: 'ATIVO', natureza: 'DEVEDORA', nivel: 4, isSintetica: false },

  // 2. PASSIVO
  { codigo: '2', nome: 'PASSIVO', tipo: 'PASSIVO', natureza: 'CREDORA', nivel: 1, isSintetica: true },
  { codigo: '2.1', nome: 'Passivo Circulante', tipo: 'PASSIVO', natureza: 'CREDORA', nivel: 2, isSintetica: true },
  { codigo: '2.1.01', nome: 'Obrigações Comerciais', tipo: 'PASSIVO', natureza: 'CREDORA', nivel: 3, isSintetica: true },
  { codigo: '2.1.01.001', nome: 'Fornecedores Nacionais', tipo: 'PASSIVO', natureza: 'CREDORA', nivel: 4, isSintetica: false },
  { codigo: '2.1.02', nome: 'Obrigações Tributárias', tipo: 'PASSIVO', natureza: 'CREDORA', nivel: 3, isSintetica: true },
  { codigo: '2.1.02.001', nome: 'Impostos e Retenções a Recolher', tipo: 'PASSIVO', natureza: 'CREDORA', nivel: 4, isSintetica: false },

  // 3. PATRIMÔNIO LÍQUIDO
  { codigo: '3', nome: 'PATRIMÔNIO LÍQUIDO', tipo: 'PATRIMONIO_LIQUIDO', natureza: 'CREDORA', nivel: 1, isSintetica: true },
  { codigo: '3.1.01.001', nome: 'Capital Social Integralizado', tipo: 'PATRIMONIO_LIQUIDO', natureza: 'CREDORA', nivel: 4, isSintetica: false },
  { codigo: '3.1.02.001', nome: 'Lucros ou Prejuízos Acumulados', tipo: 'PATRIMONIO_LIQUIDO', natureza: 'CREDORA', nivel: 4, isSintetica: false },

  // 4. RECEITAS
  { codigo: '4', nome: 'RECEITAS', tipo: 'RECEITA', natureza: 'CREDORA', nivel: 1, isSintetica: true },
  { codigo: '4.1', nome: 'Receita Operacional Bruta', tipo: 'RECEITA', natureza: 'CREDORA', nivel: 2, isSintetica: true },
  { codigo: '4.1.01.001', nome: 'Receita de Venda de Mercadorias', tipo: 'RECEITA', natureza: 'CREDORA', nivel: 4, isSintetica: false },
  { codigo: '4.1.01.002', nome: 'Receita de Serviços Prestados', tipo: 'RECEITA', natureza: 'CREDORA', nivel: 4, isSintetica: false },
  { codigo: '4.1.02.001', nome: '(-) Descontos Comerciais Concedidos', tipo: 'RECEITA', natureza: 'DEVEDORA', nivel: 4, isSintetica: false },
  { codigo: '4.1.02.002', nome: '(-) Taxas de Meios de Pagamento', tipo: 'RECEITA', natureza: 'DEVEDORA', nivel: 4, isSintetica: false },

  // 5. CUSTOS E DESPESAS
  { codigo: '5', nome: 'CUSTOS E DESPESAS', tipo: 'DESPESA', natureza: 'DEVEDORA', nivel: 1, isSintetica: true },
  { codigo: '5.1', nome: 'Custos Operacionais', tipo: 'DESPESA', natureza: 'DEVEDORA', nivel: 2, isSintetica: true },
  { codigo: '5.1.01.001', nome: 'Custo das Mercadorias Vendidas (CMV)', tipo: 'DESPESA', natureza: 'DEVEDORA', nivel: 4, isSintetica: false },
  { codigo: '5.2', nome: 'Despesas Operacionais', tipo: 'DESPESA', natureza: 'DEVEDORA', nivel: 2, isSintetica: true },
  { codigo: '5.2.01.001', nome: 'Despesas Administrativas Gerais', tipo: 'DESPESA', natureza: 'DEVEDORA', nivel: 4, isSintetica: false },
  { codigo: '5.2.01.002', nome: 'Comissões sobre Vendas', tipo: 'DESPESA', natureza: 'DEVEDORA', nivel: 4, isSintetica: false },
] as const;

export class AccountingService {
  /**
   * Garante a presença do Plano de Contas padrão para a loja.
   */
  static async ensureDefaultAccounts(storeId: string) {
    const count = await prisma.chartOfAccount.count({ where: { storeId } });
    if (count > 0) return;

    for (const acc of DEFAULT_ACCOUNTS) {
      await prisma.chartOfAccount.create({
        data: {
          storeId,
          codigo: acc.codigo,
          nome: acc.nome,
          tipo: acc.tipo,
          natureza: acc.natureza,
          nivel: acc.nivel,
          isSintetica: acc.isSintetica,
          isDefault: true,
          ativo: true,
        },
      });
    }
  }

  /**
   * Localiza conta contábil por código na loja (ou padrão do sistema).
   */
  static async findAccountByCode(tx: Prisma.TransactionClient, storeId: string, codigo: string) {
    return tx.chartOfAccount.findFirst({
      where: {
        codigo,
        OR: [{ storeId }, { storeId: null }],
        ativo: true,
      },
    });
  }

  /**
   * Cria um lançamento contábil garantindo o Princípio das Partidas Dobradas:
   * Soma de Débitos === Soma de Créditos.
   */
  static async recordJournalEntry(
    tx: Prisma.TransactionClient,
    params: {
      storeId: string;
      dataLancamento?: Date;
      descricao: string;
      origemTipo: 'VENDA' | 'COMPRA' | 'RECEBIMENTO' | 'PAGAMENTO' | 'ESTORNO' | 'MANUAL';
      origemId?: string;
      criadoPor?: string;
      lines: Array<{
        accountId: string;
        tipo: 'DEBITO' | 'CREDITO';
        valor: number;
        historico?: string;
      }>;
    }
  ) {
    const { storeId, dataLancamento = new Date(), descricao, origemTipo, origemId, criadoPor, lines } = params;

    if (!lines || lines.length < 2) {
      throw new HttpError('Um lançamento contábil exige pelo menos duas partidas (uma a débito e uma a crédito).', 400);
    }

    let totalDebito = 0;
    let totalCredito = 0;

    for (const line of lines) {
      const v = Math.round(Number(line.valor) * 100) / 100;
      if (v <= 0) continue;
      if (line.tipo === 'DEBITO') totalDebito += v;
      if (line.tipo === 'CREDITO') totalCredito += v;
    }

    totalDebito = Math.round(totalDebito * 100) / 100;
    totalCredito = Math.round(totalCredito * 100) / 100;

    const diff = Math.abs(totalDebito - totalCredito);
    if (diff > 0.01) {
      throw new HttpError(
        `Partida dobrada desbalanceada: Débitos (R$ ${totalDebito.toFixed(2)}) != Créditos (R$ ${totalCredito.toFixed(2)}). Diferença: R$ ${diff.toFixed(2)}`,
        400
      );
    }

    const entry = await tx.journalEntry.create({
      data: {
        storeId,
        dataLancamento,
        descricao,
        origemTipo,
        origemId: origemId || null,
        criadoPor: criadoPor || null,
        lines: {
          create: lines
            .filter(l => Number(l.valor) > 0)
            .map(l => ({
              accountId: l.accountId,
              tipo: l.tipo,
              valor: Math.round(Number(l.valor) * 100) / 100,
              historico: l.historico || null,
            })),
        },
      },
      include: { lines: true },
    });

    return entry;
  }

  /**
   * Escritura automaticamente a venda em partidas dobradas:
   *   D - Caixa / Banco / Clientes a Receber (Valor Líquido)
   *   D - Descontos Concedidos (se houver)
   *   D - Taxas de Gateway (se houver)
   *   C - Receita Bruta de Vendas (Valor Total Bruto)
   *
   * E quando há CMV:
   *   D - Custo das Mercadorias Vendidas
   *   C - Estoque de Mercadorias
   */
  static async recordSaleAutomation(
    tx: Prisma.TransactionClient,
    params: {
      storeId: string;
      saleId: string;
      dataVenda: Date;
      valorTotalBruto: number;
      valorDesconto: number;
      valorTaxasGateway: number;
      valorTotalLiquido: number;
      cmvTotal: number;
      formaPagamento: string;
      userId?: string;
    }
  ) {
    const {
      storeId,
      saleId,
      dataVenda,
      valorTotalBruto,
      valorDesconto,
      valorTaxasGateway,
      valorTotalLiquido,
      cmvTotal,
      formaPagamento,
      userId,
    } = params;

    // Buscar contas analíticas
    const [contaCaixa, contaClientes, contaReceita, contaDesconto, contaTaxas, contaCMV, contaEstoque] =
      await Promise.all([
        this.findAccountByCode(tx, storeId, '1.1.01.001'), // Caixa Geral
        this.findAccountByCode(tx, storeId, '1.1.02.001'), // Clientes (Crediário)
        this.findAccountByCode(tx, storeId, '4.1.01.001'), // Receita Bruta
        this.findAccountByCode(tx, storeId, '4.1.02.001'), // Descontos
        this.findAccountByCode(tx, storeId, '4.1.02.002'), // Taxas Gateway
        this.findAccountByCode(tx, storeId, '5.1.01.001'), // CMV
        this.findAccountByCode(tx, storeId, '1.1.03.001'), // Estoque
      ]);

    if (!contaReceita) return null; // Sem plano de contas ativo, não bloqueia o fluxo legado

    const lines: Array<{ accountId: string; tipo: 'DEBITO' | 'CREDITO'; valor: number; historico?: string }> = [];

    // Destino do recurso: se crediário vai para Clientes, caso contrário Caixa/Banco
    const contaDestino = formaPagamento === 'CREDIARIO' ? (contaClientes || contaCaixa) : contaCaixa;

    if (contaDestino && valorTotalLiquido > 0) {
      lines.push({ accountId: contaDestino.id, tipo: 'DEBITO', valor: valorTotalLiquido, historico: 'Recebimento de Venda' });
    }
    if (contaDesconto && valorDesconto > 0) {
      lines.push({ accountId: contaDesconto.id, tipo: 'DEBITO', valor: valorDesconto, historico: 'Desconto Concedido' });
    }
    if (contaTaxas && valorTaxasGateway > 0) {
      lines.push({ accountId: contaTaxas.id, tipo: 'DEBITO', valor: valorTaxasGateway, historico: 'Taxas Gateway' });
    }

    lines.push({ accountId: contaReceita.id, tipo: 'CREDITO', valor: valorTotalBruto, historico: `Venda #${saleId.slice(0, 8)}` });

    await this.recordJournalEntry(tx, {
      storeId,
      dataLancamento: dataVenda,
      descricao: `Reconhecimento de Receita — Venda #${saleId.slice(0, 8)}`,
      origemTipo: 'VENDA',
      origemId: saleId,
      criadoPor: userId,
      lines,
    });

    // Lançamento do Custo da Mercadoria Vendida (CMV) e baixa de estoque
    if (cmvTotal > 0 && contaCMV && contaEstoque) {
      await this.recordJournalEntry(tx, {
        storeId,
        dataLancamento: dataVenda,
        descricao: `Baixa de Estoque e CMV — Venda #${saleId.slice(0, 8)}`,
        origemTipo: 'VENDA',
        origemId: saleId,
        criadoPor: userId,
        lines: [
          { accountId: contaCMV.id, tipo: 'DEBITO', valor: cmvTotal, historico: 'Reconhecimento de CMV' },
          { accountId: contaEstoque.id, tipo: 'CREDITO', valor: cmvTotal, historico: 'Baixa de Estoque Contábil' },
        ],
      });
    }
  }
}

