import { Request, Response } from 'express';
import { SmartImportService } from '../services/SmartImportService';
import fs from 'fs';

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
      console.error('Erro na importação inteligente:', error);
      return res.status(500).json({ error: error.message || 'Erro interno ao processar arquivo.' });
    }
  }
  static async hardReset(req: Request, res: Response) {
    try {
      const storeId = (req as any).user?.storeId;
      if (!storeId) return res.status(401).json({ error: 'Não autorizado' });

      const { prisma } = await import('../lib/prisma');

      // Ordem de deleção: filhos antes dos pais para respeitar FKs.
      // Usamos $executeRaw para contornar bug do @prisma/adapter-pg que gera
      // erro P2021 (TableDoesNotExist) ao gerar SQL de delete com triggers internas.
      const safeStoreId = storeId.replace(/'/g, "''");

      // 1. Itens de vendas (filho de Sale)
      await prisma.$executeRawUnsafe(
        `DELETE FROM sale_items WHERE "sale_id" IN (SELECT id FROM sales WHERE store_id = '${safeStoreId}')`
      );
      // 2. Vendas (pai de SaleItem, referenciado por FinancialTransaction)
      await prisma.$executeRawUnsafe(
        `DELETE FROM sales WHERE store_id = '${safeStoreId}'`
      );
      // 3. Transações financeiras
      await prisma.$executeRawUnsafe(
        `DELETE FROM financial_transactions WHERE store_id = '${safeStoreId}'`
      );
      // 4. Contas a Pagar e Receber
      await prisma.accountPayable.deleteMany({ where: { storeId } });
      await prisma.accountReceivable.deleteMany({ where: { storeId } });

      // 5. Zerar o Saldo da Carteira (Wallet)
      await prisma.wallet.updateMany({
        where: { storeId },
        data: { saldoAtual: 0 }
      });

      return res.status(200).json({ message: 'Hard Reset concluído com sucesso. O ambiente está limpo.' });
    } catch (error: any) {
      console.error('Erro no Hard Reset:', error);
      return res.status(500).json({ error: error.message || 'Erro interno ao resetar.' });
    }
  }
}
