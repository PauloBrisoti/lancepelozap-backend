import { Request, Response } from "express";
import { logger } from '../lib/logger';
import { asyncHandler } from "../lib/asyncHandler";
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { StockMovementService } from "../services/StockMovementService";
import { WhatsAppService } from "../services/WhatsAppService";
import { FeeCalculationService } from "../services/FeeCalculationService";
import { comparePassword } from "../utils/password";
import { buildDateRange, parseDate } from "../lib/dateUtils";

export class SaleController {
  summary = asyncHandler(async (req: Request, res: Response) => {
    const storeId = req.user?.storeId || (req.user as any)?.tenant_id;
    if (!storeId) {
      return res.status(401).json({ message: "Tenant ID não encontrado no token" });
    }

    const { startDate, endDate, prevStartDate, prevEndDate } = req.query;

    // VENDEDOR/CAIXA vê apenas as próprias vendas
    const requesterId = req.user?.id;
    const access = requesterId
      ? await prisma.storeUserAccess.findUnique({
          where: { storeId_userId: { storeId, userId: requesterId } },
          select: { role: true }
        })
      : null;
    const restricted = !!access && (access.role === 'VENDEDOR' || access.role === 'CAIXA');

    const summarize = async (s: string, e: string) => {
      const { firstDay, lastDay } = buildDateRange(s, e);
      const sales = await prisma.sale.findMany({
        where: {
          storeId,
          status: { not: 'CANCELADA' },
          dataVenda: { gte: firstDay, lte: lastDay },
          ...(restricted ? { userId: requesterId! } : {}),
        },
        select: {
          valorTotalLiquido: true,
          saleItems: { select: { quantidade: true } },
        },
      });
      const valor = sales.reduce((acc, x) => acc + Number(x.valorTotalLiquido), 0);
      const itens = sales.reduce((acc, x) => acc + x.saleItems.reduce((b, i) => b + Number(i.quantidade), 0), 0);
      return {
        total: sales.length,
        valor,
        ticketMedio: sales.length ? valor / sales.length : 0,
        itens,
      };
    };

    const current = await summarize(startDate as string, endDate as string);
    const previous = prevStartDate && prevEndDate
      ? await summarize(prevStartDate as string, prevEndDate as string)
      : null;

    res.json({ current, previous });
  }, "gerar resumo de vendas");

  async list(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId || (req.user as any)?.tenant_id;
      if (!storeId) {
        return res.status(401).json({ message: "Tenant ID não encontrado no token" });
      }

      const { startDate, endDate } = req.query;
      const whereClause: any = { storeId };

      // VENDEDOR/CAIXA vê apenas as próprias vendas
      const requesterId = req.user?.id;
      const access = requesterId
        ? await prisma.storeUserAccess.findUnique({
            where: { storeId_userId: { storeId, userId: requesterId } },
            select: { role: true }
          })
        : null;
      const restricted = !!access && (access.role === 'VENDEDOR' || access.role === 'CAIXA');
      if (restricted) whereClause.userId = requesterId;

      if (startDate && endDate) {
        const { firstDay, lastDay } = buildDateRange(startDate as string, endDate as string);
        whereClause.dataVenda = { gte: firstDay, lte: lastDay };
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

        // VENDEDOR/CAIXA não vê custo nem margens nas vendas
        const items = (s.saleItems || []).map((i: any) => ({
          ...i,
          product: i.product ? { ...i.product, precoCusto: restricted ? 0 : i.product.precoCusto } : null,
        }));

        return {
          ...s,
          saleItems: items,
          receivables: enrichedReceivables,
          valorTaxasGateway: valorTaxas,
          cmvTotal: restricted ? 0 : cmvTotal,
          margemBruta: restricted ? 0 : Math.round(margemBruta * 100) / 100,
          margemLiquida: restricted ? 0 : Math.round(margemLiquida * 100) / 100,
          margemBrutaValor: restricted ? 0 : valorBruto - cmvTotal,
          margemLiquidaValor: restricted ? 0 : valorLiquido - cmvTotal,
        };
      });

      res.json(salesWithMargins);
    } catch (error: any) {
      logger.error("Erro ao listar vendas:", error);
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
        valorAcrescimo = 0,
        valorSinal = 0, 
        numeroParcelas = 1,
        dataVenda,
        formaPagamentoEntrada,
        repasseTaxa = false,
      } = req.body;

      if (!itens || itens.length === 0) {
        return res.status(400).json({ message: "A venda deve conter pelo menos um item" });
      }

      if (formaPagamento === 'CREDIARIO' && !customerId) {
        return res.status(400).json({ message: "Cliente é obrigatório para vendas no Crediário" });
      }

      // OWNERSHIP: cliente informado precisa pertencer a ESTA loja
      if (customerId) {
        const ownedCustomer = await prisma.customer.findFirst({
          where: { id: customerId, storeId },
          select: { id: true },
        });
        if (!ownedCustomer) {
          return res.status(400).json({ message: "Cliente não encontrado nesta loja" });
        }
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

      // Load store config (cartaoImediato)
      const storeConfig = await prisma.store.findUnique({
        where: { id: storeId },
        select: { cartaoImediato: true }
      });
      const cartaoImediato = storeConfig?.cartaoImediato ?? true;

      // Resolve sale date: use client-provided or current timestamp
      const saleDate = parseDate(dataVenda) ?? new Date();

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
          const subtotal = Math.round(qte * preco * 100) / 100;
          const qtdAnterior = Number(product.qtdEstoqueAtual);
          
          valorTotalBruto += subtotal;

          // CMV: usa custo real do produto, ou fallback de 70% do preço de venda
          const custoUnitario = Number(product.precoCusto || 0);
          const custoFinal = custoUnitario > 0 ? custoUnitario : Math.round(preco * 0.7 * 100) / 100;
          cmvTotal += Math.round(custoFinal * qte * 100) / 100;

          // Calculate commission for this item (percentual definido pela regra)
          const catKey = product.categoryId || '__default__';
          const pct = commissionByCategory.get(catKey) ?? commissionByCategory.get('__default__') ?? 0;

          saleItemsData.push({
            productId: product.id,
            quantidade: qte,
            precoUnitarioVendido: preco,
            custoUnitarioHistorico: custoFinal,
            comissaoPercentual: pct,
            comissaoBaseBruta: subtotal,
            comissaoVendedorValor: 0, // recalculado abaixo, após conhecer desconto/taxas da venda
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
        const acrescimoDigitado = Number(valorAcrescimo);
        const valorBaseBruto = valorTotalBruto + acrescimoDigitado;

        const feeResult = await FeeCalculationService.execute({
          storeId,
          formaPagamento,
          parcela: Number(numeroParcelas) || 1,
          valorTotalBruto: valorBaseBruto,
        });

        const { valorTaxasGateway } = feeResult;

        // Cenário A (repasseTaxa=true): taxa é adicionada como acréscimo no total
        // Cenário B (repasseTaxa=false): taxa é descontada do líquido (comportamento legado)
        if (repasseTaxa) {
          valorTotalBruto = Math.round((valorBaseBruto + valorTaxasGateway) * 100) / 100;
        } else {
          valorTotalBruto = Math.round(valorBaseBruto * 100) / 100;
        }

        const valorTotalLiquido = FeeCalculationService.calcularValorLiquido(
          valorTotalBruto,
          Number(valorDesconto),
          valorTaxasGateway
        );

        // Comissão é calculada sobre o valor líquido da venda (após desconto e taxas),
        // proporcionalizado por item conforme seu peso no total bruto.
        for (const itemData of saleItemsData) {
          const baseLiquida = valorTotalBruto > 0
            ? (itemData.comissaoBaseBruta * valorTotalLiquido) / valorTotalBruto
            : 0;
          itemData.comissaoVendedorValor = Math.round((baseLiquida * itemData.comissaoPercentual / 100 + Number.EPSILON) * 100) / 100;
          delete itemData.comissaoBaseBruta;
          delete itemData.comissaoPercentual;
        }

        // 4. Create Sale
        const sale = await tx.sale.create({
          data: {
            storeId,
            userId,
            customerId: customerId || null,
            cashRegisterId: cashRegisterId || null,
            dataVenda: saleDate,
            valorTotalBruto: Math.round(valorTotalBruto * 100) / 100,
            valorDesconto: Number(valorDesconto),
            valorTaxasGateway: Math.round(valorTaxasGateway * 100) / 100,
            valorTotalLiquido: Math.round(valorTotalLiquido * 100) / 100,
            cmvTotal: Math.round(cmvTotal * 100) / 100,
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
          const valorRestante = Math.round((valorTotalLiquido - Number(valorSinal)) * 100) / 100;
          logger.debug('[DEBUG crediario] PASSOU NO CHECK, valorRestante:', { arg0: valorRestante });
          if (valorRestante > 0) {
            const numParcelas = Number(numeroParcelas) || 1;
            const parcelaBase = Math.round((valorRestante / numParcelas) * 100) / 100;
            const primeiraParcela = valorRestante - (parcelaBase * (numParcelas - 1));

            for (let i = 1; i <= numParcelas; i++) {
              const dataVencimento = new Date(saleDate);
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
        const ehCartao = formaPagamento === 'CARTAO_CREDITO' || formaPagamento === 'CARTAO_DEBITO';
        const ehCrediario = formaPagamento === 'CREDIARIO';
        const usarProjecao = ehCartao && !cartaoImediato;

        const valorPagoAgora = ehCrediario ? Number(valorSinal) : (usarProjecao ? 0 : valorTotalLiquido);

        if (usarProjecao && feeResult.feeConfig && feeResult.feeConfig.prazoRecebimento > 0) {
          // Projeção: criar AccountReceivable para D+prazo
          const dataVencimento = new Date(saleDate);
          dataVencimento.setDate(dataVencimento.getDate() + feeResult.feeConfig.prazoRecebimento);

          await tx.accountReceivable.create({
            data: {
              storeId,
              saleId: sale.id,
              customerId: customerId || null,
              numeroParcela: 1,
              totalParcelas: 1,
              valorParcela: Math.round(valorTotalLiquido * 100) / 100,
              dataVencimento,
              formaPagamentoEsperada: formaPagamentoEntrada || formaPagamento,
              status: 'PENDENTE',
            }
          });
        }

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
            const customer = await tx.customer.findFirst({ where: { id: customerId, storeId } });
            if (customer) customerName = customer.nomeCompleto;
          }

          await tx.financialTransaction.create({
            data: {
              storeId,
              walletId: wallet.id,
              saleId: sale.id,
              tipo: 'ENTRADA',
              valor: Math.round(valorPagoAgora * 100) / 100,
              descricao: `Venda #${sale.id.substring(0, 8)} - ${customerName}`,
              categoria: 'VENDAS',
              formaPagamento: formaPagamentoEntrada || formaPagamento,
              dataTransacao: saleDate,
            }
          });

          // Also register CashTransaction if a cash register is open
          if (cashRegisterId) {
            await tx.cashTransaction.create({
              data: {
                cashRegisterId,
                tipo: 'ENTRADA',
                valor: valorPagoAgora,
                descricao: `Venda #${sale.id.substring(0, 8)} - ${customerName}`,
                createdAt: saleDate,
              }
            });
          }

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

            const customer = await prisma.customer.findFirst({
              where: { id: customerId, storeId },
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
      logger.error("Erro ao criar venda:", error);
      res.status(400).json({ message: error.message || "Erro ao processar a venda" });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId || (req.user as any)?.tenant_id;
      if (!storeId) return res.status(401).json({ message: "Tenant ID não encontrado" });

      const id = req.params.id as string;
      const { customerId, formaPagamento, valorDesconto, valorSinal, numeroParcelas, observacoes, dataVenda } = req.body;

      const sale = await prisma.sale.findFirst({
        where: { id, storeId },
        include: { receivables: { where: { status: { not: 'CANCELADA' } } }, financialTransactions: true }
      });

      if (!sale) return res.status(404).json({ message: "Venda não encontrada" });
      if (sale.status === 'CANCELADA') return res.status(400).json({ message: "Venda cancelada não pode ser editada" });

      // OWNERSHIP: cliente informado precisa pertencer a ESTA loja
      if (req.body.customerId) {
        const ownedCustomer = await prisma.customer.findFirst({
          where: { id: req.body.customerId, storeId },
          select: { id: true },
        });
        if (!ownedCustomer) {
          return res.status(400).json({ message: "Cliente não encontrado nesta loja" });
        }
      }

      // VENDEDOR/CAIXA só edita as próprias vendas
      const requesterId = req.user?.id;
      if (requesterId) {
        const access = await prisma.storeUserAccess.findUnique({
          where: { storeId_userId: { storeId, userId: requesterId } },
          select: { role: true }
        });
        if (access && (access.role === 'VENDEDOR' || access.role === 'CAIXA') && sale.userId !== requesterId) {
          return res.status(403).json({ message: "Você só pode editar as próprias vendas" });
        }
      }

      await prisma.$transaction(async (tx) => {
        const updateData: any = {};

        if (customerId !== undefined) updateData.customerId = customerId || null;
        if (formaPagamento !== undefined) updateData.formaPagamento = formaPagamento;
        if (numeroParcelas !== undefined) updateData.numeroParcelas = Number(numeroParcelas);
        if (dataVenda !== undefined && dataVenda !== null) updateData.dataVenda = parseDate(dataVenda);

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
          updateData.valorTaxasGateway = Math.round(feeResult.valorTaxasGateway * 100) / 100;
        }

        updateData.valorDesconto = novoDesconto;
        updateData.valorTotalLiquido = FeeCalculationService.calcularValorLiquido(
          Number(sale.valorTotalBruto),
          novoDesconto,
          feeResult.valorTaxasGateway
        );

        if (valorSinal !== undefined) updateData.valorSinal = Math.round(Number(valorSinal) * 100) / 100;
        if (observacoes !== undefined) updateData.observacoes = observacoes;

        await tx.sale.update({ where: { id }, data: updateData });

        const updatedSale = await tx.sale.findUnique({ where: { id } });
        if (!updatedSale) return;

        // Recalcular comissão dos itens: ela é proporcional ao valor líquido da venda
        // (após desconto/taxas), então precisa ser ajustada se esses valores mudaram.
        if (valorDesconto !== undefined || formaPagamento !== undefined || numeroParcelas !== undefined) {
          const valorBrutoAtual = Number(updatedSale.valorTotalBruto);
          if (valorBrutoAtual > 0) {
            const valorLiquidoAtual = Number(updatedSale.valorTotalLiquido);
            const rulesAtualizadas = await tx.commissionRule.findMany({
              where: { storeId, userId: sale.userId, ativo: true },
            });
            const pctPorCategoria = new Map<string, number>();
            for (const rule of rulesAtualizadas) {
              pctPorCategoria.set(rule.categoryId || '__default__', Number(rule.percentual));
            }
            const itensDaVenda = await tx.saleItem.findMany({
              where: { saleId: id },
              include: { product: { select: { categoryId: true } } },
            });
            for (const itemDaVenda of itensDaVenda) {
              if (itemDaVenda.commissionPaidAt) continue;
              const catKey = itemDaVenda.product?.categoryId || '__default__';
              const pct = pctPorCategoria.get(catKey) ?? pctPorCategoria.get('__default__') ?? 0;
              const subtotalItem = Number(itemDaVenda.quantidade) * Number(itemDaVenda.precoUnitarioVendido);
              const baseLiquidaItem = (subtotalItem * valorLiquidoAtual) / valorBrutoAtual;
              const novaComissao = Math.round((baseLiquidaItem * pct / 100 + Number.EPSILON) * 100) / 100;
              await tx.saleItem.update({ where: { id: itemDaVenda.id }, data: { comissaoVendedorValor: novaComissao } });
            }
          }
        }

        // Se dataVenda mudou, propaga para as transações financeiras existentes
        if (dataVenda !== undefined) {
          await tx.financialTransaction.updateMany({
            where: { saleId: id },
            data: { dataTransacao: updatedSale.dataVenda }
          });
        }

        // Recriar receivables se for crediario e houve mudança
        const pagamentoFinal = formaPagamento ?? sale.formaPagamento;
        const sinalFinal = valorSinal !== undefined ? Number(valorSinal) : Number(sale.valorSinal);
        const parcelasFinal = numeroParcelas !== undefined ? Number(numeroParcelas) : Number(sale.numeroParcelas);
        const liquidoFinal = Number(updatedSale.valorTotalLiquido);

        if (pagamentoFinal === 'CREDIARIO') {
          if (sale.receivables.length > 0) {
            // Reverter receivables pendentes existentes
            for (const rec of sale.receivables) {
              if (rec.status === 'PENDENTE') {
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
            const valorRestante = Math.round((liquidoFinal - sinalFinal) * 100) / 100;
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
              const customer = customerIdFinal ? await tx.customer.findFirst({ where: { id: customerIdFinal, storeId } }) : null;
              const sinalFinalRounded = Math.round(sinalFinal * 100) / 100;
              await tx.financialTransaction.create({
                data: {
                  storeId, walletId: wallet.id, saleId: id, tipo: 'ENTRADA',
                  valor: sinalFinalRounded,
                  descricao: `Sinal (edição) Venda #${id.substring(0, 8)} - ${customer?.nomeCompleto || 'Balcão'}`,
                  categoria: 'VENDAS', dataTransacao: updatedSale.dataVenda,
                }
              });
              await tx.wallet.update({ where: { id: wallet.id }, data: { saldoAtual: { increment: sinalFinalRounded } } });

              // Atualizar CashTransaction se houver caixa aberto
              if (sale.cashRegisterId) {
                await tx.cashTransaction.create({
                  data: {
                    cashRegisterId: sale.cashRegisterId,
                    tipo: 'ENTRADA',
                    valor: sinalFinalRounded,
                    descricao: `Sinal (edição) Venda #${id.substring(0, 8)} - ${customer?.nomeCompleto || 'Balcão'}`,
                    createdAt: updatedSale.dataVenda,
                  }
                });
              }
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
              const customer = customerIdFinal ? await tx.customer.findFirst({ where: { id: customerIdFinal, storeId } }) : null;
              const liquidoFinalRounded = Math.round(liquidoFinal * 100) / 100;
              await tx.financialTransaction.create({
                data: {
                  storeId, walletId: wallet.id, saleId: id, tipo: 'ENTRADA',
                  valor: liquidoFinalRounded,
                  descricao: `Venda #${id.substring(0, 8)} (editada) - ${customer?.nomeCompleto || 'Balcão'}`,
                  categoria: 'VENDAS', dataTransacao: updatedSale.dataVenda,
                }
              });

              // Criar CashTransaction se houver caixa aberto
              if (sale.cashRegisterId) {
                await tx.cashTransaction.create({
                  data: {
                    cashRegisterId: sale.cashRegisterId,
                    tipo: 'ENTRADA',
                    valor: liquidoFinalRounded,
                    descricao: `Venda #${id.substring(0, 8)} (editada) - ${customer?.nomeCompleto || 'Balcão'}`,
                    createdAt: updatedSale.dataVenda,
                  }
                });
              }
              await tx.wallet.update({ where: { id: wallet.id }, data: { saldoAtual: { increment: liquidoFinalRounded } } });
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
      logger.error("Erro ao atualizar venda:", error);
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

      // VENDEDOR/CAIXA só cancela as próprias vendas
      const requesterId = req.user?.id;
      if (requesterId) {
        const access = await prisma.storeUserAccess.findUnique({
          where: { storeId_userId: { storeId, userId: requesterId } },
          select: { role: true }
        });
        if (access && (access.role === 'VENDEDOR' || access.role === 'CAIXA') && sale.userId !== requesterId) {
          return res.status(403).json({ message: "Você só pode cancelar as próprias vendas" });
        }
      }

      const result = await prisma.$transaction(async (tx) => {
        // 1. Reverter estoque
        for (const item of sale.saleItems) {
          await StockMovementService.movimentar(tx, {
            storeId: sale.storeId,
            productId: item.productId,
            userId: req.user!.id,
            tipo: 'ENTRADA',
            quantidade: Number(item.quantidade),
            referenciaId: sale.id,
            observacao: `Estorno de cancelamento`,
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
                storeId: sale.storeId,
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

        // 3.5 Zerar comissão pendente dos itens (venda cancelada não gera comissão).
        // Comissão já paga (commissionPaidAt preenchido) não é revertida aqui.
        for (const item of sale.saleItems) {
          if (!item.commissionPaidAt && Number(item.comissaoVendedorValor) !== 0) {
            await tx.saleItem.update({
              where: { id: item.id },
              data: { comissaoVendedorValor: 0 }
            });
          }
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
      logger.error("Erro ao cancelar venda:", error);
      res.status(500).json({ message: "Erro interno do servidor", detail: error.message });
    }
  }

  async requestDelete(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId || (req.user as any)?.tenant_id;
      if (!storeId) {
        return res.status(401).json({ message: "Tenant ID não encontrado no token" });
      }

      const { id } = req.params;

      const JWT_SECRET = process.env.JWT_SECRET;
      if (!JWT_SECRET) {
        return res.status(500).json({ error: "Erro de configuração de servidor" });
      }

      const sale = await prisma.sale.findFirst({
        where: { id: String(id), storeId },
      });
      if (!sale) {
        return res.status(404).json({ message: "Venda não encontrada" });
      }
      if (sale.status === 'CANCELADA') {
        return res.status(400).json({ message: "Venda já está cancelada" });
      }

      // Token de uso único (válido por 2 minutos) para confirmar a exclusão
      const jti = randomUUID();
      const token = jwt.sign(
        { action: "sale:delete", saleId: sale.id, userId: req.user!.id, jti },
        JWT_SECRET,
        { expiresIn: "2m" }
      );
      res.json({ token, expiresIn: 120 });
    } catch (error: any) {
      logger.error("Erro ao gerar token de exclusão:", error);
      res.status(500).json({ message: "Erro interno do servidor", detail: error.message });
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId || (req.user as any)?.tenant_id;
      if (!storeId) {
        return res.status(401).json({ message: "Tenant ID não encontrado no token" });
      }

      const { id } = req.params;
      const { password, token } = req.body;

      if (!password && !token) {
        return res.status(400).json({ message: "Token de confirmação ou senha do administrador é obrigatório" });
      }

      if (token) {
        // Valida token de exclusão gerado pelo request-delete
        const JWT_SECRET = process.env.JWT_SECRET;
        if (!JWT_SECRET) {
          return res.status(500).json({ error: "Erro de configuração de servidor" });
        }
        try {
          const payload = jwt.verify(token, JWT_SECRET) as { action: string; saleId: string; userId: string; jti: string };
          if (payload.action !== "sale:delete" || payload.saleId !== String(id) || payload.userId !== req.user!.id) {
            return res.status(403).json({ message: "Token de exclusão inválido" });
          }
        } catch (err) {
          return res.status(401).json({ message: "Token de exclusão expirado ou inválido" });
        }
      } else {
        // Verify admin password
        const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
        if (!user || !(await comparePassword(password, user.senhaHash))) {
          return res.status(403).json({ message: "Senha inválida" });
        }
      }

      const sale = await prisma.sale.findFirst({
        where: { id: String(id), storeId },
        include: {
          saleItems: true,
          receivables: true,
          financialTransactions: true,
          productReturns: true,
        },
      });
      if (!sale) return res.status(404).json({ message: "Venda não encontrada" });

      await prisma.$transaction(async (tx) => {
        // 1. Revert stock
        for (const item of sale.saleItems) {
          await StockMovementService.movimentar(tx, {
            storeId: sale.storeId,
            productId: item.productId,
            userId: req.user!.id,
            tipo: 'ENTRADA',
            quantidade: Number(item.quantidade),
            referenciaId: sale.id,
            observacao: 'Estorno exclusão de venda',
          });
        }

        // 2. Cancel receivables
        for (const receivable of sale.receivables) {
          await tx.accountReceivable.update({
            where: { id: receivable.id },
            data: { status: 'CANCELADA' },
          });
        }

        // 3. Unlink financial transactions (saleId set to null via onDelete SetNull)
        for (const ft of sale.financialTransactions) {
          if (ft.tipo === 'ENTRADA') {
            await tx.financialTransaction.update({
              where: { id: ft.id },
              data: { status: 'ESTORNADA', saleId: null, receivableId: null },
            });
          }
        }

        // 4. Delete product returns linked to this sale
        if (sale.productReturns.length > 0) {
          for (const pr of sale.productReturns) {
            await tx.productReturnItem.deleteMany({ where: { productReturnId: pr.id } });
          }
          await tx.productReturn.deleteMany({ where: { saleId: sale.id } });
        }

        // 5. Delete sale items (cascaded, but explicit for safety)
        await tx.saleItem.deleteMany({ where: { saleId: sale.id } });

        // 6. Delete sale
        await tx.sale.delete({ where: { id: sale.id } });
      });

      res.json({ message: "Venda excluída permanentemente" });
    } catch (error: any) {
      logger.error("Erro ao excluir venda:", error);
      res.status(500).json({ message: "Erro interno do servidor", detail: error.message });
    }
  }
}
