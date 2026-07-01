import { prisma } from '../lib/prisma';

/* ========================================================================
 * FeeCalculationService
 * 
 * Serviço dedicado ao cálculo de taxas de gateway (cartão, pix, etc.)
 * Responsabilidades:
 *   1. Validar a relação entre formaPagamento e taxa aplicável no banco
 *   2. Calcular o valor das taxas com base na configuração da loja
 *   3. Fornecer tanto o valor bruto das taxas quanto o valor líquido final
 * ======================================================================== */

export interface FeeCalculationInput {
  storeId: string;
  formaPagamento: string;
  parcela: number;
  valorTotalBruto: number;
}

export interface FeeCalculationResult {
  feeConfig: {
    id: string;
    formaPagamento: string;
    parcelas: number;
    taxaPercentual: number;
    taxaFixa: number;
    prazoRecebimento: number;
  } | null;
  valorTaxasGateway: number;
  valorPercentual: number;
  valorFixo: number;
}

export class FeeCalculationService {

  /**
   * Busca a configuração de taxa aplicável no banco de dados
   * fazendo a validação da relação formaPagamento + parcelas.
   *
   * Valida:
   *  - Existe uma taxa configurada para esta forma de pagamento?
   *  - Existe uma taxa configurada para este número de parcelas?
   *  - A combinação (storeId, formaPagamento, parcelas) é única?
   *
   * @returns O registro de taxa encontrado ou null se não existir
   */
  static async findFeeConfig(
    storeId: string,
    formaPagamento: string,
    parcela: number
  ) {
    const feeConfig = await prisma.paymentMethodFee.findFirst({
      where: {
        storeId,
        formaPagamento,
        parcelas: parcela,
      },
    });

    return feeConfig;
  }

  /**
   * Calcula o valor das taxas de gateway com base na configuração encontrada.
   *
   * Fórmula:
   *   taxaPercentual = valorTotalBruto * (taxaPercentualConfig / 100)
   *   valorTaxasGateway = taxaPercentual + taxaFixaConfig
   *
   * Regras:
   *  - Se não houver configuração de taxa, retorna 0
   *  - Se a taxa percentual for 0 e a taxa fixa for 0, retorna 0
   *  - O valor nunca é negativo
   */
  static calculate(
    valorTotalBruto: number,
    feeConfig: { taxaPercentual: number; taxaFixa: number } | null
  ): { valorTaxasGateway: number; valorPercentual: number; valorFixo: number } {
    if (!feeConfig) {
      return { valorTaxasGateway: 0, valorPercentual: 0, valorFixo: 0 };
    }

    const valorPercentual = (valorTotalBruto * Number(feeConfig.taxaPercentual)) / 100;
    const valorFixo = Number(feeConfig.taxaFixa) || 0;
    const valorTaxasGateway = Math.max(0, valorPercentual + valorFixo);

    return { valorTaxasGateway, valorPercentual, valorFixo };
  }

  /**
   * Método completo: busca a config no banco E calcula o valor das taxas.
   *
   * @returns FeeCalculationResult com todos os detalhes do cálculo
   */
  static async execute(input: FeeCalculationInput): Promise<FeeCalculationResult> {
    const { storeId, formaPagamento, parcela, valorTotalBruto } = input;

    const feeConfig = await this.findFeeConfig(storeId, formaPagamento, parcela);

    const { valorTaxasGateway, valorPercentual, valorFixo } = this.calculate(
      valorTotalBruto,
      feeConfig ? { taxaPercentual: Number(feeConfig.taxaPercentual), taxaFixa: Number(feeConfig.taxaFixa) } : null
    );

    return {
      feeConfig: feeConfig
        ? {
            id: feeConfig.id,
            formaPagamento: feeConfig.formaPagamento,
            parcelas: feeConfig.parcelas,
            taxaPercentual: Number(feeConfig.taxaPercentual),
            taxaFixa: Number(feeConfig.taxaFixa),
            prazoRecebimento: feeConfig.prazoRecebimento,
          }
        : null,
      valorTaxasGateway,
      valorPercentual,
      valorFixo,
    };
  }

  /**
   * Calcula o valor total líquido (valorTotalBruto - desconto - taxas)
   */
  static calcularValorLiquido(
    valorTotalBruto: number,
    valorDesconto: number,
    valorTaxasGateway: number
  ): number {
    return Math.max(0, valorTotalBruto - valorDesconto - valorTaxasGateway);
  }
}
