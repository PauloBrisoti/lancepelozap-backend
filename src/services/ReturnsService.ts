import { prisma } from '../lib/prisma';
import { StockMovementService } from './StockMovementService';

export class ReturnsServiceError extends Error {
  constructor(public readonly httpCode: 400 | 404, message: string) {
    super(message);
    this.name = 'ReturnsServiceError';
  }
}

export class ReturnsService {
  /**
   * Conclui uma devolução APROVADA:
   *  - Reverte o estoque de cada item devolvido (produto.qtdEstoqueAtual += qtd)
   *  - Cria StockMovement de ENTRADA para cada item
   *  - Estorna proporcionalmente o valor recebido na venda (transação financeira + carteira)
   *  - Zera a comissão do vendedor sobre a quantidade devolvida
   *  - Atualiza a devolução para CONCLUIDO
   *
   * @throws {ReturnsServiceError} 404 se devolução não encontrada
   * @throws {ReturnsServiceError} 400 se status não é APROVADO
   */
  static async completeReturn(
    storeId: string,
    userId: string,
    returnId: string
  ): Promise<any> {
    const ret = await prisma.productReturn.findFirst({
      where: { id: returnId, storeId },
      include: {
        items: true,
        sale: {
          include: {
            saleItems: true,
            financialTransactions: { where: { tipo: 'ENTRADA', status: 'ATIVA' } },
          },
        },
      },
    });

    if (!ret) {
      throw new ReturnsServiceError(404, 'Devolução não encontrada');
    }
    if (ret.status !== 'APROVADO') {
      throw new ReturnsServiceError(
        400,
        `Devolução precisa estar APROVADA para ser concluída (status atual: ${ret.status})`
      );
    }

    return prisma.$transaction(async (tx) => {
      // Restock e StockMovements para cada item, além do estorno de comissão
      for (const item of ret.items) {
        const result = await StockMovementService.movimentar(tx, {
          storeId,
          productId: item.productId,
          userId,
          tipo: 'ENTRADA',
          quantidade: Number(item.quantidade),
          referenciaId: ret.id,
          observacao: `Devolução #${ret.id.slice(0, 8)}`,
          skipSeProdutoInexistente: true,
        });
        if (!result) continue;

        // Estorna a comissão proporcional à quantidade devolvida deste produto
        const saleItem = ret.sale.saleItems.find((si) => si.productId === item.productId);
        if (saleItem && Number(saleItem.comissaoVendedorValor) > 0) {
          const qtdOriginal = Number(saleItem.quantidade);
          const comissaoOriginal = Number(saleItem.comissaoVendedorValor);
          const comissaoPorUnidade = comissaoOriginal / qtdOriginal;
          const comissaoEstornar = Math.min(comissaoPorUnidade * Number(item.quantidade), comissaoOriginal);

          await tx.saleItem.update({
            where: { id: saleItem.id },
            data: { comissaoVendedorValor: { decrement: comissaoEstornar } },
          });
        }
      }

      // Estorna o valor recebido na venda, proporcional ao total devolvido
      const valorTotalDevolucao = Number(ret.valorTotal);
      const valorTotalVenda = Number(ret.sale.valorTotalLiquido);
      if (valorTotalDevolucao > 0 && valorTotalVenda > 0) {
        let restanteEstornar = valorTotalDevolucao;
        for (const transaction of ret.sale.financialTransactions) {
          if (restanteEstornar <= 0) break;
          const valorTransacao = Number(transaction.valor);
          const valorEstornoNestaTransacao = Math.min(valorTransacao, restanteEstornar);

          await tx.financialTransaction.create({
            data: {
              storeId,
              walletId: transaction.walletId,
              saleId: ret.sale.id,
              tipo: 'SAIDA',
              status: 'ATIVA',
              valor: valorEstornoNestaTransacao,
              descricao: `Estorno devolução #${ret.id.slice(0, 8)}`,
              categoria: 'DEVOLUCAO',
              dataTransacao: new Date(),
            },
          });

          await tx.wallet.update({
            where: { id: transaction.walletId },
            data: { saldoAtual: { decrement: valorEstornoNestaTransacao } },
          });

          restanteEstornar -= valorEstornoNestaTransacao;
        }
      }

      return tx.productReturn.update({
        where: { id: ret.id },
        data: { status: 'CONCLUIDO' },
        include: {
          items: {
            include: { product: { select: { id: true, nome: true, codigoVisual: true } } },
          },
          sale: { select: { id: true, dataVenda: true } },
          customer: { select: { id: true, nomeCompleto: true } },
        },
      });
    });
  }
}
