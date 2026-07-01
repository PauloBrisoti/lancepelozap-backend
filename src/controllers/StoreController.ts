import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { ok, fail } from '../lib/response';

export class StoreController {

  async listMyStores(req: Request, res: Response) {
    try {
      const clientId = req.user?.clientId;
      if (!clientId) return fail(res, 'Cliente não identificado', 401);

      const controls = await prisma.control.findMany({
        where: { clientId },
        include: {
          stores: {
            include: {
              _count: { select: { storeUsers: true, products: true, sales: true } }
            }
          }
        }
      });

      return ok(res, controls);
    } catch (error) {
      console.error('Erro ao listar lojas:', error);
      return fail(res, 'Erro ao listar lojas', 500);
    }
  }

  async createStore(req: Request, res: Response) {
    try {
      const clientId = req.user?.clientId;
      const userId = req.user?.id;
      if (!clientId || !userId) return fail(res, 'Cliente não identificado', 401);

      const { nomeFantasia, controlId, cnpjCpf, nichoPrincipal, telefoneWhatsapp, emailContato, chavePix } = req.body;

      if (!nomeFantasia || !controlId) {
        return fail(res, 'Campos obrigatórios: nomeFantasia, controlId', 400);
      }

      // Verificar se o control pertence ao cliente
      const control = await prisma.control.findFirst({
        where: { id: controlId, clientId }
      });

      if (!control) {
        return fail(res, 'Controle não encontrado ou não pertence a este cliente', 404);
      }

      // Validar limite do plano
      const sub = await prisma.subscription.findFirst({
        where: { clientId, statusPagamento: { in: ['PAGO', 'PENDENTE', 'TRIAL'] } },
        include: { plan: true }
      });

      if (sub) {
        const storeCount = await prisma.store.count({ where: { controlId } });
        if (storeCount >= sub.plan.maxStores) {
          return fail(res, `Limite de ${sub.plan.maxStores} lojas por controle atingido. Faça upgrade do plano.`, 403);
        }
      }

      const store = await prisma.store.create({
        data: {
          controlId,
          nomeFantasia,
          cnpjCpf: cnpjCpf || null,
          nichoPrincipal: nichoPrincipal || null,
          telefoneWhatsapp: telefoneWhatsapp || null,
          emailContato: emailContato || null,
          chavePix: chavePix || null,
          status: 'ATIVO',
          storeUsers: {
            create: {
              userId,
              role: 'GERENTE',
              permiteVendaPrazo: true,
              limiteDescontoMaximo: 100,
            }
          }
        },
        include: {
          _count: { select: { storeUsers: true, products: true, sales: true } }
        }
      });

      // Registrar auditoria
      await prisma.auditLog.create({
        data: {
          storeId: store.id,
          userId,
          acao: 'CRIAR_LOJA',
          tabelaAfetada: 'stores',
          dadosNovos: { nomeFantasia, controlId, clientId }
        }
      });

      return ok(res, store, 201);
    } catch (error) {
      console.error('Erro ao criar loja:', error);
      return fail(res, 'Erro ao criar loja', 500);
    }
  }

  async updateStore(req: Request, res: Response) {
    try {
      const clientId = req.user?.clientId as string;
      const storeId = req.params.id as string;
      const userId = req.user?.id as string;
      if (!clientId || !userId || !storeId) return fail(res, 'Cliente ou loja não identificado', 401);

      const store = await prisma.store.findFirst({
        where: { id: storeId, control: { clientId } }
      });

      if (!store) return fail(res, 'Loja não encontrada', 404);

      const body = req.body as Record<string, string | undefined>;
      const nomeFantasia = body.nomeFantasia;
      const cnpjCpf = body.cnpjCpf;
      const nichoPrincipal = body.nichoPrincipal;
      const telefoneWhatsapp = body.telefoneWhatsapp;
      const emailContato = body.emailContato;
      const chavePix = body.chavePix;
      const status = body.status;

      const updated = await prisma.store.update({
        where: { id: storeId },
        data: {
          nomeFantasia: nomeFantasia ?? store.nomeFantasia,
          cnpjCpf: cnpjCpf ?? store.cnpjCpf,
          nichoPrincipal: nichoPrincipal ?? store.nichoPrincipal,
          telefoneWhatsapp: telefoneWhatsapp ?? store.telefoneWhatsapp,
          emailContato: emailContato ?? store.emailContato,
          chavePix: chavePix ?? store.chavePix,
          status: status ?? store.status,
        }
      });

      await prisma.auditLog.create({
        data: {
          storeId, userId,
          acao: 'ATUALIZAR_LOJA',
          tabelaAfetada: 'stores',
          dadosAntigos: { nomeFantasia: store.nomeFantasia, status: store.status },
          dadosNovos: { nomeFantasia, cnpjCpf, nichoPrincipal, telefoneWhatsapp, emailContato, chavePix, status }
        }
      });

      return ok(res, updated);
    } catch (error) {
      console.error('Erro ao atualizar loja:', error);
      return fail(res, 'Erro ao atualizar loja', 500);
    }
  }
}
