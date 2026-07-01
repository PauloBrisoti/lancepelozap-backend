import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { fail } from './response';

export function validate(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map(i => ({
        path: i.path.join('.'),
        message: i.message
      }));
      return fail(res, 'Dados inválidos', 400, details);
    }
    req.body = result.data;
    next();
  };
}

export const saleSchema = z.object({
  customerId: z.string().optional(),
  cashRegisterId: z.string().optional(),
  itens: z.array(z.object({
    productId: z.string().min(1, 'Produto é obrigatório'),
    quantidade: z.number().positive('Quantidade deve ser positiva'),
    precoUnitarioVendido: z.number().positive('Preço deve ser positivo'),
  })).min(1, 'Mínimo de 1 item'),
  formaPagamento: z.enum(['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO', 'CREDIARIO']),
  valorDesconto: z.number().min(0).optional().default(0),
  valorSinal: z.number().min(0).optional().default(0),
  numeroParcelas: z.number().int().positive().optional().default(1),
});

export const productSchema = z.object({
  nome: z.string().min(1, 'Nome é obrigatório'),
  categoryId: z.string().min(1, 'Categoria é obrigatória'),
  brandId: z.string().nullish(),
  codigoBarrasEan: z.string().nullish(),
  codigoVisual: z.string().nullish(),
  descricaoVariante: z.string().nullish(),
  ncm: z.string().nullish(),
  unidade: z.string().nullish(),
  pesoBruto: z.number().nullish(),
  pesoLiquido: z.number().nullish(),
  precoCusto: z.number().min(0),
  precoVendaSugerido: z.number().min(0, 'Preço de venda deve ser positivo'),
  qtdEstoqueAtual: z.number().min(0).optional().default(0),
  estoqueMinimo: z.number().min(0).optional().default(5),
  status: z.string().nullish(),
  dataPedido: z.string().nullish(),
  previsaoChegada: z.string().nullish(),
  impostoEstimadoPercentual: z.number().nullish(),
  imageUrl: z.any().nullish(),
});

export const customerSchema = z.object({
  nomeCompleto: z.string().min(1, 'Nome é obrigatório'),
  cpf: z.string().optional(),
  telefoneWhatsapp: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  cep: z.string().optional(),
  enderecoCompleto: z.string().optional(),
});

export const categorySchema = z.object({
  nome: z.string().min(1, 'Nome é obrigatório'),
  corHexadecimal: z.string().optional(),
  margemLucroPadrao: z.number().optional(),
});

export const transactionSchema = z.object({
  walletId: z.string().min(1),
  tipo: z.enum(['ENTRADA', 'SAIDA']),
  valor: z.number().positive('Valor deve ser positivo'),
  descricao: z.string().min(1, 'Descrição é obrigatória'),
  categoria: z.string().optional(),
  dataTransacao: z.string().optional(),
  customerId: z.string().optional(),
  fornecedor: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Senha é obrigatória'),
});

export const passwordSchema = z
  .string()
  .min(8, 'Senha deve ter no mínimo 8 caracteres')
  .max(128, 'Senha deve ter no máximo 128 caracteres')
  .regex(/[A-Z]/, 'Deve conter pelo menos uma letra maiúscula')
  .regex(/[a-z]/, 'Deve conter pelo menos uma letra minúscula')
  .regex(/[0-9]/, 'Deve conter pelo menos um número');

export const createUserSchema = z.object({
  nome: z.string().min(1, 'Nome é obrigatório'),
  email: z.string().email('E-mail inválido'),
  password: passwordSchema,
  role: z.enum(['VENDEDOR', 'CAIXA', 'GERENTE']).optional().default('VENDEDOR'),
});

export const registerSchema = z.object({
  nomeFantasia: z.string().min(2, 'Nome da loja é obrigatório'),
  nomeResponsavel: z.string().min(2, 'Nome do responsável é obrigatório'),
  email: z.string().email('E-mail inválido'),
  senha: z
    .string()
    .min(8, 'Senha deve ter no mínimo 8 caracteres')
    .max(128, 'Senha deve ter no máximo 128 caracteres')
    .regex(/[A-Z]/, 'Senha deve conter pelo menos uma letra maiúscula')
    .regex(/[a-z]/, 'Senha deve conter pelo menos uma letra minúscula')
    .regex(/[0-9]/, 'Senha deve conter pelo menos um número'),
  telefoneWhatsapp: z.string().optional(),
  cnpjCpf: z.string().optional(),
});

export const productEntrySchema = z.object({
  fornecedor: z.string().optional(),
  valorFreteTotal: z.number().min(0).optional().default(0),
  itens: z.array(z.object({
    productId: z.string().min(1, 'Produto é obrigatório'),
    quantidade: z.number().positive('Quantidade deve ser positiva'),
    custoFornecedor: z.number().min(0, 'Custo do fornecedor deve ser positivo'),
    freteRateado: z.number().min(0).optional().default(0),
  })).min(1, 'Mínimo de 1 item'),
});

export const tenantSettingsSchema = z.object({
  nomeFantasia: z.string().optional(),
  nichoPrincipal: z.string().optional(),
  telefoneWhatsapp: z.string().optional(),
  emailContato: z.string().email().optional().or(z.literal('')),
  chavePix: z.string().optional(),
});

export const createUserSchemaOld = z.object({
  nome: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
  role: z.enum(['VENDEDOR', 'CAIXA', 'GERENTE']).optional().default('VENDEDOR'),
});
