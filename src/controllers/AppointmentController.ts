import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { parseDate } from '../lib/dateUtils';

export class AppointmentController {
  // ==================== PROFESSIONALS ====================

  async listProfessionals(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const professionals = await prisma.professional.findMany({
        where: { storeId },
        orderBy: { nome: 'asc' },
      });
      res.json(professionals);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async createProfessional(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const { nome, telefone, cor, cargo, comissaoPercentual } = req.body;
      if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });

      const prof = await prisma.professional.create({
        data: { storeId, nome, telefone, cor, cargo, comissaoPercentual: comissaoPercentual || 0 },
      });
      res.status(201).json(prof);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async updateProfessional(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;
      const prof = await prisma.professional.findFirst({ where: { id, storeId } });
      if (!prof) return res.status(404).json({ error: 'Profissional não encontrado' });

      const updated = await prisma.professional.update({ where: { id }, data: req.body });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async deleteProfessional(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;
      const prof = await prisma.professional.findFirst({ where: { id, storeId } });
      if (!prof) return res.status(404).json({ error: 'Profissional não encontrado' });

      await prisma.professional.delete({ where: { id } });
      res.json({ message: 'Profissional excluído' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  // ==================== APPOINTMENTS ====================

  async list(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
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
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async getById(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;

      const appointment = await prisma.appointment.findFirst({
        where: { id, storeId },
        include: {
          customer: { select: { id: true, nomeCompleto: true, telefoneWhatsapp: true } },
          professional: { select: { id: true, nome: true, cor: true } },
        },
      });

      if (!appointment) return res.status(404).json({ error: 'Agendamento não encontrado' });
      res.json(appointment);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
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
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;

      const existing = await prisma.appointment.findFirst({ where: { id, storeId } });
      if (!existing) return res.status(404).json({ error: 'Agendamento não encontrado' });

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
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;

      const existing = await prisma.appointment.findFirst({ where: { id, storeId } });
      if (!existing) return res.status(404).json({ error: 'Agendamento não encontrado' });

      await prisma.appointment.delete({ where: { id } });
      res.json({ message: 'Agendamento excluído' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  // ==================== STATUS TRANSITIONS ====================

  async confirm(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;

      const apt = await prisma.appointment.findFirst({ where: { id, storeId } });
      if (!apt) return res.status(404).json({ error: 'Agendamento não encontrado' });
      if (apt.status !== 'AGENDADO') return res.status(400).json({ error: 'Apenas agendamentos AGENDADO podem ser confirmados' });

      const updated = await prisma.appointment.update({ where: { id }, data: { status: 'CONFIRMADO' } });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async start(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;

      const apt = await prisma.appointment.findFirst({ where: { id, storeId } });
      if (!apt) return res.status(404).json({ error: 'Agendamento não encontrado' });
      if (!['AGENDADO', 'CONFIRMADO'].includes(apt.status)) {
        return res.status(400).json({ error: 'Agendamento precisa estar AGENDADO ou CONFIRMADO' });
      }

      const updated = await prisma.appointment.update({ where: { id }, data: { status: 'EM_ANDAMENTO' } });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async complete(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;

      const apt = await prisma.appointment.findFirst({ where: { id, storeId } });
      if (!apt) return res.status(404).json({ error: 'Agendamento não encontrado' });
      if (apt.status !== 'EM_ANDAMENTO') return res.status(400).json({ error: 'Agendamento precisa estar EM_ANDAMENTO' });

      const updated = await prisma.appointment.update({ where: { id }, data: { status: 'CONCLUIDO' } });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async cancel(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;

      const apt = await prisma.appointment.findFirst({ where: { id, storeId } });
      if (!apt) return res.status(404).json({ error: 'Agendamento não encontrado' });
      if (apt.status === 'CONCLUIDO' || apt.status === 'CANCELADO') {
        return res.status(400).json({ error: 'Agendamento já finalizado' });
      }

      const updated = await prisma.appointment.update({ where: { id }, data: { status: 'CANCELADO' } });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async noShow(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;

      const apt = await prisma.appointment.findFirst({ where: { id, storeId } });
      if (!apt) return res.status(404).json({ error: 'Agendamento não encontrado' });
      if (apt.status !== 'AGENDADO' && apt.status !== 'CONFIRMADO') {
        return res.status(400).json({ error: 'Apenas agendamentos AGENDADO ou CONFIRMADO' });
      }

      const updated = await prisma.appointment.update({ where: { id }, data: { status: 'NAO_COMPARECEU' } });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
