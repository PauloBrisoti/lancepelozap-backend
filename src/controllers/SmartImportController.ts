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

      // Deletar as transações financeiras
      await prisma.financialTransaction.deleteMany({ where: { storeId } });
      
      // Deletar Contas a Pagar e Receber
      await prisma.accountPayable.deleteMany({ where: { storeId } });
      await prisma.accountReceivable.deleteMany({ where: { storeId } });

      // Deletar itens da venda e depois as vendas
      await prisma.saleItem.deleteMany({ where: { sale: { storeId } } });
      await prisma.sale.deleteMany({ where: { storeId } });

      // Zerar o Saldo da Carteira (Wallet)
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
