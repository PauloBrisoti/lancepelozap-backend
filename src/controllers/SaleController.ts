import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { StockMovementService } from "../services/StockMovementService";
import { WhatsAppService } from "../services/WhatsAppService";
import { FeeCalculationService } from "../services/FeeCalculationService";

export class SaleController {
  async list(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId || (req.user as any)?.tenant_id;
      if (!storeId) {
        return res.status(401).json({ message: "Tenant ID não encontrado no token" });
      }

      const { startDate, endDate } = req.query;
      const whereClause: any = { storeId };

      if (startDate && endDate) {
        const start = new Date(`${startDate}T00:00:00.000Z`);
        // Add 1 day to end to include sales in UTC that fall after local midnight
        const endStr = String(endDate);
        const endPlus1 = new Date(endStr);
        endPlus1.setDate(endPlus1.getDate() + 1);
        const endStr2 = endPlus1.toISOString().split('T')[0];
        const end = new Date(`${endStr2}T23:59:59.999Z`);

        whereClause.dataVenda = {
          gte: start,
          lte: end
        };
      }

      whereClause.status = { not: 'CANCELADA' };

      const sales = await prisma.sale.findMany({
        where: whereClause,
        orderBy: { dataVenda: 'desc' },
        include: {
          customer: { select: { nomeCompleto: true } },
          user: { select: { nome: true } },
          receivables: {
            where: { status: { not: 'CANCELADA' } },
            include: {
              payments: {
                where: { tipo: 'ENTRADA', status: 'ATIVA' },
                select: { valor: true }
              }
            }
          },
          saleItems: {
            include: {
              product: { select: { nome: true, precoCusto: true } }
            }
          }
        }
      });

      const salesWithMargins = sales.map(s => {
        const valorBruto = Number(s.valorTotalBruto);
        const valorDesconto = Number(s.valorDesconto);
        const valorTaxas = Number(s.valorTaxasGateway);
        const cmvTotal = Number(s.cmvTotal);
        const valorLiquido = Number(s.valorTotalLiquido);

        const margemBruta = valorBruto > 0 ? ((valorBruto - cmvTotal) / valorBruto) * 100 : 0;
        const margemLiquida = valorLiquido > 0 ? ((valorLiquido - cmvTotal) / valorLiquido) * 100 : 0;

        const enrichedReceivables = (s.receivables || []).map((r: any) => {
          const totalPago = r.payments?.reduce((s: number, p: any) => s + Number(p.valor), 0) || 0;
          const valorOriginal = Number(r.valorParcela);
          const saldoRestante = Math.max(0, valorOriginal - totalPago);
          let statusExibicao: string;
          if (saldoRestante === 0) {
            statusExibicao = 'PAGO';
          } else if (totalPago > 0) {
            statusExibicao = 'PAGO_PARCIAL';
          } else {
            statusExibicao = r.status;
          }
          return {
            ...r,
            valorJaPago: totalPago,
            saldoRestante,
            statusExibicao,
            status: statusExibicao,
          };
        });

        return {
          ...s,
          receivables: enrichedReceivables,
          valorTaxasGateway: valorTaxas,
          cmvTotal,
          margemBruta: Math.round(margemBruta * 100) / 100,
          margemLiquida: Math.round(margemLiquida * 100) / 100,
          margemBrutaValor: valorBruto - cmvTotal,
          margemLiquidaValor: valorLiquido - cmvTotal,
        };
      });

      res.json(salesWithMargins);
    } catch (error: any) {
      console.error("Erro ao listar vendas:", error);
      res.status(500).json({ message: "Erro interno do servidor", detail: error.message });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId || (req.user as any)?.tenant_id;
      const userId = req.user?.id;
      if (!storeId || !userId) {
        return res.status(401).json({ message: "Usuário ou Tenant não identificado" });
      }

      const { 
        customerId, 
        cashRegisterId: reqCashRegisterId,
        itens, 
        formaPagamento, 
        valorDesconto = 0, 
        valorSinal = 0, 
        numeroParcelas = 1 
      } = req.body;

      if (!itens || itens.length === 0) {
        return res.status(400).json({ message: "A venda deve conter pelo menos um item" });
      }

      if (formaPagamento === 'CREDIARIO' && !customerId) {
        return res.status(400).json({ message: "Cliente é obrigatório para vendas no Crediário" });
      }

      // Resolve cash register
      let cashRegisterId = reqCashRegisterId;
      if (!cashRegisterId) {
        const openRegister = await prisma.cashRegister.findFirst({
          where: { storeId, status: 'ABERTO' }
        });
        if (openRegister) cashRegisterId = openRegister.id;
      }

      // Load commission rules for this store + seller
      const commissionRules = await prisma.commissionRule.findMany({
        where: { storeId, userId, ativo: true },
      });
      const commissionByCategory = new Map<string | '__default__', number>();
      for (const rule of commissionRules) {
        const key = rule.categoryId || '__default__';
        commissionByCategory.set(key, Number(rule.percentual));
      }

      // 1. Transaction Start
      const result = await prisma.$transaction(async (tx) => {
        let valorTotalBruto = 0;
        let cmvTotal = 0;
        const saleItemsData: any[] = [];
        const stockMovementsData: any[] = [];

        // 2. Fetch products and calculate values
        for (const item of itens) {
          const product = await tx.product.findFirst({
            where: { id: item.productId, storeId }
          });

          if (!product) {
            throw new Error(`Produto não encontrado: ${item.productId}`);
          }

          const qte = Number(item.quantidade);
          const preco = Number(item.precoUnitarioVendido);
          const subtotal = qte * preco;
          const qtdAnterior = Number(product.qtdEstoqueAtual);
          
          valorTotalBruto += subtotal;

          // CMV: usa custo real do produto, ou fallback de 70% do preço de venda
          const custoUnitario = Number(product.precoCusto || 0);
          const custoFinal = custoUnitario > 0 ? custoUnitario : preco * 0.7;
          cmvTotal += custoFinal * qte;

          // Calculate commission for this item
          const catKey = product.categoryId || '__default__';
          const pct = commissionByCategory.get(catKey) ?? commissionByCategory.get('__default__') ?? 0;
          const comissaoItem = subtotal * (pct / 100);

          saleItemsData.push({
            productId: product.id,
            quantidade: qte,
            precoUnitarioVendido: preco,
            custoUnitarioHistorico: custoFinal,
            comissaoVendedorValor: comissaoItem,
          });

          // 3. Update stock (Permitindo negativar se for o caso)
          await tx.product.update({
            where: { id: product.id },
            data: {
              qtdEstoqueAtual: {
                decrement: qte
              }
            }
          });

          stockMovementsData.push({
            storeId,
            productId: product.id,
            userId,
            tipo: 'SAIDA',
            quantidade: qte,
            saldoAnterior: qtdAnterior,
            saldoPosterior: qtdAnterior - qte,
            observacao: `Venda`,
          });
        }

        // 3.5 Calcular Taxas de Gateway (cartão, pix, etc.)
        // Usa o FeeCalculationService para validar a configuração no banco
        // e calcular o valor das taxas de forma centralizada
        const feeResult = await FeeCalculationService.execute({
          storeId,
          formaPagamento,
          parcela: Number(numeroParcelas) || 1,
          valorTotalBruto,
        });

        const { valorTaxasGateway } = feeResult;
        const valorTotalLiquido = FeeCalculationService.calcularValorLiquido(
          valorTotalBruto,
          Number(valorDesconto),
          valorTaxasGateway
        );

        // 4. Create Sale
        const sale = await tx.sale.create({
          data: {
            storeId,
            userId,
            customerId: customerId || null,
            cashRegisterId: cashRegisterId || null,
            valorTotalBruto,
            valorDesconto: Number(valorDesconto),
            valorTaxasGateway,
            valorTotalLiquido,
            cmvTotal,
            formaPagamento,
            valorSinal: Number(valorSinal),
            numeroParcelas: Number(numeroParcelas),
            status: 'FINALIZADA',
            saleItems: {
              create: saleItemsData
            }
          }
        });

        // 5. Generate Receivables for Crediario
        if (formaPagamento === 'CREDIARIO' && customerId) {
          const valorRestante = valorTotalLiquido - Number(valorSinal);
          if (valorRestante > 0) {
            const numParcelas = Number(numeroParcelas) || 1;
            const parcelaBase = Math.round((valorRestante / numParcelas) * 100) / 100;
            const primeiraParcela = valorRestante - (parcelaBase * (numParcelas - 1));

            for (let i = 1; i <= numParcelas; i++) {
              const dataVencimento = new Date();
              dataVencimento.setDate(dataVencimento.getDate() + (i * 30));

              const valorParcela = i === 1 ? primeiraParcela : parcelaBase;

              await tx.accountReceivable.create({
                data: {
                  storeId,
                  saleId: sale.id,
                  customerId,
                  numeroParcela: i,
                  totalParcelas: numParcelas,
                  valorParcela,
                  dataVencimento,
                  formaPagamentoEsperada: 'PIX',
                  status: 'PENDENTE'
                }
              });
            }
          }
        }

        // 6. Sincronizar com o Painel Financeiro
        const valorPagoAgora = formaPagamento === 'CREDIARIO' ? Number(valorSinal) : valorTotalLiquido;
        
        if (valorPagoAgora > 0) {
          // Busca a carteira principal (ou cria se não existir)
          let wallet = await tx.wallet.findFirst({ where: { storeId } });
          if (!wallet) {
            wallet = await tx.wallet.create({
              data: { storeId, nome: 'Caixa Interno', tipo: 'EMPRESA', saldoAtual: 0 }
            });
          }

          // Cria a transação
          let customerName = 'Balcão';
          if (customerId) {
            const customer = await tx.customer.findUnique({ where: { id: customerId } });
            if (customer) customerName = customer.nomeCompleto;
          }

          await tx.financialTransaction.create({
            data: {
              storeId,
              walletId: wallet.id,
              saleId: sale.id,
              tipo: 'ENTRADA',
              valor: valorPagoAgora,
              descricao: `Venda #${sale.id.substring(0, 8)} - ${customerName}`,
              categoria: 'VENDAS',
              dataTransacao: new Date()
            }
          });

          // Atualiza saldo da carteira
          await tx.wallet.update({
            where: { id: wallet.id },
            data: { saldoAtual: { increment: valorPagoAgora } }
          });
        }

        // Create stock movements linked to the sale
        for (const sm of stockMovementsData) {
          await tx.stockMovement.create({
            data: { ...sm, referenciaId: sale.id },
          });
        }

        return sale;
      });

      res.status(201).json(result);

      // Non-blocking WhatsApp notification
      if (customerId) {
        (async () => {
          try {
            const setting = await prisma.systemSetting.findUnique({ where: { chave: 'GATEWAYS' } });
            if (!setting) return;
            const gateways = setting.valor as any;
            if (!gateways.whatsappApiUrl || !gateways.whatsappApiToken) return;

            const customer = await prisma.customer.findUnique({
              where: { id: customerId },
              select: { nomeCompleto: true, telefoneWhatsapp: true },
            });
            if (!customer?.telefoneWhatsapp) return;

            const store = await prisma.store.findUnique({
              where: { id: storeId },
              select: { nomeFantasia: true, chavePix: true },
            });

            const svc = new WhatsAppService(gateways.whatsappApiUrl, gateways.whatsappApiToken, gateways.whatsappInstance || 'default');
            const itemList = itens.map((i: any) => `  • ${i.quantidade}x ${i.nome || 'Produto'} — R$ ${Number(i.precoUnitarioVendido * i.quantidade).toFixed(2)}`).join('\n');

            const methodLabels: Record<string, string> = {
              PIX: 'Pix', DINHEIRO: 'Dinheiro', CARTAO_CREDITO: 'Cartão de Crédito',
              CARTAO_DEBITO: 'Cartão de Débito', CREDIARIO: 'Crediário',
            };

            const message = [
              `🧾 *${store?.nomeFantasia || 'Comprovante de Venda'}*`,
              '',
              `Cliente: ${customer.nomeCompleto}`,
              '',
              '*Itens:*',
              itemList,
              '',
              `💰 *Total: R$ ${Number(result.valorTotalLiquido).toFixed(2)}*`,
              `💳 Pagamento: ${methodLabels[formaPagamento] || formaPagamento}`,
              store?.chavePix ? `📱 Pix: ${store.chavePix}` : '',
              '',
              'Obrigado pela preferência! 🤝',
            ].filter(Boolean).join('\n');

            await svc.sendText(svc.formatPhone(customer.telefoneWhatsapp), message);
          } catch { /* silent */ }
        })();
      }
    } catch (error: any) {
      console.error("Erro ao criar venda:", error);
      res.status(400).json({ message: error.message || "Erro ao processar a venda" });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId || (req.user as any)?.tenant_id;
      if (!storeId) return res.status(401).json({ message: "Tenant ID não encontrado" });

      const id = req.params.id as string;
      const { customerId, formaPagamento, valorDesconto, valorSinal, numeroParcelas, observacoes } = req.body;

      const sale = await prisma.sale.findFirst({
        where: { id, storeId },
        include: { receivables: { where: { status: { not: 'CANCELADA' } } }, financialTransactions: true }
      });

      if (!sale) return res.status(404).json({ message: "Venda não encontrada" });
      if (sale.status === 'CANCELADA') return res.status(400).json({ message: "Venda cancelada não pode ser editada" });

      await prisma.$transaction(async (tx) => {
        const updateData: any = {};

        if (customerId !== undefined) updateData.customerId = customerId || null;
        if (formaPagamento !== undefined) updateData.formaPagamento = formaPagamento;
        if (numeroParcelas !== undefined) updateData.numeroParcelas = Number(numeroParcelas);

        // Recalcular taxas se formaPagamento ou numeroParcelas mudar
        const novoPagamento = formaPagamento ?? sale.formaPagamento;
        const novasParcelas = numeroParcelas !== undefined ? Number(numeroParcelas) : Number(sale.numeroParcelas);
        const novoDesconto = valorDesconto !== undefined ? Number(valorDesconto) : Number(sale.valorDesconto);

        const feeResult = await FeeCalculationService.execute({
          storeId,
          formaPagamento: novoPagamento,
          parcela: novasParcelas,
          valorTotalBruto: Number(sale.valorTotalBruto),
        });

        if (formaPagamento !== undefined || numeroParcelas !== undefined) {
          updateData.valorTaxasGateway = feeResult.valorTaxasGateway;
        }

        updateData.valorDesconto = novoDesconto;
        updateData.valorTotalLiquido = FeeCalculationService.calcularValorLiquido(
          Number(sale.valorTotalBruto),
          novoDesconto,
          feeResult.valorTaxasGateway
        );

        if (valorSinal !== undefined) updateData.valorSinal = Number(valorSinal);
        if (observacoes !== undefined) updateData.observacoes = observacoes;

        await tx.sale.update({ where: { id }, data: updateData });

        const updatedSale = await tx.sale.findUnique({ where: { id } });
        if (!updatedSale) return;

        // Recriar receivables se for crediario e houve mudança
        const pagamentoFinal = formaPagamento ?? sale.formaPagamento;
        const sinalFinal = valorSinal !== undefined ? Number(valorSinal) : Number(sale.valorSinal);
        const parcelasFinal = numeroParcelas !== undefined ? Number(numeroParcelas) : Number(sale.numeroParcelas);
        const liquidoFinal = Number(updatedSale.valorTotalLiquido);

        if (pagamentoFinal === 'CREDIARIO') {
          if (sale.receivables.length > 0) {
            // Reverter receivables pendentes existentes
            for (const rec of sale.receivables) {
              if (rec.status === 'PENDENTE' || rec.status === 'VENCIDO') {
                await tx.accountReceivable.update({ where: { id: rec.id }, data: { status: 'CANCELADA' } });
              }
            }
          }

          // Remover transação financeira anterior do sinal, se existir
          for (const ft of sale.financialTransactions) {
            if (ft.categoria === 'VENDAS') {
              await tx.wallet.update({ where: { id: ft.walletId }, data: { saldoAtual: { decrement: ft.valor } } });
              await tx.financialTransaction.delete({ where: { id: ft.id } });
            }
          }

          // Recriar receivables com novos valores
          const customerIdFinal = customerId ?? sale.customerId;
          if (customerIdFinal) {
            const valorRestante = liquidoFinal - sinalFinal;
            if (valorRestante > 0) {
              const parcelaBase = Math.round((valorRestante / parcelasFinal) * 100) / 100;
              const primeiraParcela = valorRestante - (parcelaBase * (parcelasFinal - 1));
              for (let i = 1; i <= parcelasFinal; i++) {
                const dataVencimento = new Date();
                dataVencimento.setDate(dataVencimento.getDate() + (i * 30));
                const valorParcela = i === 1 ? primeiraParcela : parcelaBase;
                await tx.accountReceivable.create({
                  data: {
                    storeId, saleId: id, customerId: customerIdFinal,
                    numeroParcela: i, totalParcelas: parcelasFinal,
                    valorParcela, dataVencimento,
                    formaPagamentoEsperada: 'PIX', status: 'PENDENTE',
                  }
                });
              }
            }

            // Recriar transação financeira do sinal
            if (sinalFinal > 0) {
              let wallet = await tx.wallet.findFirst({ where: { storeId } });
              if (!wallet) {
                wallet = await tx.wallet.create({ data: { storeId, nome: 'Caixa Interno', tipo: 'EMPRESA', saldoAtual: 0 } });
              }
              const customer = customerIdFinal ? await tx.customer.findUnique({ where: { id: customerIdFinal } }) : null;
              await tx.financialTransaction.create({
                data: {
                  storeId, walletId: wallet.id, saleId: id, tipo: 'ENTRADA',
                  valor: sinalFinal,
                  descricao: `Sinal (edição) Venda #${id.substring(0, 8)} - ${customer?.nomeCompleto || 'Balcão'}`,
                  categoria: 'VENDAS', dataTransacao: new Date()
                }
              });
              await tx.wallet.update({ where: { id: wallet.id }, data: { saldoAtual: { increment: sinalFinal } } });
            }
          }
        } else {
          // Se mudou de CREDIARIO para outra forma, cancelar receivables e ajustar financeiro
          if (sale.receivables.length > 0) {
            for (const rec of sale.receivables) {
              await tx.accountReceivable.update({ where: { id: rec.id }, data: { status: 'CANCELADA' } });
            }
            // Remover transação financeira do sinal anterior (se houver)
            for (const ft of sale.financialTransactions) {
              if (ft.categoria === 'VENDAS' && ft.tipo === 'ENTRADA') {
                await tx.wallet.update({ where: { id: ft.walletId }, data: { saldoAtual: { decrement: ft.valor } } });
                await tx.financialTransaction.delete({ where: { id: ft.id } });
              }
            }
            // Criar nova transação com o valor total
            if (liquidoFinal > 0) {
              let wallet = await tx.wallet.findFirst({ where: { storeId } });
              if (!wallet) {
                wallet = await tx.wallet.create({ data: { storeId, nome: 'Caixa Interno', tipo: 'EMPRESA', saldoAtual: 0 } });
              }
              const customerIdFinal = customerId ?? sale.customerId;
              const customer = customerIdFinal ? await tx.customer.findUnique({ where: { id: customerIdFinal } }) : null;
              await tx.financialTransaction.create({
                data: {
                  storeId, walletId: wallet.id, saleId: id, tipo: 'ENTRADA',
                  valor: liquidoFinal,
                  descricao: `Venda #${id.substring(0, 8)} (editada) - ${customer?.nomeCompleto || 'Balcão'}`,
                  categoria: 'VENDAS', dataTransacao: new Date()
                }
              });
              await tx.wallet.update({ where: { id: wallet.id }, data: { saldoAtual: { increment: liquidoFinal } } });
            }
          }
        }
      });

      const updated = await prisma.sale.findUnique({
        where: { id },
        include: { customer: true, saleItems: { include: { product: { select: { nome: true } } } }, receivables: true }
      });

      res.json({ message: "Venda atualizada com sucesso", sale: updated });
    } catch (error: any) {
      console.error("Erro ao atualizar venda:", error);
      res.status(500).json({ message: error.message || "Erro ao atualizar venda" });
    }
  }

  async cancel(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId || (req.user as any)?.tenant_id;
      if (!storeId) {
        return res.status(401).json({ message: "Tenant ID não encontrado no token" });
      }

      const { id } = req.params;

      const sale = await prisma.sale.findFirst({
        where: { id: String(id), storeId },
        include: {
          saleItems: true,
          receivables: true,
          financialTransactions: true
        }
      });

      if (!sale) {
        return res.status(404).json({ message: "Venda não encontrada" });
      }

      if (sale.status === 'CANCELADA') {
        return res.status(400).json({ message: "Venda já está cancelada" });
      }

      const result = await prisma.$transaction(async (tx) => {
        // 1. Reverter estoque
        for (const item of sale.saleItems) {
          const product = await tx.product.findUnique({
            where: { id: item.productId }
          });
          const qtdAnterior = Number(product?.qtdEstoqueAtual || 0);

          await tx.product.update({
            where: { id: item.productId },
            data: {
              qtdEstoqueAtual: {
                increment: item.quantidade
              }
            }
          });

          await tx.stockMovement.create({
            data: {
              storeId,
              productId: item.productId,
              userId: req.user!.id,
              tipo: 'ENTRADA',
              quantidade: Number(item.quantidade),
              saldoAnterior: qtdAnterior,
              saldoPosterior: qtdAnterior + Number(item.quantidade),
              referenciaId: sale.id,
              observacao: `Estorno de cancelamento`,
            },
          });
        }

        // 2. Reverter financeiro com estorno (audit trail)
        for (const transaction of sale.financialTransactions) {
          if (transaction.tipo === 'ENTRADA') {
            // 2a. Marca a transação original como estornada
            await tx.financialTransaction.update({
              where: { id: transaction.id },
              data: { status: 'ESTORNADA' }
            });
            // 2b. Cria transação de reversão (SAIDA = dinheiro saindo)
            await tx.financialTransaction.create({
              data: {
                storeId,
                walletId: transaction.walletId,
                saleId: sale.id,
                tipo: 'SAIDA',
                status: 'ATIVA',
                valor: transaction.valor,
                descricao: `Estorno cancelamento #${sale.id.substring(0, 8)}`,
                categoria: 'CANCELAMENTO',
                dataTransacao: new Date()
              }
            });
            // 2c. Decrementa saldo da carteira
            await tx.wallet.update({
              where: { id: transaction.walletId },
              data: { saldoAtual: { decrement: transaction.valor } }
            });
          }
        }

        // 3. Cancelar todas as contas a receber (qualquer status)
        for (const receivable of sale.receivables) {
          await tx.accountReceivable.update({
            where: { id: receivable.id },
            data: { status: 'CANCELADA' }
          });
        }

        // 4. Mudar status da venda para CANCELADA
        const updatedSale = await tx.sale.update({
          where: { id: sale.id },
          data: { status: 'CANCELADA' }
        });

        return updatedSale;
      });

      res.json({ message: "Venda cancelada com sucesso", sale: result });
    } catch (error: any) {
      console.error("Erro ao cancelar venda:", error);
      res.status(500).json({ message: "Erro interno do servidor", detail: error.message });
    }
  }
}
