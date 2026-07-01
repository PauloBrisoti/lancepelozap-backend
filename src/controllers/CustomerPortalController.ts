import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export class CustomerPortalController {
  async getProfile(req: Request, res: Response) {
    try {
      const token = req.params.token as string;
      const customer = await prisma.customer.findUnique({
        where: { portalToken: token },
        select: {
          id: true, nomeCompleto: true, cpf: true, telefoneWhatsapp: true,
          email: true, enderecoCompleto: true, cep: true, dataNascimento: true,
        },
      });
      if (!customer) return res.status(404).json({ message: 'Link inválido ou expirado' });
      res.json(customer);
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Erro ao carregar perfil' });
    }
  }

  async updateProfile(req: Request, res: Response) {
    try {
      const token = req.params.token as string;
      const customer = await prisma.customer.findUnique({ where: { portalToken: token } });
      if (!customer) return res.status(404).json({ message: 'Link inválido' });

      const { nomeCompleto, email, enderecoCompleto, cep, dataNascimento } = req.body;
      const updated = await prisma.customer.update({
        where: { id: customer.id },
        data: { nomeCompleto, email, enderecoCompleto, cep, dataNascimento },
        select: { id: true, nomeCompleto: true, email: true, enderecoCompleto: true, cep: true },
      });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Erro ao atualizar perfil' });
    }
  }

  async getSales(req: Request, res: Response) {
    try {
      const token = req.params.token as string;
      const customer = await prisma.customer.findUnique({ where: { portalToken: token } });
      if (!customer) return res.status(404).json({ message: 'Link inválido' });

      const sales = await prisma.sale.findMany({
        where: { customerId: customer.id, status: 'FINALIZADA' },
        orderBy: { dataVenda: 'desc' },
        select: {
          id: true, dataVenda: true, valorTotalBruto: true, valorDesconto: true,
          valorTotalLiquido: true, formaPagamento: true,
          saleItems: {
            select: { quantidade: true, precoUnitarioVendido: true, product: { select: { nome: true } } },
          },
        },
      });
      res.json(sales);
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Erro ao carregar compras' });
    }
  }

  async getReceivables(req: Request, res: Response) {
    try {
      const token = req.params.token as string;
      const customer = await prisma.customer.findUnique({ where: { portalToken: token } });
      if (!customer) return res.status(404).json({ message: 'Link inválido' });

      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      const receivables = await prisma.accountReceivable.findMany({
        where: { customerId: customer.id, status: { not: 'CANCELADA' } },
        orderBy: { dataVencimento: 'asc' },
        select: {
          id: true, dataVencimento: true, valorParcela: true, numeroParcela: true,
          totalParcelas: true, status: true, formaPagamentoEsperada: true,
          sale: { select: { id: true, dataVenda: true } },
          payments: {
            where: { tipo: 'ENTRADA', status: 'ATIVA' },
            select: { valor: true }
          }
        },
      });

      const enriched = receivables.map(r => {
        const totalPago = r.payments.reduce((s, p) => s + Number(p.valor), 0);
        const valorOriginal = Number(r.valorParcela);
        const saldoRestante = Math.max(0, valorOriginal - totalPago);
        const vencido = new Date(r.dataVencimento) < hoje && saldoRestante > 0;

        let statusExibicao: string;
        if (saldoRestante === 0) {
          statusExibicao = 'PAGO';
        } else if (totalPago > 0) {
          statusExibicao = 'PAGO_PARCIAL';
        } else if (vencido) {
          statusExibicao = 'VENCIDO';
        } else {
          statusExibicao = 'PENDENTE';
        }

        return {
          id: r.id, dataVencimento: r.dataVencimento, valorParcela: r.valorParcela,
          numeroParcela: r.numeroParcela, totalParcelas: r.totalParcelas,
          valorJaPago: totalPago, saldoRestante, statusExibicao,
          status: statusExibicao,
          formaPagamentoEsperada: r.formaPagamentoEsperada,
          sale: r.sale,
        };
      });

      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Erro ao carregar pendências' });
    }
  }
}
