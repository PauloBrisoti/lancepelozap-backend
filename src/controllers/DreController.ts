import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import PDFDocument from 'pdfkit';
import { format } from 'date-fns';
import { buildDateRange } from '../lib/dateUtils';

export class DreController {
  static async getDre(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: "Tenant ID não encontrado" });

      const queryStart = req.query.startDate as string;
      const queryEnd = req.query.endDate as string;
      
      const { firstDay: startDate, lastDay: endDate } = buildDateRange(queryStart, queryEnd);

      // 1. Receita Operacional Bruta
      const salesAggregate = await prisma.sale.aggregate({
        where: { storeId, status: { not: 'CANCELADA' }, dataVenda: { gte: startDate, lte: endDate } },
        _sum: { valorTotalBruto: true, valorDesconto: true, valorTaxasGateway: true, cmvTotal: true }
      });
      const petOrdersAgg = await prisma.petServiceOrder.aggregate({
        where: { storeId, status: 'CONCLUIDO', dataConclusao: { gte: startDate, lte: endDate } },
        _sum: { valorFinal: true }
      });
      const petRevenue = Number(petOrdersAgg._sum.valorFinal || 0);
      
      const receitaBruta = Number(salesAggregate._sum.valorTotalBruto || 0) + petRevenue;

      // 2. Deduções (Descontos + Taxas)
      const descontos = Number(salesAggregate._sum.valorDesconto || 0);
      const taxasGateway = Number(salesAggregate._sum.valorTaxasGateway || 0);
      const deducoesTotal = descontos + taxasGateway;

      // 3. Receita Operacional Líquida
      const receitaLiquida = receitaBruta - deducoesTotal;

      // 4. Impostos Estimados (hierarquia: produto → categoria → loja)
      const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: { aliquotaImposto: true }
      });
      const aliquotaImposto = Number(store?.aliquotaImposto || 0);
      const salesWithItems = await prisma.sale.findMany({
        where: { storeId, status: { not: 'CANCELADA' }, dataVenda: { gte: startDate, lte: endDate } },
        select: {
          saleItems: {
            select: {
              precoUnitarioVendido: true,
              quantidade: true,
              product: {
                select: {
                  impostoEstimadoPercentual: true,
                  category: { select: { aliquotaImposto: true } }
                }
              }
            }
          }
        }
      });
      let impostosEstimados = 0;
      for (const sale of salesWithItems) {
        for (const item of sale.saleItems) {
          const itemValor = Number(item.precoUnitarioVendido) * Number(item.quantidade);
          const prodRate = Number(item.product?.impostoEstimadoPercentual || 0);
          const catRate = Number(item.product?.category?.aliquotaImposto || 0);
          const effectiveRate = prodRate > 0 ? prodRate : (catRate > 0 ? catRate : aliquotaImposto);
          if (effectiveRate > 0) {
            impostosEstimados += itemValor * effectiveRate / 100;
          }
        }
      }
      impostosEstimados = Math.round(impostosEstimados * 100) / 100;

      // 5. Custos (CMV)
      const cmvTotal = Number(salesAggregate._sum.cmvTotal || 0);

      // 6. Lucro Bruto Operacional (líquido de impostos)
      const lucroBruto = receitaLiquida - impostosEstimados - cmvTotal;

      // 6. Despesas Operacionais Categorizadas
      const transacoesSaida = await prisma.financialTransaction.groupBy({
        by: ['categoria'],
        where: {
          storeId,
          tipo: 'SAIDA',
          status: 'ATIVA',
          dataTransacao: { gte: startDate, lte: endDate },
          categoria: { notIn: ['DEVOLUCAO', 'PRO_LABORE', 'RETIRADA_LUCRO', 'CANCELAMENTO'] } // Devoluções, lucros e cancelamentos não são despesas operacionais da DRE
        },
        _sum: { valor: true }
      });

      const despesasCategorizadas = transacoesSaida.map(t => ({
        categoria: t.categoria || 'Sem Categoria',
        valor: Number(t._sum.valor || 0)
      })).sort((a, b) => b.valor - a.valor);

      const despesasTotal = despesasCategorizadas.reduce((acc, d) => acc + d.valor, 0);

      // 7. Lucro Líquido Operacional
      const lucroLiquido = lucroBruto - despesasTotal;

      // Calculando margens para visualização
      const margemLucroBruto = receitaLiquida > 0 ? (lucroBruto / receitaLiquida) * 100 : 0;
      const margemLucroLiquido = receitaLiquida > 0 ? (lucroLiquido / receitaLiquida) * 100 : 0;

      return res.json({
        receitaBruta,
        deducoes: {
          total: deducoesTotal,
          descontos,
          taxasGateway
        },
        receitaLiquida,
        impostosEstimados,
        aliquotaImposto,
        custos: {
          cmv: cmvTotal
        },
        lucroBruto,
        margemLucroBruto,
        despesas: {
          total: despesasTotal,
          detalhamento: despesasCategorizadas
        },
        lucroLiquido,
        margemLucroLiquido
      });
      
    } catch (error) {
      console.error('Erro ao gerar DRE:', error);
      return res.status(500).json({ message: 'Erro interno ao gerar DRE.' });
    }
  }

  static async exportDre(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: "Tenant ID não encontrado" });

      const store = await prisma.store.findUnique({ where: { id: storeId }, select: { nomeFantasia: true } });

      const queryStart = req.query.startDate as string;
      const queryEnd = req.query.endDate as string;
      
      const { firstDay: startDate, lastDay: endDate } = buildDateRange(queryStart, queryEnd);

      const periodoLabel = `${startDate.toLocaleDateString('pt-BR')} a ${endDate.toLocaleDateString('pt-BR')}`;

      const salesAggregate = await prisma.sale.aggregate({
        where: { storeId, status: { not: 'CANCELADA' }, dataVenda: { gte: startDate, lte: endDate } },
        _sum: { valorTotalBruto: true, valorDesconto: true, valorTaxasGateway: true, cmvTotal: true }
      });
      
      const receitaBruta = Number(salesAggregate._sum.valorTotalBruto || 0);
      const descontos = Number(salesAggregate._sum.valorDesconto || 0);
      const taxasGateway = Number(salesAggregate._sum.valorTaxasGateway || 0);
      const deducoesTotal = descontos + taxasGateway;
      const receitaLiquida = receitaBruta - deducoesTotal;
      const storeData = await prisma.store.findUnique({
        where: { id: storeId },
        select: { aliquotaImposto: true }
      });
      const aliquotaImposto = Number(storeData?.aliquotaImposto || 0);
      const salesWithItems = await prisma.sale.findMany({
        where: { storeId, status: { not: 'CANCELADA' }, dataVenda: { gte: startDate, lte: endDate } },
        select: {
          saleItems: {
            select: {
              precoUnitarioVendido: true,
              quantidade: true,
              product: {
                select: {
                  impostoEstimadoPercentual: true,
                  category: { select: { aliquotaImposto: true } }
                }
              }
            }
          }
        }
      });
      let impostosEstimados = 0;
      for (const sale of salesWithItems) {
        for (const item of sale.saleItems) {
          const itemValor = Number(item.precoUnitarioVendido) * Number(item.quantidade);
          const prodRate = Number(item.product?.impostoEstimadoPercentual || 0);
          const catRate = Number(item.product?.category?.aliquotaImposto || 0);
          const effectiveRate = prodRate > 0 ? prodRate : (catRate > 0 ? catRate : aliquotaImposto);
          if (effectiveRate > 0) {
            impostosEstimados += itemValor * effectiveRate / 100;
          }
        }
      }
      impostosEstimados = Math.round(impostosEstimados * 100) / 100;
      const cmvTotal = Number(salesAggregate._sum.cmvTotal || 0);
      const lucroBruto = receitaLiquida - impostosEstimados - cmvTotal;

      const transacoesSaida = await prisma.financialTransaction.groupBy({
        by: ['categoria'],
        where: {
          storeId, tipo: 'SAIDA', status: 'ATIVA',
          dataTransacao: { gte: startDate, lte: endDate },
          categoria: { notIn: ['DEVOLUCAO', 'PRO_LABORE', 'RETIRADA_LUCRO', 'CANCELAMENTO'] }
        },
        _sum: { valor: true }
      });

      const despesasCategorizadas = transacoesSaida.map(t => ({
        categoria: t.categoria || 'Sem Categoria',
        valor: Number(t._sum.valor || 0)
      })).sort((a, b) => b.valor - a.valor);

      const despesasTotal = despesasCategorizadas.reduce((acc, d) => acc + d.valor, 0);
      const lucroLiquido = lucroBruto - despesasTotal;
      const margemLucroBruto = receitaLiquida > 0 ? (lucroBruto / receitaLiquida) * 100 : 0;
      const margemLucroLiquido = receitaLiquida > 0 ? (lucroLiquido / receitaLiquida) * 100 : 0;

      const formato = (req.query.formato as string) || 'csv';

      if (formato === 'pdf') {
        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="dre_${format(new Date(), 'yyyy-MM-dd')}.pdf"`);
        doc.pipe(res);

        const pageWidth = doc.page.width - 80;
        const leftMargin = 40;

        doc.fontSize(18).font('Helvetica-Bold').text('Demonstração do Resultado do Exercício', leftMargin, 50);
        doc.fontSize(10).font('Helvetica').text(store?.nomeFantasia || 'Loja', leftMargin, 75);
        doc.fontSize(9).fillColor('#666').text(`Período: ${periodoLabel}`, leftMargin, 90);
        doc.fillColor('#000');
        
        let y = 120;

        const line = (label: string, value: number, indent = 0, bold = false) => {
          const x = leftMargin + indent;
          doc.fontSize(10);
          if (bold) doc.font('Helvetica-Bold'); else doc.font('Helvetica');
          doc.text(label, x, y);
          doc.text(`R$ ${value.toFixed(2)}`, pageWidth - 80, y, { align: 'right' });
          y += 18;
        };

        const separator = () => { y += 4; doc.moveTo(leftMargin, y).lineTo(pageWidth, y).strokeColor('#ccc').stroke(); y += 8; };

        line('1. Receita Operacional Bruta', receitaBruta, 0, true);
        line('   (-) Descontos', -descontos);
        line('   (-) Taxas de Gateway', -taxasGateway);
        separator();
        line('2. Receita Operacional Líquida', receitaLiquida, 0, true);
        separator();
        line('3. (-) Impostos Estimados', -impostosEstimados, 0, true);
        doc.fontSize(9).fillColor('#666').text(`(Alíquota ${aliquotaImposto}%)`, leftMargin + 160, y - 18, { width: 150 });
        doc.fillColor('#000');
        separator();
        line('4. (-) Custo das Mercadorias (CMV)', -cmvTotal, 0, true);
        separator();
        line('5. Lucro Bruto', lucroBruto, 0, true);
        doc.fontSize(9).fillColor('#666').text(`Margem Bruta: ${margemLucroBruto.toFixed(1)}%`, leftMargin + 200, y - 14);
        doc.fillColor('#000');
        y += 6;
        
        separator();
        line('5. (-) Despesas Operacionais', -despesasTotal, 0, true);
        despesasCategorizadas.forEach(d => {
          line(`   ${d.categoria}`, -d.valor);
        });
        separator();
        doc.fontSize(11).font('Helvetica-Bold');
        const lucroColor = lucroLiquido >= 0 ? '#16a34a' : '#dc2626';
        doc.fillColor(lucroColor);
        doc.text('6. Lucro Líquido do Período', leftMargin, y);
        doc.text(`R$ ${lucroLiquido.toFixed(2)}`, pageWidth - 80, y, { align: 'right' });
        doc.fillColor('#000');
        y += 18;
        doc.fontSize(9).fillColor('#666').text(`Margem Líquida: ${margemLucroLiquido.toFixed(1)}%`, leftMargin + 200, y - 14);
        doc.fillColor('#000');

        doc.end();
      } else {
        const csvLines: string[] = [];
        csvLines.push('Demonstração do Resultado do Exercício');
        csvLines.push(`Loja,${store?.nomeFantasia || ''}`);
        csvLines.push(`Período,${periodoLabel}`);
        csvLines.push('');
        csvLines.push('Descrição,Valor');
        csvLines.push(`Receita Operacional Bruta,${receitaBruta.toFixed(2)}`);
        csvLines.push(`Descontos,${descontos.toFixed(2)}`);
        csvLines.push(`Taxas de Gateway,${taxasGateway.toFixed(2)}`);
        csvLines.push(`Receita Operacional Líquida,${receitaLiquida.toFixed(2)}`);
        csvLines.push(`Impostos Estimados (${aliquotaImposto}%),${impostosEstimados.toFixed(2)}`);
        csvLines.push(`Custo das Mercadorias (CMV),${cmvTotal.toFixed(2)}`);
        csvLines.push(`Lucro Bruto,${lucroBruto.toFixed(2)}`);
        csvLines.push(`Margem Bruta (%),${margemLucroBruto.toFixed(1)}`);
        despesasCategorizadas.forEach(d => csvLines.push(`Despesa: ${d.categoria},${d.valor.toFixed(2)}`));
        csvLines.push(`Total Despesas,${despesasTotal.toFixed(2)}`);
        csvLines.push(`Lucro Líquido,${lucroLiquido.toFixed(2)}`);
        csvLines.push(`Margem Líquida (%),${margemLucroLiquido.toFixed(1)}`);

        const csv = csvLines.join('\r\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="dre_${format(new Date(), 'yyyy-MM-dd')}.csv"`);
        res.send('\uFEFF' + csv);
      }
    } catch (error) {
      console.error('Erro ao exportar DRE:', error);
      return res.status(500).json({ message: 'Erro interno ao exportar DRE.' });
    }
  }
}
