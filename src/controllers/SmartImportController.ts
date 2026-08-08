import { Request, Response } from 'express';
import { logger } from '../lib/logger';
import { SmartImportService } from '../services/SmartImportService';
import { prisma } from '../lib/prisma';
import fs from 'fs';
import { asyncHandler, getStoreId } from '../lib/asyncHandler';

export class SmartImportController {
  static async importSmart(req: Request, res: Response) {
    try {
      const storeId = (req as any).user?.storeId;
      if (!storeId) return res.status(401).json({ error: 'Não autorizado' });

      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
      }

      const result = await SmartImportService.processFile(storeId, req.file.path, req.file.originalname);
      
      // Cleanup
      if (req.file && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }

      return res.status(200).json(result);
    } catch (error: any) {
      if (req.file && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      logger.error('Erro na importação inteligente:', error);
      return res.status(500).json({ error: error.message || 'Erro interno ao processar arquivo.' });
    }
  }
  static hardReset = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);

    // SEGURANÇA: só o dono/gerência da loja (ou super admin) pode apagar dados.
    // O papel real fica em storeUserAccess.role — o req.user.role é o da conta.
    const userId = (req as any).user?.id;
    const role = (req as any).user?.role;
    const isImpersonating = (req as any).user?.isImpersonating;
    const isSuperAdmin = role === 'SUPER_ADMIN';

    if (!isSuperAdmin && !isImpersonating) {
      const access = await prisma.storeUserAccess.findUnique({
        where: { storeId_userId: { storeId, userId } },
        select: { role: true }
      });
      const storeRole = (access?.role || '').toUpperCase();
      const bossRoles = ['OWNER', 'ADMIN', 'ADMIN_LOJA', 'GERENTE', 'MANAGER'];
      if (!bossRoles.includes(storeRole)) {
        return res.status(403).json({ error: 'Sem permissão para resetar. Apenas o dono ou gerência da loja pode executar.' });
      }
    }

    // SEGURANÇA: exige confirmação explícita (como as outras rotas destrutivas)
    if (req.body?.confirmacao !== 'RESETAR') {
      return res.status(400).json({ error: 'Confirme digitando "RESETAR" no campo de confirmação.' });
    }

    // SEGURANÇA: Prisma monta o SQL com parâmetros — o storeId nunca vira parte
    // do comando, então é impossível injetar SQL (mesmo com caracteres estranhos).
    // Ordem de deleção: filhos antes dos pais para respeitar FKs.

    // 1. Itens de vendas (filho de Sale) — apenas vendas DESTA loja
    await prisma.saleItem.deleteMany({
      where: { sale: { storeId } }
    });
    // 2. Vendas
    await prisma.sale.deleteMany({ where: { storeId } });
    // 3. Transações financeiras
    await prisma.financialTransaction.deleteMany({ where: { storeId } });
    // 4. Contas a Pagar e Receber
    await prisma.accountPayable.deleteMany({ where: { storeId } });
    await prisma.accountReceivable.deleteMany({ where: { storeId } });

    // 5. Zerar o Saldo da Carteira (Wallet)
    await prisma.wallet.updateMany({
      where: { storeId },
      data: { saldoAtual: 0 }
    });

    return res.status(200).json({ message: 'Hard Reset concluído com sucesso. O ambiente está limpo.' });
  }, "executar hard reset");
}
