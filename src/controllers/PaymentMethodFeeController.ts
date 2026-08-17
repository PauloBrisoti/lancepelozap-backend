import { Request, Response } from 'express';
import { asyncHandler } from "../lib/asyncHandler";
import { prisma } from '../lib/prisma';

export class PaymentMethodFeeController {
  list = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const fees = await prisma.paymentMethodFee.findMany({
        where: { storeId },
        orderBy: [{ formaPagamento: 'asc' }, { parcelas: 'asc' }],
      });

      res.json(fees);
    
  }, "listar");

  create = asyncHandler(async (req: Request, res: Response) => {
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
    
  }, "criar");

  update = asyncHandler(async (req: Request, res: Response) => {
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
    
  }, "atualizar");

  remove = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const { id } = req.params;
      const fee = await prisma.paymentMethodFee.findFirst({
        where: { id: String(id), storeId }
      });
      if (!fee) return res.status(404).json({ message: 'Taxa não encontrada' });

      await prisma.paymentMethodFee.delete({ where: { id: String(id) } });

      res.json({ message: 'Taxa removida com sucesso' });
    
  }, "remover");
}
