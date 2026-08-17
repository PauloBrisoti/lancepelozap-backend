import { Request, Response } from 'express';
import { asyncHandler } from "../lib/asyncHandler";
import { prisma } from '../lib/prisma';

export class SupplierController {
  list = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const status = req.query.status as string | undefined;
      const search = req.query.search as string | undefined;
      const where: any = { storeId };
      if (status) where.status = status;
      if (search) {
        where.OR = [
          { nome: { contains: search, mode: 'insensitive' } },
          { cnpjCpf: { contains: search } },
          { telefone: { contains: search } },
        ];
      }

      const suppliers = await prisma.supplier.findMany({
        where,
        orderBy: { nome: 'asc' },
      });

      res.json(suppliers);
    
  }, "listar");

  getById = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const id = req.params.id as string;
      const supplier = await prisma.supplier.findFirst({ where: { id, storeId } });
      if (!supplier) return res.status(404).json({ message: 'Fornecedor não encontrado' });

      res.json(supplier);
    
  }, "obter by id");

  create = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const { nome, tipoPessoa, cnpjCpf, ieRg, telefone, email, cep, endereco, observacoes } = req.body;
      if (!nome) return res.status(400).json({ message: 'Nome é obrigatório' });

      const supplier = await prisma.supplier.create({
        data: {
          storeId,
          nome,
          tipoPessoa: tipoPessoa || 'PJ',
          cnpjCpf, ieRg, telefone, email, cep, endereco, observacoes,
        },
      });

      res.status(201).json(supplier);
    
  }, "criar");

  update = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const id = req.params.id as string;
      const existing = await prisma.supplier.findFirst({ where: { id, storeId } });
      if (!existing) return res.status(404).json({ message: 'Fornecedor não encontrado' });

      const { nome, tipoPessoa, cnpjCpf, ieRg, telefone, email, cep, endereco, observacoes, status } = req.body;

      const updated = await prisma.supplier.update({
        where: { id },
        data: {
          nome: nome ?? undefined,
          tipoPessoa: tipoPessoa ?? undefined,
          cnpjCpf: cnpjCpf ?? undefined,
          ieRg: ieRg ?? undefined,
          telefone: telefone ?? undefined,
          email: email ?? undefined,
          cep: cep ?? undefined,
          endereco: endereco ?? undefined,
          observacoes: observacoes ?? undefined,
          status: status ?? undefined,
        },
      });

      res.json(updated);
    
  }, "atualizar");

  remove = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const id = req.params.id as string;
      const existing = await prisma.supplier.findFirst({ where: { id, storeId } });
      if (!existing) return res.status(404).json({ message: 'Fornecedor não encontrado' });

      const orderCount = await prisma.purchaseOrder.count({ where: { supplierId: id } });
      if (orderCount > 0) {
        return res.status(400).json({
          message: `Fornecedor possui ${orderCount} pedido(s) de compra. Remova os vínculos antes de excluir.`,
        });
      }

      await prisma.supplier.delete({ where: { id } });
      res.json({ message: 'Fornecedor removido com sucesso' });
    
  }, "remover");
}
