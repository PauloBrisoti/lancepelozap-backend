import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { isValidCPF } from "../utils/cpfValidator";
import { randomUUID } from 'crypto';

export async function listCustomers(req: Request, res: Response) {
  try {
    // @ts-ignore - storeId vem do token decodificado pelo middleware
    const storeId = req.user?.storeId as string;

    if (!storeId) {
      return res.status(401).json({ error: "Tenant não identificado." });
    }

    const customers = await prisma.customer.findMany({
      where: { storeId },
      orderBy: { nomeCompleto: "asc" },
      include: {
        receivables: {
          where: { status: { not: 'CANCELADA' } },
          include: {
            payments: {
              where: { tipo: 'ENTRADA', status: 'ATIVA' },
              select: { valor: true }
            }
          }
        }
      }
    });

    const customersWithSaldo = customers.map(c => {
      const saldoDevedor = c.receivables.reduce((sum, r) => {
        const totalPago = r.payments.reduce((s, p) => s + Number(p.valor), 0);
        return sum + Math.max(0, Number(r.valorParcela) - totalPago);
      }, 0);
      const { receivables, ...rest } = c;
      return { ...rest, saldoDevedor };
    });

    return res.json(customersWithSaldo);
  } catch (error: any) {
    console.error("Erro ao listar clientes:", error);
    return res.status(500).json({ error: "Erro interno ao listar clientes." });
  }
}

export async function createCustomer(req: Request, res: Response) {
  try {
    // @ts-ignore
    const storeId = req.user?.storeId as string;
    if (!storeId) {
      return res.status(401).json({ error: "Tenant não identificado." });
    }

    const { nomeCompleto, cpf, telefoneWhatsapp, cep, enderecoCompleto, email, rg, dataNascimento, observacoes, aceitaMarketing, aceitaLembreteCobranca } = req.body;

    if (!nomeCompleto) {
      return res.status(400).json({ error: "O nome completo é obrigatório." });
    }

    // CPF e Telefone são opcionais, mas se informados, são validados
    if (cpf) {
      if (!isValidCPF(cpf)) {
        return res.status(400).json({ error: "CPF inválido." });
      }
      const existing = await prisma.customer.findFirst({
        where: { storeId, cpf }
      });
      if (existing) {
        return res.status(400).json({ error: "Já existe um cliente com este CPF." });
      }
    }

    const newCustomer = await prisma.customer.create({
      data: {
        storeId,
        nomeCompleto,
        cpf: cpf || null,
        telefoneWhatsapp: telefoneWhatsapp || null,
        cep: cep || null,
        enderecoCompleto: enderecoCompleto || null,
        email: email || null,
        rg: rg || null,
        dataNascimento: dataNascimento || null,
        observacoes: observacoes || null,
        aceitaMarketing: aceitaMarketing ?? true,
        aceitaLembreteCobranca: aceitaLembreteCobranca ?? true,
      },
    });

    return res.status(201).json(newCustomer);
  } catch (error: any) {
    console.error("Erro ao criar cliente:", error);
    return res.status(500).json({ error: "Erro interno ao criar cliente." });
  }
}

export async function updateCustomer(req: Request, res: Response) {
  try {
    // @ts-ignore
    const storeId = req.user?.storeId as string;
    const id = req.params.id as string;
    
    const { nomeCompleto, cpf, telefoneWhatsapp, cep, enderecoCompleto, email, rg, dataNascimento, observacoes, aceitaMarketing, aceitaLembreteCobranca } = req.body;

    // Garante que o cliente pertence ao tenant atual
    const customer = await prisma.customer.findFirst({
      where: { id, storeId },
    });

    if (!customer) {
      return res.status(404).json({ error: "Cliente não encontrado." });
    }

    if (cpf) {
      if (!isValidCPF(cpf)) {
        return res.status(400).json({ error: "CPF inválido." });
      }
      if (cpf !== customer.cpf) {
        const existing = await prisma.customer.findFirst({
          where: { storeId, cpf }
        });
        if (existing) {
          return res.status(400).json({ error: "Já existe outro cliente com este CPF." });
        }
      }
    }

    const updatedCustomer = await prisma.customer.update({
      where: { id },
      data: {
        nomeCompleto,
        cpf: cpf || null,
        telefoneWhatsapp: telefoneWhatsapp || null,
        cep: cep || null,
        enderecoCompleto: enderecoCompleto || null,
        aceitaMarketing: aceitaMarketing ?? customer.aceitaMarketing,
        aceitaLembreteCobranca: aceitaLembreteCobranca ?? customer.aceitaLembreteCobranca,
      },
    });

    return res.json(updatedCustomer);
  } catch (error: any) {
    console.error("Erro ao atualizar cliente:", error);
    return res.status(500).json({ error: "Erro interno ao atualizar cliente." });
  }
}

export async function generatePortalToken(req: Request, res: Response) {
  try {
    const storeId = req.user?.storeId as string;
    const id = req.params.id as string;

    const customer = await prisma.customer.findFirst({ where: { id, storeId } });
    if (!customer) return res.status(404).json({ error: "Cliente não encontrado." });

    const token = randomUUID();
    await prisma.customer.update({
      where: { id },
      data: { portalToken: token },
    });

    const portalUrl = `${req.protocol}://${req.get('host')}/portal/${token}`;
    res.json({ portalToken: token, portalUrl, nome: customer.nomeCompleto });
  } catch (error: any) {
    console.error("Erro ao gerar token do portal:", error);
    res.status(500).json({ error: "Erro ao gerar link do portal." });
  }
}

export async function deleteCustomer(req: Request, res: Response) {
  try {
    // @ts-ignore
    const storeId = req.user?.storeId as string;
    const id = req.params.id as string;

    const customer = await prisma.customer.findFirst({
      where: { id, storeId },
    });

    if (!customer) {
      return res.status(404).json({ error: "Cliente não encontrado." });
    }

    await prisma.customer.delete({
      where: { id },
    });

    return res.json({ message: "Cliente excluído com sucesso." });
  } catch (error: any) {
    console.error("Erro ao excluir cliente:", error);
    
    // Erro de foreign key, ex: cliente tem vendas atreladas
    if (error.code === 'P2003') {
      return res.status(400).json({ error: "Não é possível excluir este cliente pois existem vendas atreladas a ele." });
    }

    return res.status(500).json({ error: "Erro interno ao excluir cliente." });
  }
}
