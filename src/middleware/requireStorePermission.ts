import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { fail } from '../lib/response';

type StoreRole = 'GERENTE' | 'VENDEDOR' | 'CAIXA' | 'MANAGER' | 'ADMIN';
type StoreAction = 
  | 'vender'           // Qualquer venda
  | 'vender_crediario' // Vender no fiado
  | 'cancelar_venda'   // Cancelar venda
  | 'ver_relatorios'   // Ver relatórios e dashboard
  | 'ver_financeiro'   // Ver painéis financeiros (DRE, transações, relatórios)
  | 'gerenciar_produtos' // CRUD produtos
  | 'gerenciar_clientes' // CRUD clientes
  | 'gerenciar_estoque'  // Entrada de produtos
  | 'gerenciar_financeiro' // Transações financeiras
  | 'gerenciar_funcionarios' // CRUD funcionários
  | 'configurar_loja' // Configurações da loja
  | 'abrir_caixa'      // Abrir caixa
  | 'fechar_caixa'     // Fechar caixa
  | 'gerenciar_caixa'  // Sangria/suprimento no caixa
  | 'gerenciar_orcamentos' // CRUD orçamentos
  | 'gerenciar_compras'    // Compras/Purchase Orders
  ;

const ROLE_HIERARCHY: Record<string, number> = {
  CAIXA: 1,
  VENDEDOR: 2,
  GERENTE: 10,
  MANAGER: 10,
  ADMIN: 10,
  ADMIN_LOJA: 10,
};

const MIN_ROLE_FOR_ACTION: Record<StoreAction, string> = {
  vender: 'CAIXA',
  vender_crediario: 'VENDEDOR',
  cancelar_venda: 'VENDEDOR',
  ver_relatorios: 'CAIXA',
  ver_financeiro: 'GERENTE',
  gerenciar_produtos: 'GERENTE',
  gerenciar_clientes: 'VENDEDOR',
  gerenciar_estoque: 'VENDEDOR',
  gerenciar_financeiro: 'GERENTE',
  gerenciar_funcionarios: 'GERENTE',
  configurar_loja: 'GERENTE',
  abrir_caixa: 'VENDEDOR',
  fechar_caixa: 'VENDEDOR',
  gerenciar_caixa: 'GERENTE',
  gerenciar_orcamentos: 'VENDEDOR',
  gerenciar_compras: 'VENDEDOR',
};

export function requireStorePermission(action: StoreAction, options?: { maxDiscount?: number; maxValue?: number }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Super Admin impersonating: skip permission check
      if ((req.user as any)?.isImpersonating) return next();

      const userId = req.user?.id;
      const storeId = req.user?.storeId;

      if (!userId || !storeId) {
        return fail(res, 'Usuário ou loja não identificados', 401);
      }

      const access = await prisma.storeUserAccess.findUnique({
        where: { storeId_userId: { storeId, userId } }
      });

      if (!access) {
        return fail(res, 'Acesso negado: você não tem permissão nesta loja', 403);
      }

      const userLevel = ROLE_HIERARCHY[access.role.toUpperCase()] || 0;
      const requiredLevel = ROLE_HIERARCHY[MIN_ROLE_FOR_ACTION[action]];

      if (userLevel < requiredLevel) {
        return fail(res, `Acesso negado: ação "${action}" requer cargo ${MIN_ROLE_FOR_ACTION[action]}`, 403);
      }

      // Verificações específicas
      if (action === 'vender_crediario' && !access.permiteVendaPrazo) {
        return fail(res, 'Acesso negado: você não tem permissão para vendas a prazo', 403);
      }

      if (action === 'vender' && options?.maxDiscount) {
        const body = req.body as any;
        const desconto = Number(body?.valorDesconto || 0);
        const total = Number(body?.itens?.reduce?.((acc: number, i: any) => 
          acc + (Number(i.quantidade) * Number(i.precoUnitarioVendido)), 0) || 0);
        
        const pctDesconto = total > 0 ? (desconto / total) * 100 : 0;
        const maxDiscount = Number(access.limiteDescontoMaximo);
        
        if (maxDiscount > 0 && pctDesconto > maxDiscount) {
          return fail(res, `Desconto máximo permitido: ${maxDiscount}%`, 403);
        }
      }

      if (action === 'vender' && options?.maxValue) {
        const body = req.body as any;
        const valorVenda = body?.itens?.reduce?.((acc: number, i: any) =>
          acc + (Number(i.quantidade) * Number(i.precoUnitarioVendido)), 0) || 0;
        
        if (valorVenda > options.maxValue && access.role === 'CAIXA') {
          return fail(res, `Valor máximo para CAIXA: R$ ${options.maxValue}`, 403);
        }
      }

      next();
    } catch (error) {
      logger.error('Erro no middleware de permissão:', error);
      return fail(res, 'Erro interno ao verificar permissões', 500);
    }
  };
}
