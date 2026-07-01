import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export class PaymentMethodFeeController {
  async list(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const fees = await prisma.paymentMethodFee.findMany({
        where: { storeId },
        orderBy: [{ formaPagamento: 'asc' }, { parcelas: 'asc' }],
      });

      res.json(fees);
    } catch (error: any) {
      console.error('Erro ao listar taxas:', error);
      res.status(500).json({ message: error.message || 'Erro ao listar taxas' });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const { formaPagamento, parcelas, taxaPercentual, taxaFixa, prazoRecebimento } = req.body;

      const existing = await prisma.paymentMethodFee.findUnique({
        where: { storeId_formaPagamento_parcelas: { storeId, formaPagamento, parcelas } }
      });
      if (existing) {
        return res.status(400).json({ message: 'Já existe uma taxa configurada para esta forma de pagamento e parcelas' });
      }

      const fee = await prisma.paymentMethodFee.create({
        data: {
          storeId,
          formaPagamento,
          parcelas: Number(parcelas),
          taxaPercentual: Number(taxaPercentual || 0),
          taxaFixa: Number(taxaFixa || 0),
          prazoRecebimento: Number(prazoRecebimento || 0),
        },
      });

      res.status(201).json(fee);
    } catch (error: any) {
      console.error('Erro ao criar taxa:', error);
      res.status(500).json({ message: error.message || 'Erro ao criar taxa' });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const { id } = req.params;
      const { taxaPercentual, taxaFixa, prazoRecebimento, parcelas, formaPagamento } = req.body;

      const fee = await prisma.paymentMethodFee.findFirst({
        where: { id: String(id), storeId }
      });
      if (!fee) return res.status(404).json({ message: 'Taxa não encontrada' });

      const updated = await prisma.paymentMethodFee.update({
        where: { id: String(id) },
        data: {
          taxaPercentual: taxaPercentual !== undefined ? Number(taxaPercentual) : undefined,
          taxaFixa: taxaFixa !== undefined ? Number(taxaFixa) : undefined,
          prazoRecebimento: prazoRecebimento !== undefined ? Number(prazoRecebimento) : undefined,
          parcelas: parcelas !== undefined ? Number(parcelas) : undefined,
          formaPagamento: formaPagamento !== undefined ? formaPagamento : undefined,
        },
      });

      res.json(updated);
    } catch (error: any) {
      console.error('Erro ao atualizar taxa:', error);
      res.status(500).json({ message: error.message || 'Erro ao atualizar taxa' });
    }
  }

  async remove(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const { id } = req.params;
      const fee = await prisma.paymentMethodFee.findFirst({
        where: { id: String(id), storeId }
      });
      if (!fee) return res.status(404).json({ message: 'Taxa não encontrada' });

      await prisma.paymentMethodFee.delete({ where: { id: String(id) } });

      res.json({ message: 'Taxa removida com sucesso' });
    } catch (error: any) {
      console.error('Erro ao remover taxa:', error);
      res.status(500).json({ message: error.message || 'Erro ao remover taxa' });
    }
  }
}
