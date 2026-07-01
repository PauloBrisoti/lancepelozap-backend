import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export class SupplierController {
  async list(req: Request, res: Response) {
    try {
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
    } catch (error: any) {
      console.error('Erro ao listar fornecedores:', error);
      res.status(500).json({ message: error.message || 'Erro interno' });
    }
  }

  async getById(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const id = req.params.id as string;
      const supplier = await prisma.supplier.findFirst({ where: { id, storeId } });
      if (!supplier) return res.status(404).json({ message: 'Fornecedor não encontrado' });

      res.json(supplier);
    } catch (error: any) {
      console.error('Erro ao buscar fornecedor:', error);
      res.status(500).json({ message: error.message || 'Erro interno' });
    }
  }

  async create(req: Request, res: Response) {
    try {
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
    } catch (error: any) {
      console.error('Erro ao criar fornecedor:', error);
      res.status(500).json({ message: error.message || 'Erro interno' });
    }
  }

  async update(req: Request, res: Response) {
    try {
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
    } catch (error: any) {
      console.error('Erro ao atualizar fornecedor:', error);
      res.status(500).json({ message: error.message || 'Erro interno' });
    }
  }

  async remove(req: Request, res: Response) {
    try {
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
    } catch (error: any) {
      console.error('Erro ao remover fornecedor:', error);
      res.status(500).json({ message: error.message || 'Erro interno' });
    }
  }
}
