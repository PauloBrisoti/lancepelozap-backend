import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { auditLog } from '../lib/audit';
import { buildDateRange, getTimezone } from '../lib/dateUtils';
import { toZonedTime } from 'date-fns-tz';

async function deleteSaleTree(tx: any, sale: { id: string; saleItems: { id: string; productId: string; quantidade: any }[] }, storeId: string, userId: string) {
  for (const item of sale.saleItems) {
    await tx.product.update({
      where: { id: item.productId },
      data: { qtdEstoqueAtual: { increment: Number(item.quantidade) } },
    });
    await tx.stockMovement.create({
      data: {
        storeId, productId: item.productId, userId,
        tipo: 'ENTRADA',
        quantidade: Number(item.quantidade),
        saldoAnterior: 0, saldoPosterior: 0,
        referenciaId: sale.id,
        observacao: `Estorno por exclusão de venda #${sale.id}`,
      },
    });
  }

  const returns = await tx.productReturn.findMany({ where: { saleId: sale.id }, select: { id: true } });
  if (returns.length > 0) {
    await tx.productReturn.deleteMany({ where: { id: { in: returns.map((r: any) => r.id) } } });
  }

  // Delete all receivables of this sale + their payments, with wallet estorno
  const recs = await tx.accountReceivable.findMany({
    where: { saleId: sale.id },
    include: { payments: { select: { id: true, walletId: true, tipo: true, valor: true } } },
  });
  for (const rec of recs) {
    for (const payment of rec.payments) {
      if (payment.tipo === 'ENTRADA') {
        await tx.wallet.update({ where: { id: payment.walletId }, data: { saldoAtual: { decrement: Number(payment.valor) } } });
      } else if (payment.tipo === 'SAIDA') {
        await tx.wallet.update({ where: { id: payment.walletId }, data: { saldoAtual: { increment: Number(payment.valor) } } });
      }
      await tx.financialTransaction.delete({ where: { id: payment.id } });
    }
    await tx.accountReceivable.delete({ where: { id: rec.id } });
  }

  await tx.saleItem.deleteMany({ where: { saleId: sale.id } });
  await tx.sale.delete({ where: { id: sale.id } });
}

export class FinanceController {
  
  // 0. CATEGORIAS FINANCEIRAS
  static async listCategories(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: { features: true }
      });
      const storeFeatures: Record<string, boolean> = store?.features ? JSON.parse(store.features) : {};
      const activeModulos = Object.entries(storeFeatures).filter(([, v]) => v).map(([k]) => k);
      const categories = await prisma.financialCategory.findMany({
        where: {
          OR: [
            { storeId },
            { isDefault: true, modulo: null },
            { isDefault: true, modulo: { in: activeModulos, not: null } }
          ]
        },
        orderBy: { nome: 'asc' }
      });
      return res.json(categories);
    } catch (error) {
      console.error('Erro ao listar categorias financeiras:', error);
      return res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  static async createCategory(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const { nome, tipo } = req.body;
      if (!nome || !tipo) {
        return res.status(400).json({ message: 'Nome e tipo são obrigatórios' });
      }
      const category = await prisma.financialCategory.create({
        data: { nome, tipo, storeId }
      });
      return res.status(201).json(category);
    } catch (error) {
      console.error('Erro ao criar categoria financeira:', error);
      return res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // 1. DASHBOARD E SALDOS
  static async getDashboard(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: 'Não autorizado' });

      // Saldo das carteiras
      let wallets = await prisma.wallet.findMany({
        where: { storeId }
      });

      // Se não tiver nenhuma carteira, cria uma padrão "Caixa Interno"
      if (wallets.length === 0) {
        const defaultWallet = await prisma.wallet.create({
          data: {
            storeId,
            nome: 'Caixa Interno',
            tipo: 'EMPRESA',
            saldoAtual: 0
          }
        });
        wallets = [defaultWallet];
      }
      
      const saldoTotal = wallets.reduce((acc, w) => acc + Number(w.saldoAtual), 0);

      const queryStart = req.query.startDate as string;
      const queryEnd = req.query.endDate as string;
      
      const { firstDay: startOfPeriod, lastDay: endOfPeriod } = buildDateRange(queryStart, queryEnd);
      const hoje = toZonedTime(new Date(), getTimezone());
      hoje.setHours(0, 0, 0, 0);

      // Recebimentos (inclui clientes devedores)
      const receivables = await prisma.accountReceivable.findMany({
        where: { storeId, status: { not: 'CANCELADA' } },
        include: {
          customer: {
            select: { nomeCompleto: true, telefoneWhatsapp: true }
          },
          payments: {
            where: { tipo: 'ENTRADA', status: 'ATIVA' },
            select: { valor: true }
          }
        }
      });

      // Pagamentos Pendentes
      const payables = await prisma.accountPayable.findMany({
        where: { storeId, status: 'PENDENTE' }
      });

      let totalAtrasado = 0;
      let totalAVencer = 0;
      let somaRecebimentosMes = 0;
      let somaPagamentosMes = 0;
      
      const devedoresAtrasados: any[] = [];

      receivables.forEach(r => {
        const dtVencimento = new Date(r.dataVencimento);
        const totalPago = r.payments.reduce((s, p) => s + Number(p.valor), 0);
        const saldoParcela = Number(r.valorParcela) - totalPago;
        
        if (dtVencimento <= endOfPeriod) {
          somaRecebimentosMes += saldoParcela;
        }

        if (dtVencimento < hoje && saldoParcela > 0) {
          totalAtrasado += saldoParcela;
          if (r.customer) {
            devedoresAtrasados.push({
              id: r.id,
              nome: r.customer.nomeCompleto,
              telefone: r.customer.telefoneWhatsapp,
              valor: saldoParcela,
              diasAtraso: Math.floor((hoje.getTime() - dtVencimento.getTime()) / (1000 * 3600 * 24))
            });
          }
        } else {
          totalAVencer += saldoParcela;
        }
      });

      payables.forEach(p => {
        const dtVencimento = new Date(p.dataVencimento);
        if (dtVencimento <= endOfPeriod) {
          somaPagamentosMes += Number(p.valor);
        }
      });

      const saldoProjetado = saldoTotal + somaRecebimentosMes - somaPagamentosMes;

      const monthTransactions = await prisma.financialTransaction.findMany({
        where: {
          storeId,
          status: 'ATIVA',
          dataTransacao: {
            gte: startOfPeriod,
            lte: endOfPeriod
          },
          categoria: { notIn: ['CANCELAMENTO'] }
        }
      });

      let receitasMes = 0;
      let despesasMes = 0;

      monthTransactions.forEach(t => {
        if (t.tipo === 'ENTRADA') receitasMes += Number(t.valor);
        if (t.tipo === 'SAIDA') despesasMes += Number(t.valor);
      });

      return res.json({
        saldoTotal,
        saldoProjetado,
        totalAtrasado,
        totalAVencer,
        receitasMes,
        despesasMes,
        wallets,
        devedoresAtrasados
      });
    } catch (error) {
      console.error('Erro no dashboard:', error);
      return res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // 2. TRANSAÇÕES
  static async getTransactions(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: 'Não autorizado' });

      const queryStart = req.query.startDate as string;
      const queryEnd = req.query.endDate as string;
      
      const whereClause: any = { storeId };
      if (queryStart && queryEnd) {
        const { firstDay, lastDay } = buildDateRange(queryStart, queryEnd);
        whereClause.dataTransacao = { gte: firstDay, lte: lastDay };
      }

      whereClause.status = 'ATIVA';

      const transactions = await prisma.financialTransaction.findMany({
        where: whereClause,
        orderBy: { dataTransacao: 'desc' },
        take: queryStart && queryEnd ? undefined : 50,
        include: {
          wallet: { select: { nome: true } },
          sale: {
            include: {
              customer: { select: { nomeCompleto: true } },
              saleItems: {
                include: { product: { select: { nome: true } } }
              }
            }
          }
        }
      });

      return res.json(transactions);
    } catch (error) {
      console.error('Erro nas transações:', error);
      return res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  static async addTransaction(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: 'Não autorizado' });

      // If multer processed a file, it will be in req.file
      let comprovanteUrl = undefined;
      if (req.file) {
        comprovanteUrl = `/uploads/${req.file.filename}`;
      }

      const {
        walletId, tipo, valor, descricao, categoria, dataTransacao,
        customerId, fornecedor, supplierId,
        isParcelado, numeroParcelas, frequencia, isFirstPaid
      } = req.body;
      
      if (!walletId || !tipo || !valor || !descricao) {
        return res.status(400).json({ message: 'Campos obrigatórios: walletId, tipo, valor, descricao' });
      }

      const valorNum = Number(valor);
      const dtTransacao = dataTransacao ? new Date(dataTransacao) : new Date();

      const transaction = await prisma.$transaction(async (tx) => {
        
        let firstTxId = null;

        if (isParcelado === 'true') {
          const parcelas = Number(numeroParcelas);
          const freq = frequencia as string;
          const primeiraPaga = isFirstPaid === 'true';

          for (let i = 0; i < parcelas; i++) {
            // Calculate due date
            const dtVencimento = new Date(dtTransacao);
            if (freq === 'MENSAL') {
              const diaOriginal = new Date(dtTransacao).getDate();
              dtVencimento.setMonth(dtVencimento.getMonth() + i);
              if (dtVencimento.getDate() !== diaOriginal) {
                dtVencimento.setDate(0); 
              }
            } else if (freq === 'SEMANAL') {
              dtVencimento.setDate(dtVencimento.getDate() + (i * 7));
            } else if (freq === 'QUINZENAL') {
              dtVencimento.setDate(dtVencimento.getDate() + (i * 15));
            }

            const isCurrentPaid = (i === 0 && primeiraPaga);

            if (isCurrentPaid) {
              // Create FinancialTransaction for the paid installment
              const newTx = await tx.financialTransaction.create({
                data: {
                  storeId,
                  walletId,
                  tipo,
                  valor: valorNum,
                  descricao: `${descricao} (${i + 1}/${parcelas})`,
                  categoria,
                  dataTransacao: dtVencimento,
                  comprovanteUrl,
                  customerId: customerId || null,
                  fornecedor: fornecedor || null,
                  supplierId: supplierId || null
                }
              });
              if (i === 0) firstTxId = newTx.id;

              // Update balance
              await tx.wallet.update({
                where: { id: walletId },
                data: {
                  saldoAtual: tipo === 'ENTRADA' 
                    ? { increment: valorNum }
                    : { decrement: valorNum }
                }
              });
            } else {
              // Create AccountPayable or AccountReceivable
              if (tipo === 'ENTRADA') {
                await tx.accountReceivable.create({
                  data: {
                    storeId,
                    customerId: customerId || 'unknown', // Assumes customerId is required for receivables ideally, but fallback
                    dataVencimento: dtVencimento,
                    numeroParcela: i + 1,
                    totalParcelas: parcelas,
                    valorParcela: valorNum,
                    formaPagamentoEsperada: 'Outros',
                    status: 'PENDENTE',
                    urlComprovanteStorage: comprovanteUrl
                  }
                });
              } else {
                await tx.accountPayable.create({
                  data: {
                    storeId,
                    descricao: `${descricao} (${i + 1}/${parcelas})`,
                    categoria,
                    fornecedor: fornecedor || customerId || null,
                    supplierId: supplierId || null,
                    dataVencimento: dtVencimento,
                    valor: valorNum,
                    status: 'PENDENTE'
                  }
                });
              }
            }
          }
          return { message: 'Parcelamento criado com sucesso' };
        } else {
          // Standard single transaction
          const newTx = await tx.financialTransaction.create({
            data: {
              storeId,
              walletId,
              tipo,
              valor: valorNum,
              descricao,
              categoria,
              dataTransacao: dtTransacao,
              comprovanteUrl,
              customerId: customerId || null,
              fornecedor: fornecedor || null,
              supplierId: supplierId || null
            }
          });

          // Atualizar o saldo da carteira
          await tx.wallet.update({
            where: { id: walletId },
            data: {
              saldoAtual: tipo === 'ENTRADA' 
                ? { increment: valorNum }
                : { decrement: valorNum }
            }
          });

          return newTx;
        }
      });

      return res.status(201).json(transaction);
    } catch (error) {
      console.error('Erro ao adicionar transação:', error);
      return res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  static async updateTransaction(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;
      const { walletId, tipo, valor, descricao, categoria, dataTransacao } = req.body;
      
      if (!storeId) return res.status(401).json({ message: 'Não autorizado' });

      // Busca a transação antiga para verificar impacto no saldo
      const oldTx = await prisma.financialTransaction.findFirst({
        where: { id, storeId }
      });

      if (!oldTx) {
        return res.status(404).json({ message: 'Transação não encontrada' });
      }

      const valorNum = Number(valor);

      const transaction = await prisma.$transaction(async (tx) => {
        // Reverter impacto da transação antiga na carteira
        await tx.wallet.update({
          where: { id: oldTx.walletId },
          data: {
            saldoAtual: oldTx.tipo === 'ENTRADA' 
              ? { decrement: oldTx.valor }
              : { increment: oldTx.valor }
          }
        });

        const dtTransacao = dataTransacao ? new Date(dataTransacao) : undefined;

        // Atualizar transação
        const updatedTx = await tx.financialTransaction.update({
          where: { id },
          data: { 
            walletId, 
            tipo, 
            valor: valorNum, 
            descricao, 
            categoria,
            ...(dtTransacao && { dataTransacao: dtTransacao })
          }
        });

        // Se a transação é de uma venda, propaga a data para a venda
        if (oldTx.saleId && dtTransacao) {
          await tx.sale.update({
            where: { id: oldTx.saleId },
            data: { dataVenda: dtTransacao }
          });
        }

        // Aplicar novo impacto na nova carteira
        await tx.wallet.update({
          where: { id: walletId },
          data: {
            saldoAtual: tipo === 'ENTRADA'
              ? { increment: valorNum }
              : { decrement: valorNum }
          }
        });

        return updatedTx;
      });

      return res.json(transaction);
    } catch (error) {
      console.error('Erro ao atualizar transação:', error);
      return res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // 3. CONTAS A RECEBER (FIADO)
  static async getReceivables(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: 'Não autorizado' });

      const queryStart = req.query.startDate as string | undefined;
      const queryEnd = req.query.endDate as string | undefined;
      const dateWhere = queryStart && queryEnd
        ? (() => { const r = buildDateRange(queryStart, queryEnd); return { dataVencimento: { gte: r.firstDay, lte: r.lastDay } }; })()
        : {};

      const receivables = await prisma.accountReceivable.findMany({
        where: {
          storeId,
          status: { not: 'CANCELADA' },
          ...dateWhere
        },
        orderBy: { dataVencimento: 'asc' },
        include: {
          customer: { select: { nomeCompleto: true } },
          sale: { select: { id: true, dataVenda: true, valorTotalLiquido: true, formaPagamento: true } },
          payments: {
            where: { tipo: 'ENTRADA', status: 'ATIVA' },
            select: { valor: true }
          }
        }
      });

      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      const enriched = receivables
        .sort((a, b) => {
          const aVenc = new Date(a.dataVencimento) < hoje;
          const bVenc = new Date(b.dataVencimento) < hoje;
          if (aVenc !== bVenc) return aVenc ? -1 : 1;
          return new Date(a.dataVencimento).getTime() - new Date(b.dataVencimento).getTime();
        })
        .map(r => {
        const totalPago = r.payments.reduce((s, p) => s + Number(p.valor), 0);
        const valorOriginal = Number(r.valorParcela);
        const saldoRestante = Math.max(0, valorOriginal - totalPago);
        const dtVencimento = new Date(r.dataVencimento);
        const vencido = dtVencimento < hoje && saldoRestante > 0;

        let statusExibicao: string;
        if (saldoRestante === 0) {
          statusExibicao = 'PAGO';
        } else if (totalPago > 0) {
          statusExibicao = 'PAGO_PARCIAL';
        } else if (vencido) {
          statusExibicao = 'VENCIDO';
        } else {
          statusExibicao = 'PENDENTE';
        }

        return {
          ...r,
          valorOriginal,
          valorJaPago: totalPago,
          saldoRestante,
          statusExibicao,
          status: statusExibicao,
        };
      });

      return res.json(enriched);
    } catch (error) {
      console.error('Erro em getReceivables:', error);
      return res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  static async payReceivable(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: 'Não autorizado' });
      
      const id = req.params.id as string;
      let { walletId, valorPago } = req.body;

      if (!walletId) {
        const wallet = await prisma.wallet.findFirst({ where: { storeId } });
        if (wallet) {
          walletId = wallet.id;
        } else {
          const newWallet = await prisma.wallet.create({
            data: { storeId, nome: 'Caixa Interno', tipo: 'EMPRESA', saldoAtual: 0 }
          });
          walletId = newWallet.id;
        }
      }

      const receivable = await prisma.accountReceivable.findUnique({
        where: { id },
        include: {
          payments: {
            where: { tipo: 'ENTRADA', status: 'ATIVA' },
            select: { valor: true }
          }
        }
      });

      if (!receivable || receivable.storeId !== storeId) {
        return res.status(404).json({ message: 'Parcela não encontrada' });
      }

      const valorParcelaOriginal = Number(receivable.valorParcela);
      const valorJaPago = receivable.payments.reduce((s, p) => s + Number(p.valor), 0);
      const saldoRestante = valorParcelaOriginal - valorJaPago;

      if (saldoRestante <= 0) {
        return res.status(400).json({ message: 'Esta parcela já está totalmente paga' });
      }

      const valorPagarAgora = valorPago !== undefined ? Number(valorPago) : saldoRestante;

      if (valorPagarAgora <= 0) {
        return res.status(400).json({ message: 'Valor do pagamento deve ser positivo' });
      }

      if (valorPagarAgora > saldoRestante) {
        return res.status(400).json({ message: `Valor ultrapassa o saldo devedor de R$ ${saldoRestante.toFixed(2)}` });
      }

      const novoTotalPago = valorJaPago + valorPagarAgora;
      const quitou = novoTotalPago >= valorParcelaOriginal;

      await prisma.$transaction(async (tx) => {
        // 1. Marcar como PAGO_PARCIAL no BD (nunca PAGO — status é sempre dinâmico)
        await tx.accountReceivable.update({
          where: { id },
          data: { status: 'PAGO_PARCIAL' }
        });

        // 2. Lançar a entrada vinculada à parcela (receivableId)
        const descricao = quitou
          ? `Pagamento Parcela ${receivable.numeroParcela}/${receivable.totalParcelas} - Fiado`
          : `Pagamento Parcial Parcela ${receivable.numeroParcela}/${receivable.totalParcelas} (R$ ${valorPagarAgora.toFixed(2)}/${saldoRestante.toFixed(2)})`;

        await tx.financialTransaction.create({
          data: {
            storeId,
            walletId,
            saleId: receivable.saleId,
            receivableId: receivable.id,
            tipo: 'ENTRADA',
            valor: valorPagarAgora,
            descricao,
            categoria: 'Vendas'
          }
        });

        // 3. Atualizar saldo da carteira
        await tx.wallet.update({
          where: { id: walletId },
          data: { saldoAtual: { increment: valorPagarAgora } }
        });
      });

      return res.json({
        message: quitou ? 'Parcela quitada com sucesso' : 'Pagamento parcial registrado',
        quitou,
        valorPago: novoTotalPago,
        saldoRestante: Math.max(0, valorParcelaOriginal - novoTotalPago),
      });
    } catch (error) {
      console.error('Erro em payReceivable:', error);
      return res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  static async renegotiateReceivable(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const userId = req.user?.id as string;
      if (!storeId || !userId) return res.status(401).json({ message: 'Não autorizado' });

      const id = req.params.id as string;
      const { novaDataVencimento, novoValor, novasParcelas } = req.body;

      if (!novaDataVencimento || !novoValor) {
        return res.status(400).json({ message: 'novaDataVencimento e novoValor são obrigatórios' });
      }

      const receivable = await prisma.accountReceivable.findUnique({
        where: { id },
        include: {
          sale: true,
          payments: {
            where: { tipo: 'ENTRADA', status: 'ATIVA' },
            select: { valor: true }
          }
        }
      });

      if (!receivable || receivable.storeId !== storeId) {
        return res.status(404).json({ message: 'Parcela não encontrada' });
      }

      const totalPago = receivable.payments.reduce((s, p) => s + Number(p.valor), 0);
      const saldoRestante = Number(receivable.valorParcela) - totalPago;
      if (saldoRestante <= 0) {
        return res.status(400).json({ message: 'Esta parcela já está totalmente paga' });
      }

      const novoValorNumerico = Number(novoValor);
      if (novoValorNumerico <= 0) {
        return res.status(400).json({ message: 'novoValor deve ser positivo' });
      }
      if (novoValorNumerico > saldoRestante) {
        return res.status(400).json({
          message: `novoValor não pode exceder o saldo devedor de R$ ${saldoRestante.toFixed(2)} (já pago: R$ ${totalPago.toFixed(2)})`
        });
      }

      const numParcelas = Number(novasParcelas) || 1;
      const valorParcela = Number(novoValor) / numParcelas;

      const result = await prisma.$transaction(async (tx) => {
        // Cancel current receivable
        await tx.accountReceivable.update({
          where: { id },
          data: { status: 'CANCELADA' },
        });

        // Create new receivables
        const novas: any[] = [];
        for (let i = 1; i <= numParcelas; i++) {
          const vencimento = new Date(novaDataVencimento);
          vencimento.setDate(vencimento.getDate() + (i - 1) * 30);

          const nova = await tx.accountReceivable.create({
            data: {
              storeId,
              saleId: receivable.saleId,
              customerId: receivable.customerId,
              dataVencimento: vencimento,
              numeroParcela: i,
              totalParcelas: numParcelas,
              valorParcela,
              formaPagamentoEsperada: receivable.formaPagamentoEsperada,
              status: 'PENDENTE',
            },
          });
          novas.push(nova);
        }

        return novas;
      });

      await auditLog({
        storeId,
        userId,
        acao: 'RENEGOTIATE',
        tabelaAfetada: 'accounts_receivable',
        dadosAntigos: { id: receivable.id, valor: Number(receivable.valorParcela), status: receivable.status },
        dadosNovos: { novaDataVencimento, novoValor, numParcelas },
      });

      return res.json({ message: 'Parcelas renegociadas com sucesso', receivables: result });
    } catch (error) {
      console.error('Erro em renegotiateReceivable:', error);
      return res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // 4. CONTAS A PAGAR
  static async getPayables(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: 'Não autorizado' });

      const payables = await prisma.accountPayable.findMany({
        where: { storeId },
        orderBy: { dataVencimento: 'asc' },
        include: { supplier: { select: { id: true, nome: true } } }
      });

      return res.json(payables);
    } catch (error) {
      console.error('Erro em getPayables:', error);
      return res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  static async createPayable(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: 'Não autorizado' });

      const { descricao, categoria, fornecedor, supplierId, dataVencimento, valor, isParcelado, numeroParcelas, frequencia, isFirstPaid } = req.body;

      if (!descricao || !dataVencimento || !valor) {
        return res.status(400).json({ message: 'Campos obrigatórios: descricao, dataVencimento, valor' });
      }

      const valorNum = Number(valor);

      if (isParcelado && numeroParcelas && Number(numeroParcelas) > 1) {
        const total = Number(numeroParcelas);
        const valorParcela = valorNum / total;
        const vencBase = new Date(dataVencimento);
        const diasOffset = frequencia === 'SEMANAL' ? 7 : frequencia === 'QUINZENAL' ? 15 : 30;
        const payables = [];

        for (let i = 0; i < total; i++) {
          const venc = new Date(vencBase);
          venc.setDate(venc.getDate() + (i + 1) * diasOffset);
          const isPago = isFirstPaid && i === 0;
          payables.push({
            storeId,
            descricao: `${descricao} (${i + 1}/${total})`,
            categoria,
            fornecedor,
            supplierId: supplierId || null,
            dataVencimento: venc,
            valor: Math.round(valorParcela * 100) / 100,
            status: isPago ? 'PAGO' as const : 'PENDENTE' as const,
            numeroParcela: i + 1,
            totalParcelas: total,
          });
        }

        await prisma.accountPayable.createMany({ data: payables });

        if (isFirstPaid) {
          const wallet = await prisma.wallet.findFirst({ where: { storeId } });
          await prisma.financialTransaction.create({
            data: {
              storeId,
              tipo: 'SAIDA',
              valor: Math.round(valorParcela * 100) / 100,
              descricao: `${descricao} (1/${total})`,
              categoria: categoria || 'PAGAMENTO_FORNECEDOR',
              fornecedor,
              walletId: wallet?.id || '',
              dataTransacao: new Date(),
            }
          });
        }

        return res.status(201).json({ message: `${total} parcelas criadas com sucesso!` });
      }

      const payable = await prisma.accountPayable.create({
        data: {
          storeId,
          descricao,
          categoria,
          fornecedor,
          supplierId: supplierId || null,
          dataVencimento: new Date(dataVencimento),
          valor: valorNum,
          numeroParcela: 1,
          totalParcelas: 1,
        }
      });

      return res.status(201).json(payable);
    } catch (error) {
      console.error('Erro em createPayable:', error);
      return res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  static async updatePayable(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: 'Não autorizado' });

      const id = req.params.id as string;
      const { descricao, categoria, fornecedor, supplierId, dataVencimento, valor } = req.body;

      const payable = await prisma.accountPayable.findUnique({ where: { id } });
      if (!payable || payable.storeId !== storeId) {
        return res.status(404).json({ message: 'Conta a pagar não encontrada' });
      }

      const updated = await prisma.accountPayable.update({
        where: { id },
        data: {
          descricao: descricao !== undefined ? descricao : undefined,
          categoria: categoria !== undefined ? categoria : undefined,
          fornecedor: fornecedor !== undefined ? fornecedor : undefined,
          supplierId: supplierId !== undefined ? (supplierId || null) : undefined,
          dataVencimento: dataVencimento !== undefined ? new Date(dataVencimento) : undefined,
          valor: valor !== undefined ? Number(valor) : undefined,
        },
      });

      return res.json(updated);
    } catch (error) {
      console.error('Erro em updatePayable:', error);
      return res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  static async payPayable(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: 'Não autorizado' });

      const id = req.params.id as string;
      const { walletId } = req.body;

      if (!walletId) {
        return res.status(400).json({ message: 'Selecione uma carteira para realizar o pagamento.' });
      }

      const payable = await prisma.accountPayable.findUnique({ where: { id } });
      if (!payable || payable.storeId !== storeId) {
        return res.status(404).json({ message: 'Conta a pagar não encontrada' });
      }

      if (payable.status === 'PAGO') {
        return res.status(400).json({ message: 'Esta conta já está paga' });
      }

      await prisma.$transaction(async (tx) => {
        // Cria a transação financeira de saída
        await tx.financialTransaction.create({
          data: {
            storeId,
            walletId,
            tipo: 'SAIDA',
            valor: Number(payable.valor),
            descricao: `Pagamento: ${payable.descricao}`,
            categoria: payable.categoria || 'PAGAMENTO_FORNECEDOR',
            dataTransacao: new Date(),
            supplierId: payable.supplierId || undefined,
          }
        });

        await tx.accountPayable.update({
          where: { id },
          data: { status: 'PAGO' }
        });

        await tx.wallet.update({
          where: { id: walletId },
          data: { saldoAtual: { decrement: Number(payable.valor) } }
        });
      });

      return res.json({ message: 'Pagamento registrado com sucesso' });
    } catch (error) {
      console.error('Erro em payPayable:', error);
      return res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }
  // 6. BULK ACTIONS
  static async bulkAction(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const userId = req.user?.id as string;
      if (!storeId || !userId) return res.status(401).json({ message: 'Não autorizado' });

      const { entityType, action, ids, walletId } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'IDs não fornecidos' });
      }

      await prisma.$transaction(async (tx) => {
        if (action === 'DELETE') {
          const processedSaleIds = new Set<string>();

          if (entityType === 'TRANSACTION') {
            const txs = await tx.financialTransaction.findMany({
              where: { id: { in: ids }, storeId },
            });
            for (const t of txs) {
              if (t.tipo === 'ENTRADA') {
                await tx.wallet.update({ where: { id: t.walletId }, data: { saldoAtual: { decrement: Number(t.valor) } } });
              } else if (t.tipo === 'SAIDA') {
                await tx.wallet.update({ where: { id: t.walletId }, data: { saldoAtual: { increment: Number(t.valor) } } });
              }
              if (t.saleId && !processedSaleIds.has(t.saleId)) {
                processedSaleIds.add(t.saleId);
                const sale = await tx.sale.findUnique({
                  where: { id: t.saleId },
                  include: { saleItems: true },
                });
                if (sale) {
                  await deleteSaleTree(tx, sale, storeId, userId);
                }
              }
            }
            await tx.financialTransaction.deleteMany({ where: { id: { in: ids }, storeId } });
          } else if (entityType === 'RECEIVABLE') {
            const recs = await tx.accountReceivable.findMany({
              where: { id: { in: ids }, storeId },
              include: { payments: { select: { id: true, walletId: true, tipo: true, valor: true } } },
            });
            for (const rec of recs) {
              if (rec.saleId && !processedSaleIds.has(rec.saleId)) {
                processedSaleIds.add(rec.saleId);
                const sale = await tx.sale.findUnique({
                  where: { id: rec.saleId },
                  include: { saleItems: true },
                });
                if (sale) {
                  await deleteSaleTree(tx, sale, storeId, userId);
                }
              }
              if (!rec.saleId) {
                for (const payment of rec.payments) {
                  if (payment.tipo === 'ENTRADA') {
                    await tx.wallet.update({ where: { id: payment.walletId }, data: { saldoAtual: { decrement: Number(payment.valor) } } });
                  } else if (payment.tipo === 'SAIDA') {
                    await tx.wallet.update({ where: { id: payment.walletId }, data: { saldoAtual: { increment: Number(payment.valor) } } });
                  }
                  await tx.financialTransaction.delete({ where: { id: payment.id } });
                }
              }
            }
            await tx.accountReceivable.deleteMany({ where: { id: { in: ids }, storeId } });
          } else if (entityType === 'PAYABLE') {
            await tx.accountPayable.deleteMany({ where: { id: { in: ids }, storeId } });
          }
        } else if (action === 'MARK_PAID') {
          if (!walletId) throw new Error('walletId é obrigatório para marcar como pago');
          
          if (entityType === 'RECEIVABLE') {
            const recs = await tx.accountReceivable.findMany({
              where: { id: { in: ids }, storeId, status: { not: 'CANCELADA' } },
              include: {
                payments: { where: { tipo: 'ENTRADA', status: 'ATIVA' }, select: { valor: true } }
              }
            });
            const idsQuitados: string[] = [];
            for (const r of recs) {
              const totalPago = r.payments.reduce((s, p) => s + Number(p.valor), 0);
              const saldoRestante = Number(r.valorParcela) - totalPago;
              if (saldoRestante <= 0) continue;
              await tx.financialTransaction.create({
                data: {
                  storeId, walletId, receivableId: r.id, saleId: r.saleId,
                  tipo: 'ENTRADA', valor: saldoRestante,
                  descricao: `Recebimento de Fiado: Parcela ${r.numeroParcela}/${r.totalParcelas}`,
                  categoria: 'Vendas'
                }
              });
              await tx.wallet.update({ where: { id: walletId }, data: { saldoAtual: { increment: saldoRestante } } });
              idsQuitados.push(r.id);
            }
            if (idsQuitados.length > 0) {
              await tx.accountReceivable.updateMany({
                where: { id: { in: idsQuitados }, storeId, status: { not: 'CANCELADA' } },
                data: { status: 'PAGO_PARCIAL' }
              });
            }
          } else if (entityType === 'PAYABLE') {
            const pays = await tx.accountPayable.findMany({ where: { id: { in: ids }, storeId, status: 'PENDENTE' } });
            for (const p of pays) {
              await tx.financialTransaction.create({
                data: {
                  storeId, walletId,
                  tipo: 'SAIDA',
                  valor: Number(p.valor),
                  descricao: `Pagamento em massa: ${p.descricao}`,
                  categoria: p.categoria || 'PAGAMENTO_FORNECEDOR',
                  dataTransacao: new Date(),
                  supplierId: p.supplierId || undefined,
                }
              });
              await tx.wallet.update({ where: { id: walletId }, data: { saldoAtual: { decrement: Number(p.valor) } } });
            }
            await tx.accountPayable.updateMany({
              where: { id: { in: ids }, storeId, status: 'PENDENTE' },
              data: { status: 'PAGO' }
            });
          }
        }
      });

      return res.json({ message: 'Ação em massa executada com sucesso' });
    } catch (error: any) {
      console.error('Erro no bulkAction:', error?.message || error);
      return res.status(500).json({ error: error?.message || 'Erro interno do servidor' });
    }
  }
}
