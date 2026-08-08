import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { toZonedTime } from 'date-fns-tz';
import { getTimezone } from '../lib/dateUtils';
import jwt from 'jsonwebtoken';
import { asyncHandler } from "../lib/asyncHandler";
import { getJwtSecret } from '../lib/jwt';

/**
 * Portal do cliente — sessão curta no lugar de token na URL.
 *
 * SEGURANÇA: o portalToken do cliente NUNCA deveria aparecer na URL (vaza em
 * histórico do navegador, logs de proxy e header Referer). O fluxo é:
 *   1. O cliente abre o link com o token (vindo do WhatsApp/e-mail)
 *   2. O frontend troca o token por uma SESSÃO de 30 minutos (POST /session)
 *   3. A URL é limpa e as próximas chamadas usam o header Authorization
 */
export class CustomerPortalController {
  private readonly SESSION_TTL_SECONDS = 30 * 60; // 30 minutos

  /** Troca o portalToken (link permanente ou assinado) por uma sessão curta. */
  createSession = asyncHandler(async (req: Request, res: Response) => {
      const { token } = req.body || {};
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ message: 'Token ausente' });
      }

      const customerSelect = {
        id: true, nomeCompleto: true, cpf: true, telefoneWhatsapp: true,
        email: true, enderecoCompleto: true, cep: true, dataNascimento: true,
      } as const;

      // 1) Link assinado (gerado pelo sistema — expira em 24h, não fica no banco)
      let customer = null;
      try {
        const payload = jwt.verify(token, getJwtSecret()) as { type?: string; customerId?: string };
        if (payload.type === 'PORTAL_LINK' && payload.customerId) {
          customer = await prisma.customer.findUnique({
            where: { id: payload.customerId },
            select: customerSelect,
          });
        }
      } catch {
        // token inválido ou expirado — tenta o fallback abaixo
      }

      // 2) Fallback: token permanente gravado no banco (links antigos)
      if (!customer) {
        customer = await prisma.customer.findUnique({
          where: { portalToken: token },
          select: customerSelect,
        });
      }

      if (!customer) return res.status(404).json({ message: 'Link inválido ou expirado' });

      // Sessão curta: expira em 30 min e só serve para o portal
      const sessionToken = jwt.sign(
        { type: 'PORTAL_SESSION', customerId: customer.id },
        getJwtSecret(),
        { expiresIn: this.SESSION_TTL_SECONDS }
      );

      return res.json({ sessionToken, customer });
    
  }, "criar session");

  /** Lê a sessão do header Authorization e devolve o cliente, ou null. */
  private async getSessionCustomer(req: Request) {
    const header = req.headers.authorization || '';
    const sessionToken = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!sessionToken) return null;

    try {
      const payload = jwt.verify(sessionToken, getJwtSecret()) as { type?: string; customerId?: string };
      if (payload.type !== 'PORTAL_SESSION' || !payload.customerId) return null;
      return await prisma.customer.findUnique({
        where: { id: payload.customerId },
        select: {
          id: true, nomeCompleto: true, cpf: true, telefoneWhatsapp: true,
          email: true, enderecoCompleto: true, cep: true, dataNascimento: true,
        },
      });
    } catch {
      return null;
    }
  }

  getProfile = asyncHandler(async (req: Request, res: Response) => {
      const customer = await this.getSessionCustomer(req);
      if (!customer) return res.status(401).json({ message: 'Sessão inválida ou expirada' });
      res.json(customer);
    
  }, "obter perfil");

  updateProfile = asyncHandler(async (req: Request, res: Response) => {
      const session = await this.getSessionCustomer(req);
      if (!session) return res.status(401).json({ message: 'Sessão inválida ou expirada' });

      const { nomeCompleto, email, enderecoCompleto, cep, dataNascimento } = req.body;
      const updated = await prisma.customer.update({
        where: { id: session.id },
        data: { nomeCompleto, email, enderecoCompleto, cep, dataNascimento },
        select: { id: true, nomeCompleto: true, email: true, enderecoCompleto: true, cep: true },
      });
      res.json(updated);
    
  }, "atualizar perfil");

  getSales = asyncHandler(async (req: Request, res: Response) => {
      const customer = await this.getSessionCustomer(req);
      if (!customer) return res.status(401).json({ message: 'Sessão inválida ou expirada' });

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
    
  }, "obter vendas");

  getReceivables = asyncHandler(async (req: Request, res: Response) => {
      const customer = await this.getSessionCustomer(req);
      if (!customer) return res.status(401).json({ message: 'Sessão inválida ou expirada' });

      const hoje = toZonedTime(new Date(), getTimezone());
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
    
  }, "obter receivables");
}
