import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { parseDate } from '../lib/dateUtils';
import { asyncHandler, getStoreId } from '../lib/asyncHandler';
import { findOwnedOrThrow, transitionStatus } from '../lib/statusTransition';
import { rejectUnknownFields } from '../lib/bodyValidation';

export class AppointmentController {
  // ==================== PROFESSIONALS ====================

  listProfessionals = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const professionals = await prisma.professional.findMany({
      where: { storeId },
      orderBy: { nome: 'asc' },
    });
    res.json(professionals);
  }, "listar profissionais");

  createProfessional = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const { nome, telefone, cor, cargo, comissaoPercentual } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });

    const prof = await prisma.professional.create({
      data: { storeId, nome, telefone, cor, cargo, comissaoPercentual: comissaoPercentual || 0 },
    });
    res.status(201).json(prof);
  }, "criar profissional");

  updateProfessional = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const id = req.params.id as string;
    await findOwnedOrThrow(prisma.professional, id, storeId, 'Profissional não encontrado');

    // SEGURANÇA: allow-list explícita + rejeição de campos desconhecidos.
    // Nada além destes campos pode ser alterado (storeId, timestamps etc. são do servidor).
    const extra = rejectUnknownFields(req.body, ['nome', 'telefone', 'cor', 'cargo', 'comissaoPercentual', 'ativo']);
    if (extra) return res.status(400).json({ error: `Campos não permitidos: ${extra.join(', ')}` });

    const { nome, telefone, cor, cargo, comissaoPercentual, ativo } = req.body;
    const data: Record<string, unknown> = {};

    if (nome !== undefined) {
      if (typeof nome !== 'string' || !nome.trim()) return res.status(400).json({ error: 'Nome inválido' });
      data.nome = nome.trim();
    }
    if (telefone !== undefined) data.telefone = typeof telefone === 'string' ? telefone : String(telefone);
    if (cor !== undefined) data.cor = typeof cor === 'string' ? cor : String(cor);
    if (cargo !== undefined) data.cargo = typeof cargo === 'string' ? cargo : String(cargo);
    if (comissaoPercentual !== undefined) {
      const v = Number(comissaoPercentual);
      if (!Number.isFinite(v) || v < 0 || v > 100) {
        return res.status(400).json({ error: 'Comissão deve ser um número entre 0 e 100' });
      }
      data.comissaoPercentual = v;
    }
    if (ativo !== undefined) {
      if (typeof ativo !== 'boolean') return res.status(400).json({ error: 'ativo deve ser booleano' });
      data.ativo = ativo;
    }

    const updated = await prisma.professional.update({ where: { id }, data });
    res.json(updated);
  }, "atualizar profissional");

  deleteProfessional = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const id = req.params.id as string;
    await findOwnedOrThrow(prisma.professional, id, storeId, 'Profissional não encontrado');

    await prisma.professional.delete({ where: { id } });
    res.json({ message: 'Profissional excluído' });
  }, "excluir profissional");

  // ==================== APPOINTMENTS ====================

  list = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const { data, professionalId, status } = req.query;

    const where: any = { storeId };
    if (data) {
      const day = new Date(data as string);
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
      const end = new Date(start.getTime() + 86400000);
      where.data = { gte: start, lt: end };
    }
    if (professionalId) where.professionalId = professionalId as string;
    if (status) where.status = status as string;

    const appointments = await prisma.appointment.findMany({
      where,
      orderBy: { data: 'asc' },
      include: {
        customer: { select: { id: true, nomeCompleto: true, telefoneWhatsapp: true } },
        professional: { select: { id: true, nome: true, cor: true } },
      },
    });

    res.json(appointments);
  }, "listar agendamentos");

  getById = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const id = req.params.id as string;

    const appointment = await findOwnedOrThrow(
      prisma.appointment,
      id,
      storeId,
      'Agendamento não encontrado',
      {
        customer: { select: { id: true, nomeCompleto: true, telefoneWhatsapp: true } },
        professional: { select: { id: true, nome: true, cor: true } },
      },
    );

    res.json(appointment);
  }, "buscar agendamento");

  create = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const { customerId, professionalId, data, duracaoMinutos, servico, observacoes, valorCobrado } = req.body;

    if (!customerId || !data) {
      return res.status(400).json({ error: 'Cliente e data/hora são obrigatórios' });
    }

    const appointment = await prisma.appointment.create({
      data: {
        storeId, customerId, professionalId: professionalId || null,
        data: parseDate(data) || new Date(),
        duracaoMinutos: duracaoMinutos || 60,
        servico, observacoes, valorCobrado: valorCobrado || 0,
      },
      include: {
        customer: { select: { id: true, nomeCompleto: true } },
        professional: { select: { id: true, nome: true } },
      },
    });

    res.status(201).json(appointment);
  }, "criar agendamento");

  update = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const id = req.params.id as string;

    await findOwnedOrThrow(prisma.appointment, id, storeId, 'Agendamento não encontrado');

    const { customerId, professionalId, data, duracaoMinutos, servico, observacoes, valorCobrado } = req.body;

    const updated = await prisma.appointment.update({
      where: { id },
      data: {
        customerId, professionalId,
        data: data ? (parseDate(data) ?? undefined) : undefined,
        duracaoMinutos, servico, observacoes, valorCobrado,
      },
      include: {
        customer: { select: { id: true, nomeCompleto: true } },
        professional: { select: { id: true, nome: true } },
      },
    });

    res.json(updated);
  }, "atualizar agendamento");

  delete = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const id = req.params.id as string;

    await findOwnedOrThrow(prisma.appointment, id, storeId, 'Agendamento não encontrado');

    await prisma.appointment.delete({ where: { id } });
    res.json({ message: 'Agendamento excluído' });
  }, "excluir agendamento");

  // ==================== STATUS TRANSITIONS ====================

  confirm = asyncHandler(async (req: Request, res: Response) => {
    const updated = await transitionStatus({
      model: prisma.appointment,
      id: req.params.id as string,
      storeId: getStoreId(req),
      notFoundMessage: 'Agendamento não encontrado',
      allowedFrom: ['AGENDADO'],
      invalidMessage: 'Apenas agendamentos AGENDADO podem ser confirmados',
      to: 'CONFIRMADO',
    });
    res.json(updated);
  }, "confirmar agendamento");

  start = asyncHandler(async (req: Request, res: Response) => {
    const updated = await transitionStatus({
      model: prisma.appointment,
      id: req.params.id as string,
      storeId: getStoreId(req),
      notFoundMessage: 'Agendamento não encontrado',
      allowedFrom: ['AGENDADO', 'CONFIRMADO'],
      invalidMessage: 'Agendamento precisa estar AGENDADO ou CONFIRMADO',
      to: 'EM_ANDAMENTO',
    });
    res.json(updated);
  }, "iniciar agendamento");

  complete = asyncHandler(async (req: Request, res: Response) => {
    const updated = await transitionStatus({
      model: prisma.appointment,
      id: req.params.id as string,
      storeId: getStoreId(req),
      notFoundMessage: 'Agendamento não encontrado',
      allowedFrom: ['EM_ANDAMENTO'],
      invalidMessage: 'Agendamento precisa estar EM_ANDAMENTO',
      to: 'CONCLUIDO',
    });
    res.json(updated);
  }, "concluir agendamento");

  cancel = asyncHandler(async (req: Request, res: Response) => {
    const updated = await transitionStatus({
      model: prisma.appointment,
      id: req.params.id as string,
      storeId: getStoreId(req),
      notFoundMessage: 'Agendamento não encontrado',
      allowedFrom: ['AGENDADO', 'CONFIRMADO', 'EM_ANDAMENTO', 'NAO_COMPARECEU'],
      invalidMessage: 'Agendamento já finalizado',
      to: 'CANCELADO',
    });
    res.json(updated);
  }, "cancelar agendamento");

  noShow = asyncHandler(async (req: Request, res: Response) => {
    const updated = await transitionStatus({
      model: prisma.appointment,
      id: req.params.id as string,
      storeId: getStoreId(req),
      notFoundMessage: 'Agendamento não encontrado',
      allowedFrom: ['AGENDADO', 'CONFIRMADO'],
      invalidMessage: 'Apenas agendamentos AGENDADO ou CONFIRMADO',
      to: 'NAO_COMPARECEU',
    });
    res.json(updated);
  }, "marcar não comparecimento");
}
