import { Request, Response } from 'express';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/asyncHandler';

export class SupportTicketController {
  
  // =====================================
  // LOJISTAS
  // =====================================
  
  // Criar um novo chamado
  createTicket = asyncHandler(async (req: Request, res: Response) => {
    const { assunto, prioridade, descricao } = req.body;
    const storeId = req.user?.storeId as string;
    const anexoUrl = req.file ? `/uploads/${req.file.filename}` : null;
    
    if (!storeId) return res.status(403).json({ error: 'Acesso negado' });
    if (!assunto || !prioridade) return res.status(400).json({ error: 'Assunto e prioridade são obrigatórios' });

    const ticket = await prisma.$transaction(async (tx) => {
      const newTicket = await tx.supportTicket.create({
        data: {
          storeId,
          assunto,
          prioridade,
          status: 'ABERTO'
        }
      });

      if (descricao) {
        await tx.ticketMessage.create({
          data: {
            ticketId: newTicket.id,
            remetente: 'CLIENTE',
            mensagem: descricao,
            urlAnexoStorage: anexoUrl
          }
        });
      }

      return newTicket;
    });

    // Enviar notificação por email
    try {
      const { prisma } = await import('../lib/prisma');
      const store = await prisma.store.findUnique({ where: { id: storeId } });
      if (store) {
        const { sendNewTicketNotification } = await import('../services/email.service');
        await sendNewTicketNotification(store.nomeFantasia, assunto, ticket.id);
      }
    } catch (err) {
      logger.error('Erro ao enviar notificação de chamado:', err);
    }

    return res.status(201).json(ticket);
  }, "criar chamado");

  // Lojista lista os próprios chamados
  listMyTickets = asyncHandler(async (req: Request, res: Response) => {
    const storeId = req.user?.storeId as string;
    if (!storeId) return res.status(403).json({ error: 'Acesso negado' });

    const tickets = await prisma.supportTicket.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
      include: {
        messages: { orderBy: { createdAt: 'asc' } }
      }
    });

    return res.json(tickets);
  }, "listar chamados");

  // =====================================
  // SUPER ADMIN
  // =====================================

  // Lista TODOS os chamados (Admin)
  listAllTickets = asyncHandler(async (req: Request, res: Response) => {
    if (req.user?.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Apenas Super Admin' });

    const tickets = await prisma.supportTicket.findMany({
      orderBy: [
        { status: 'asc' }, // ABERTO primeiro
        { createdAt: 'desc' }
      ],
      include: {
        store: { select: { nomeFantasia: true } },
        messages: { orderBy: { createdAt: 'asc' } }
      }
    });

    return res.json(tickets);
  }, "listar todos os chamados");

  // Atualizar status do chamado
  updateTicketStatus = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { status } = req.body;
    
    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado' });

    if (req.user?.role !== 'SUPER_ADMIN') {
      if (ticket.storeId !== req.user?.storeId) {
        return res.status(403).json({ error: 'Acesso negado a este chamado' });
      }
      if (status !== 'ABERTO' && status !== 'FECHADO') {
        return res.status(403).json({ error: 'Operação não permitida para o lojista' });
      }
    }

    const updatedTicket = await prisma.supportTicket.update({
      where: { id },
      data: { status }
    });

    return res.json(updatedTicket);
  }, "atualizar status");

  // =====================================
  // COMUM (Responder Chamado)
  // =====================================
  
  replyTicket = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { mensagem } = req.body;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!mensagem) return res.status(400).json({ error: 'Mensagem obrigatória' });

    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado' });

    // Se for lojista, garantir que o chamado é dele
    if (!isSuperAdmin && ticket.storeId !== req.user?.storeId) {
      return res.status(403).json({ error: 'Acesso negado a este chamado' });
    }

    const message = await prisma.ticketMessage.create({
      data: {
        ticketId: id,
        mensagem,
        remetente: isSuperAdmin ? 'SUPORTE' : 'CLIENTE'
      }
    });

    // Atualiza o status se for o suporte respondendo um chamado novo
    if (isSuperAdmin && ticket.status === 'ABERTO') {
      await prisma.supportTicket.update({
        where: { id },
        data: { status: 'EM_ATENDIMENTO' }
      });
    }

    return res.status(201).json(message);
  }, "enviar mensagem");
}
