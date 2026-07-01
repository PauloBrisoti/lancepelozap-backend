import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { auditLog } from '../lib/audit';

export class FinanceController {
  
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

      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      const queryStart = req.query.startDate as string;
      const queryEnd = req.query.endDate as string;
      
      let startOfPeriod: Date;
      let endOfPeriod: Date;
      
      if (queryStart && queryEnd) {
        startOfPeriod = new Date(`${queryStart}T00:00:00.000Z`);
        const d = new Date(String(queryEnd));
        d.setDate(d.getDate() + 1);
        endOfPeriod = new Date(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T23:59:59.999Z`);
      } else {
        startOfPeriod = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1, 0, 0, 0, 0));
        endOfPeriod = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 0, 23, 59, 59, 999));
      }

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
          }
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
        const startDate = new Date(`${queryStart}T00:00:00.000Z`);
        const d = new Date(String(queryEnd));
        d.setDate(d.getDate() + 1);
        const endDate = new Date(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T23:59:59.999Z`);
        whereClause.dataTransacao = { gte: startDate, lte: endDate };
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

      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      const receivables = await prisma.accountReceivable.findMany({
        where: { storeId, status: { not: 'CANCELADA' } },
        orderBy: { dataVencimento: 'asc' },
        include: {
          customer: { select: { nomeCompleto: true } },
          sale: { select: { id: true } },
          payments: {
            where: { tipo: 'ENTRADA', status: 'ATIVA' },
            select: { valor: true }
          }
        }
      });

      const enriched = receivables.map(r => {
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

      const { descricao, categoria, fornecedor, supplierId, dataVencimento, valor } = req.body;

      if (!descricao || !dataVencimento || !valor) {
        return res.status(400).json({ message: 'Campos obrigatórios: descricao, dataVencimento, valor' });
      }

      const payable = await prisma.accountPayable.create({
        data: {
          storeId,
          descricao,
          categoria,
          fornecedor,
          supplierId: supplierId || null,
          dataVencimento: new Date(dataVencimento),
          valor: Number(valor)
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
        await tx.accountPayable.update({
          where: { id },
          data: { status: 'PAGO' }
        });

        await tx.financialTransaction.create({
          data: {
            storeId,
            walletId,
            tipo: 'SAIDA',
            valor: Number(payable.valor),
            descricao: `Pagamento de Conta: ${payable.descricao}`,
            categoria: payable.categoria || 'Despesas'
          }
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
      if (!storeId) return res.status(401).json({ message: 'Não autorizado' });

      const { entityType, action, ids, walletId } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'IDs não fornecidos' });
      }

      await prisma.$transaction(async (tx) => {
        if (action === 'DELETE') {
          if (entityType === 'TRANSACTION') {
            const txs = await tx.financialTransaction.findMany({ where: { id: { in: ids }, storeId } });
            // Estorno do saldo
            for (const t of txs) {
              if (t.tipo === 'ENTRADA') {
                await tx.wallet.update({ where: { id: t.walletId }, data: { saldoAtual: { decrement: Number(t.valor) } } });
              } else if (t.tipo === 'SAIDA') {
                await tx.wallet.update({ where: { id: t.walletId }, data: { saldoAtual: { increment: Number(t.valor) } } });
              }
            }
            await tx.financialTransaction.deleteMany({ where: { id: { in: ids }, storeId } });
          } else if (entityType === 'RECEIVABLE') {
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
            }
            await tx.accountReceivable.updateMany({
              where: { id: { in: ids }, storeId, status: { not: 'CANCELADA' } },
              data: { status: 'PAGO_PARCIAL' }
            });
          } else if (entityType === 'PAYABLE') {
            const pays = await tx.accountPayable.findMany({ where: { id: { in: ids }, storeId, status: 'PENDENTE' } });
            for (const p of pays) {
              await tx.financialTransaction.create({
                data: {
                  storeId, walletId, tipo: 'SAIDA', valor: Number(p.valor),
                  descricao: `Pagamento de Conta: ${p.descricao}`,
                  categoria: p.categoria || 'Despesas'
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
    } catch (error) {
      console.error('Erro no bulkAction:', error);
      return res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }
}
