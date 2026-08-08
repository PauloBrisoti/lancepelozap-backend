import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { fail } from './response';

export const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

export const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'temp-mail.org',
  'throwaway.email', 'yopmail.com', 'mailnator.com', 'trashmail.com',
  'temporarymail.com', 'fakemail.com', 'emailfake.com', 'tempmail.net',
  'mailcatch.com', 'mytemp.email', 'spam4.me', 'dispostable.com',
  'getnada.com', 'maildrop.cc', 'inboxbear.com', 'tempr.email',
  'sharklasers.com', 'grr.la', ' Guerrillamail.info',
]);

const GENERIC_DOMAINS = new Set([
  'test.com', 'example.com', 'domain.com', 'company.com', 'email.com',
  'mail.com', 'website.com', 'yourdomain.com', 'yourcompany.com',
  'mycompany.com', 'mydomain.com', 'localhost.com', 'teste.com',
  'teste123.com', 'email.com.br', 'provedor.com', 'meuemail.com',
  'nomail.com', 'nowhere.com',
]);

export function emailValido(msg?: string) {
  return z.string()
    .regex(EMAIL_REGEX, msg || 'E-mail inválido')
    .refine(val => {
      const domain = val.split('@')[1]?.toLowerCase();
      return domain ? !DISPOSABLE_DOMAINS.has(domain) : true;
    }, 'E-mail descartável não é permitido')
    .refine(val => {
      const domain = val.split('@')[1]?.toLowerCase();
      return domain ? !GENERIC_DOMAINS.has(domain) : true;
    }, 'E-mail genérico não é permitido');
}

export const TELEFONE_REGEX = /^\(\d{2}\)\s9\d{4}-\d{4}$/;
export const telefoneValido = (msg?: string) => z.string().regex(TELEFONE_REGEX, msg || 'Telefone deve estar no formato (XX) 9XXXX-XXXX');

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
  valorAcrescimo: z.number().min(0).optional().default(0),
  valorSinal: z.number().min(0).optional().default(0),
  numeroParcelas: z.number().int().positive().optional().default(1),
  dataVenda: z.string().optional(),
  formaPagamentoEntrada: z.string().optional(),
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
  email: emailValido().optional().or(z.literal('')),
  cep: z.string().optional(),
  enderecoCompleto: z.string().optional(),
});

export const categorySchema = z.object({
  nome: z.string().min(1, 'Nome é obrigatório'),
  corHexadecimal: z.string().optional(),
  margemLucroPadrao: z.number().optional(),
  aliquotaImposto: z.union([z.string(), z.number()]).optional(),
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
  email: emailValido('E-mail inválido'),
  password: z.string().min(1, 'Senha é obrigatória'),
  captchaToken: z.string().optional(),
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
  email: emailValido('E-mail inválido'),
  password: passwordSchema,
  role: z.enum(['VENDEDOR', 'CAIXA', 'GERENTE']).optional().default('VENDEDOR'),
});

export const registerSchema = z.object({
  nomeFantasia: z.string().min(2, 'Nome da loja é obrigatório'),
  nomeResponsavel: z.string().min(2, 'Nome do responsável é obrigatório'),
  email: emailValido('E-mail inválido'),
  senha: z
    .string()
    .min(8, 'Senha deve ter no mínimo 8 caracteres')
    .max(128, 'Senha deve ter no máximo 128 caracteres')
    .regex(/[A-Z]/, 'Senha deve conter pelo menos uma letra maiúscula')
    .regex(/[a-z]/, 'Senha deve conter pelo menos uma letra minúscula')
    .regex(/[0-9]/, 'Senha deve conter pelo menos um número'),
  telefoneWhatsapp: telefoneValido('Telefone WhatsApp é obrigatório e deve estar no formato (XX) 9XXXX-XXXX'),
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
  emailContato: emailValido().optional().or(z.literal('')),
  chavePix: z.string().optional(),
});

export const completeProfileSchema = z.object({
  telefoneWhatsapp: telefoneValido('WhatsApp deve estar no formato (XX) 9XXXX-XXXX'),
  cep: z.string().optional(),
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  uf: z.string().optional(),
});

export const createUserSchemaOld = z.object({
  nome: z.string().min(1),
  email: emailValido(),
  password: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres'),
  role: z.enum(['VENDEDOR', 'CAIXA', 'GERENTE']).optional().default('VENDEDOR'),
});
