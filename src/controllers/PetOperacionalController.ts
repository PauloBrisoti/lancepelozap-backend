import { Request, Response } from "express";
import { logger } from '../lib/logger';
import { asyncHandler, getStoreId } from "../lib/asyncHandler";
import { prisma } from "../lib/prisma";
import { enviarLembreteRecorrencia, lembrarOrdem } from "../services/PetLembretesService";
import { parseDate } from "../lib/dateUtils";

// ============================================================
// PET MODULE — Operacional Pet
// All CRUD for tutors, pets, service catalog and service orders.
// Fully isolated from core business logic.
// ============================================================

/* ─────────── TUTORS ─────────── */

export const listTutors = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const search = req.query.q as string || "";
  const where: any = { storeId };
  if (search) {
    where.OR = [
      { nome: { contains: search, mode: "insensitive" } },
      { telefone: { contains: search } },
    ];
  }
  const tutors = await prisma.petTutor.findMany({
    where,
    orderBy: { nome: "asc" },
    include: { _count: { select: { pets: true } }, pets: true },
  });
  return res.json(tutors);
}, "listar tutores");

export const createTutor = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const { nome, telefone, email, endereco, bairro, cidade, cep, observacoes } = req.body;
  if (!nome) return res.status(400).json({ message: "Nome é obrigatório" });
  const tutor = await prisma.petTutor.create({
    data: { storeId, nome, telefone, email, endereco, bairro, cidade, cep, observacoes },
  });
  return res.status(201).json(tutor);
}, "criar tutor");

export const updateTutor = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const id = req.params.id as string;
  const existing = await prisma.petTutor.findFirst({ where: { id, storeId } });
  if (!existing) return res.status(404).json({ message: "Tutor nao encontrado" });
  const { nome, telefone, email, endereco, bairro, cidade, cep, observacoes } = req.body;
  const tutor = await prisma.petTutor.update({
    where: { id },
    data: { nome, telefone, email, endereco, bairro, cidade, cep, observacoes },
  });
  return res.json(tutor);
}, "atualizar tutor");

export const deleteTutor = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const id = req.params.id as string;
  const existing = await prisma.petTutor.findFirst({ where: { id, storeId } });
  if (!existing) return res.status(404).json({ message: "Tutor nao encontrado" });
  await prisma.petTutor.delete({ where: { id } });
  return res.status(204).send();
}, "excluir tutor");

/* ─────────── PETS ─────────── */

export const listPets = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const tutorId = req.query.tutorId as string | undefined;
  const where: any = { storeId };
  if (tutorId) where.tutorId = tutorId;
  const pets = await prisma.pet.findMany({
    where,
    orderBy: { nome: "asc" },
    include: {
      tutor: { select: { id: true, nome: true, telefone: true } },
      vaccines: {
        select: { id: true, nome: true, tipo: true, dose: true, dataAplicacao: true, proximaDose: true },
        orderBy: { proximaDose: "asc" },
      },
    },
  });
  return res.json(pets);
}, "listar pets");

export const createPet = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const { tutorId, nome, especie, raca, porte, sexo, dataNascimento, cor, observacoes } = req.body;
  if (!tutorId || !nome || !especie) return res.status(400).json({ message: "tutorId, nome e especie sao obrigatorios" });
  const tutor = await prisma.petTutor.findFirst({ where: { id: tutorId, storeId } });
  if (!tutor) return res.status(400).json({ message: "Tutor nao encontrado" });
  const pet = await prisma.pet.create({
    data: { storeId, tutorId, nome, especie, raca, porte, sexo, dataNascimento: parseDate(dataNascimento), cor, observacoes },
    include: { tutor: { select: { id: true, nome: true } } },
  });
  return res.status(201).json(pet);
}, "criar pet");

export const updatePet = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const id = req.params.id as string;
  const existing = await prisma.pet.findFirst({ where: { id, storeId } });
  if (!existing) return res.status(404).json({ message: "Pet nao encontrado" });
  const { tutorId, nome, especie, raca, porte, sexo, dataNascimento, cor, observacoes } = req.body;
  const data: any = { tutorId, nome, especie, raca, porte, sexo, cor, observacoes };
  if (dataNascimento) data.dataNascimento = parseDate(dataNascimento);
  const pet = await prisma.pet.update({ where: { id }, data });
  return res.json(pet);
}, "atualizar pet");

export const deletePet = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const id = req.params.id as string;
  const existing = await prisma.pet.findFirst({ where: { id, storeId } });
  if (!existing) return res.status(404).json({ message: "Pet nao encontrado" });
  await prisma.pet.delete({ where: { id } });
  return res.status(204).send();
}, "excluir pet");

// ── Adocao: encerra o lar temporario ──
// 1) marca o pet como adotado  2) cancela a cadeia de recorrencia (OS agendadas futuras)
// 3) gera a OS "Encerramento de LT" concluida (R$ 0,00) no historico
export const adoptPet = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const id = req.params.id as string;
  const pet = await prisma.pet.findFirst({ where: { id, storeId } });
  if (!pet) return res.status(404).json({ message: "Pet nao encontrado" });
  if (pet.adotado) return res.status(400).json({ message: "Pet ja adotado" });

  // 2) Cancela OS agendadas futuras (quebra a cadeia de recorrencia do LT)
  await prisma.petServiceOrder.updateMany({
    where: { storeId, petId: id, status: "AGENDADO" },
    data: { status: "CANCELADO" },
  });

  // 3) Garante o item de catalogo "Encerramento de LT" (R$ 0,00)
  let encerramento = await prisma.petServiceCatalog.findFirst({
    where: { storeId, nome: "Encerramento de LT" },
  });
  if (!encerramento) {
    encerramento = await prisma.petServiceCatalog.create({
      data: { storeId, nome: "Encerramento de LT", preco: 0, categoria: "OUTRO", tipoDuracao: "INDETERMINADO" },
    });
  }

  const petAtualizado = await prisma.pet.update({
    where: { id },
    data: { adotado: true, dataAdocao: new Date() },
    include: { tutor: { select: { id: true, nome: true, telefone: true } } },
  });

  await prisma.petServiceOrder.create({
    data: {
      storeId,
      petId: id,
      dataEntrada: new Date(),
      status: "CONCLUIDO",
      dataConclusao: new Date(),
      valorTotal: 0,
      desconto: 0,
      valorFinal: 0,
      recorrente: false,
      observacoes: "Animal adotado — encerramento do lar temporário",
      items: { create: [{ catalogItemId: encerramento.id, quantidade: 1, precoUnitario: 0, valorTotal: 0 }] },
    },
    include: {
      pet: { select: { id: true, nome: true, especie: true, tutor: { select: { id: true, nome: true } } } },
      items: { include: { catalog: { select: { id: true, nome: true } } } },
    },
  });

  return res.json(petAtualizado);
}, "registrar adocao");

/* ─────────── VACCINES & WEIGHTS ─────────── */

export const listPetVaccines = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const petId = req.query.petId as string;
  const where: any = { storeId };
  if (petId) where.petId = petId;
  const vaccines = await prisma.petVaccine.findMany({
    where,
    orderBy: { dataAplicacao: "desc" },
    include: { pet: { select: { id: true, nome: true } } },
  });
  return res.json(vaccines);
}, "listar vacinas");

export const createPetVaccine = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const { petId, nome, tipo, dose, dataAplicacao, proximaDose, observacoes } = req.body;
  if (!petId || !nome || !dataAplicacao) {
    return res.status(400).json({ message: "petId, nome e dataAplicacao sao obrigatorios" });
  }
  const pet = await prisma.pet.findFirst({ where: { id: petId, storeId } });
  if (!pet) return res.status(400).json({ message: "Pet nao encontrado" });
  const vaccine = await prisma.petVaccine.create({
    data: {
      storeId,
      petId,
      nome,
      tipo: tipo || "VACINA",
      dose: dose || null,
      dataAplicacao: parseDate(dataAplicacao) || new Date(),
      proximaDose: parseDate(proximaDose),
      observacoes: observacoes || null,
    },
    include: { pet: { select: { id: true, nome: true } } },
  });
  return res.status(201).json(vaccine);
}, "criar vacina");

export const updatePetVaccine = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const id = req.params.id as string;
  const existing = await prisma.petVaccine.findFirst({ where: { id, storeId } });
  if (!existing) return res.status(404).json({ message: "Vacina nao encontrada" });
  const { nome, tipo, dose, dataAplicacao, proximaDose, observacoes } = req.body;
  const vaccine = await prisma.petVaccine.update({
    where: { id },
    data: {
      nome: nome ?? existing.nome,
      tipo: tipo ?? existing.tipo,
      dose: dose !== undefined ? (dose || null) : existing.dose,
      dataAplicacao: dataAplicacao ? (parseDate(dataAplicacao) ?? undefined) : existing.dataAplicacao,
      proximaDose: proximaDose !== undefined ? (parseDate(proximaDose) ?? undefined) : existing.proximaDose,
      observacoes: observacoes !== undefined ? (observacoes || null) : existing.observacoes,
    },
  });
  return res.json(vaccine);
}, "atualizar vacina");

export const deletePetVaccine = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const id = req.params.id as string;
  const existing = await prisma.petVaccine.findFirst({ where: { id, storeId } });
  if (!existing) return res.status(404).json({ message: "Vacina nao encontrada" });
  await prisma.petVaccine.delete({ where: { id } });
  return res.status(204).send();
}, "excluir vacina");

export const listPetWeights = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const petId = req.query.petId as string;
  const where: any = { storeId };
  if (petId) where.petId = petId;
  const weights = await prisma.petWeight.findMany({
    where,
    orderBy: { dataPesagem: "desc" },
  });
  return res.json(weights);
}, "listar pesos");

export const createPetWeight = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const { petId, pesoKg, dataPesagem, observacoes } = req.body;
  if (!petId || pesoKg === undefined || pesoKg === null || pesoKg === "") {
    return res.status(400).json({ message: "petId e pesoKg sao obrigatorios" });
  }
  const pet = await prisma.pet.findFirst({ where: { id: petId, storeId } });
  if (!pet) return res.status(400).json({ message: "Pet nao encontrado" });
  const weight = await prisma.petWeight.create({
    data: {
      storeId,
      petId,
      pesoKg: Number(pesoKg),
      dataPesagem: dataPesagem ? new Date(dataPesagem) : new Date(),
      observacoes: observacoes || null,
    },
  });
  return res.status(201).json(weight);
}, "registrar peso");

export const deletePetWeight = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const id = req.params.id as string;
  const existing = await prisma.petWeight.findFirst({ where: { id, storeId } });
  if (!existing) return res.status(404).json({ message: "Peso nao encontrado" });
  await prisma.petWeight.delete({ where: { id } });
  return res.status(204).send();
}, "excluir peso");

/* ─────────── SERVICE CATALOG ─────────── */

export const listServiceCatalog = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const categoria = req.query.categoria as string | undefined;
  const where: any = { storeId };
  if (categoria) where.categoria = categoria;
  const items = await prisma.petServiceCatalog.findMany({ where, orderBy: { nome: "asc" } });
  return res.json(items);
}, "listar catalogo");

export const createCatalogItem = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const { nome, descricao, preco, categoria, tipoDuracao } = req.body;
  if (!nome || preco === undefined) return res.status(400).json({ message: "nome e preco sao obrigatorios" });
  const item = await prisma.petServiceCatalog.create({
    data: { storeId, nome, descricao, preco: Number(preco), categoria, tipoDuracao: tipoDuracao || 'INDETERMINADO' },
  });
  return res.status(201).json(item);
}, "criar item catalogo");

export const updateCatalogItem = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const id = req.params.id as string;
  const existing = await prisma.petServiceCatalog.findFirst({ where: { id, storeId } });
  if (!existing) return res.status(404).json({ message: "Item nao encontrado" });
  const { nome, descricao, preco, categoria, tipoDuracao } = req.body;
  const item = await prisma.petServiceCatalog.update({
    where: { id },
    data: { nome, descricao, preco: preco !== undefined ? Number(preco) : undefined, categoria, tipoDuracao },
  });
  return res.json(item);
}, "atualizar item catalogo");

export const deleteCatalogItem = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const id = req.params.id as string;
  const existing = await prisma.petServiceCatalog.findFirst({ where: { id, storeId } });
  if (!existing) return res.status(404).json({ message: "Item nao encontrado" });
  await prisma.petServiceCatalog.delete({ where: { id } });
  return res.status(204).send();
}, "excluir item catalogo");

/* ─────────── SERVICE ORDERS ─────────── */

export const listServiceOrders = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const status = req.query.status as string | undefined;
  const petId = req.query.petId as string | undefined;
  const where: any = { storeId };
  if (status) where.status = status;
  if (petId) where.petId = petId;
  const orders = await prisma.petServiceOrder.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      pet: { select: { id: true, nome: true, especie: true, tutor: { select: { id: true, nome: true, telefone: true } } } },
      items: { include: { catalog: { select: { id: true, nome: true } } } },
    },
  });
  return res.json(orders);
}, "listar ordens");

export const createServiceOrder = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const { petId, dataEntrada, dataSaida, horaInicio, horaFim, items, desconto, observacoes, status, mesesRecorrencia, recorrente, periodicidadeMeses } = req.body;
  // Sanitize empty strings to null (frontend envios "" para campos opcionais)
  const dataSaidaSanitized = parseDate(dataSaida);
  const horaInicioSanitized = (!horaInicio || horaInicio === "") ? null : horaInicio;
  const horaFimSanitized = (!horaFim || horaFim === "") ? null : horaFim;
  if (!petId || !dataEntrada || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "petId, dataEntrada e items sao obrigatorios" });
  }
  const pet = await prisma.pet.findFirst({ where: { id: petId, storeId } });
  if (!pet) return res.status(400).json({ message: "Pet nao encontrado" });

  let valorTotal = 0;
  const orderItems: any[] = [];
  for (const item of items) {
    const catalog = await prisma.petServiceCatalog.findFirst({ where: { id: item.catalogItemId, storeId } });
    if (!catalog) return res.status(400).json({ message: "Item catalogo nao encontrado: " + item.catalogItemId });
    const qtd = item.quantidade || 1;
    const preco = item.precoUnitario !== undefined ? Number(item.precoUnitario) : Number(catalog.preco);
    const total = preco * qtd;
    valorTotal += total;
    orderItems.push({
      catalogItemId: catalog.id,
      quantidade: qtd,
      precoUnitario: preco,
      valorTotal: total,
    });
  }

  const valorDesconto = Number(desconto) || 0;
  const valorFinal = valorTotal - valorDesconto;

  // Recurrencia mensal:
  // - recorrente=true  -> recorrência contínua: cria 1 OS agora; a próxima é gerada
  //                       automaticamente a cada conclusão (até ser cancelada)
  // - mesesRecorrencia>1 -> cria N ordens agendadas de uma vez (uma por mês)
  const entradaInicial = parseDate(dataEntrada) || new Date();
  const recorrenteContinuo = Boolean(recorrente);
  const periodicidade = Math.max(1, Math.min(12, Number(periodicidadeMeses) || 1));
  const qtdMeses = recorrenteContinuo ? 1 : Math.max(1, Math.min(24, Number(mesesRecorrencia) || 1));

  const created: any[] = [];
  for (let i = 0; i < qtdMeses; i++) {
    const entrada = new Date(entradaInicial);
    if (i > 0) entrada.setMonth(entrada.getMonth() + i);

    const order = await prisma.petServiceOrder.create({
      data: {
        storeId,
        petId,
        dataEntrada: entrada,
        dataSaida: dataSaidaSanitized,
        horaInicio: horaInicioSanitized,
        horaFim: horaFimSanitized,
        status: i > 0 ? "AGENDADO" : (status || "AGENDADO"),
        valorTotal,
        desconto: valorDesconto,
        valorFinal: Math.max(0, valorFinal),
        recorrente: recorrenteContinuo,
        periodicidadeMeses: periodicidade,
        observacoes: recorrenteContinuo
          ? `${observacoes ? observacoes + " " : ""}(Recorrência contínua — próxima cobrança gerada ao concluir)`.trim()
          : (i > 0 ? `${observacoes ? observacoes + " " : ""}(Recorrência mensal #${i + 1}/${qtdMeses})`.trim() : observacoes),
        items: { create: orderItems },
      },
      include: {
        pet: { select: { id: true, nome: true, especie: true, tutor: { select: { id: true, nome: true } } } },
        items: { include: { catalog: { select: { id: true, nome: true } } } },
      },
    });
    created.push(order);
  }

  return res.status(201).json(qtdMeses > 1 ? created : created[0]);
}, "criar ordem servico");

export const updateServiceOrderStatus = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const id = req.params.id as string;
  const { status, formaPagamento } = req.body;
  const validStatuses = ["AGENDADO", "EM_ANDAMENTO", "CONCLUIDO", "CANCELADO"];
  if (!validStatuses.includes(status)) return res.status(400).json({ message: "Status invalido" });

  const order = await prisma.petServiceOrder.findFirst({
    where: { id, storeId },
    include: {
      pet: { select: { id: true, nome: true, tutorId: true } },
      items: { include: { catalog: { select: { id: true, nome: true } } } },
    },
  });
  if (!order) return res.status(404).json({ message: "Ordem nao encontrada" });

  const data: any = { status };
  if (status === "CONCLUIDO") {
    data.dataConclusao = new Date();
    data.formaPagamento = formaPagamento || null;
    data.ultimaCobranca = new Date();

    // ── Integration point: create AccountReceivable if fiado ──
    if (formaPagamento === "FIADO" && Number(order.valorFinal) > 0) {
      const tutor = await prisma.petTutor.findFirst({ where: { id: order.pet.tutorId } });
      if (tutor) {
        const customer = await prisma.customer.findFirst({
          where: { storeId, telefoneWhatsapp: tutor.telefone || undefined },
          orderBy: { createdAt: "desc" },
        });
        const customerId = customer?.id || (
          await prisma.customer.create({
            data: {
              storeId,
              nomeCompleto: tutor.nome,
              telefoneWhatsapp: tutor.telefone || "",
              email: tutor.email || "",
            },
          })
        ).id;

        await prisma.accountReceivable.create({
          data: {
            storeId,
            customerId,
            dataVencimento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            numeroParcela: 1,
            totalParcelas: 1,
            valorParcela: order.valorFinal,
            formaPagamentoEsperada: "FIADO",
            status: "PENDENTE",
          },
        });
      }
    }

    // ── FinancialTransaction: record revenue for DRE/Dashboard ──
    if (Number(order.valorFinal) > 0) {
      const wallet = await prisma.wallet.findFirst({
        where: { storeId },
        orderBy: { nome: "asc" },
      });
      if (wallet) {
        await prisma.financialTransaction.create({
          data: {
            storeId,
            walletId: wallet.id,
            tipo: "ENTRADA",
            status: "ATIVA",
            valor: order.valorFinal,
            descricao: `Prestação de Serviço Pet (ID: ${order.id})`,
            categoria: "PRESTACAO_SERVICO_PET",
            dataTransacao: order.dataEntrada || order.createdAt,
            formaPagamento: formaPagamento || null,
          },
        });
      }
    }

    // ── Recorrência contínua: gera a próxima OS automaticamente ──
    if (order.recorrente && order.items.length > 0) {
      const proximaEntrada = new Date(order.dataEntrada);
      proximaEntrada.setMonth(proximaEntrada.getMonth() + (order.periodicidadeMeses || 1));
      const baseObs = (order.observacoes || "").replace(/\(Recorrência contínua.*?\)\s*/g, "").trim();
      await prisma.petServiceOrder.create({
        data: {
          storeId,
          petId: order.pet.id,
          dataEntrada: proximaEntrada,
          status: "AGENDADO",
          valorTotal: order.valorTotal,
          desconto: order.desconto,
          valorFinal: order.valorFinal,
          recorrente: true,
          periodicidadeMeses: order.periodicidadeMeses || 1,
          observacoes: `${baseObs ? baseObs + " " : ""}(Recorrência contínua — gerada automaticamente)`.trim(),
          items: {
            create: order.items.map((item) => ({
              catalogItemId: item.catalogItemId,
              quantidade: item.quantidade,
              precoUnitario: item.precoUnitario,
              valorTotal: item.valorTotal,
            })),
          },
        },
      });

      // ── Lembrete WhatsApp ao tutor (se configurado) ──
      const nomesServicos = order.items.map((item) => item.catalog?.nome).filter(Boolean).join(", ") || "serviço";
      enviarLembreteRecorrencia(storeId, order.id, proximaEntrada, nomesServicos, Number(order.valorFinal)).catch((e) => {
        logger.warn("Falha ao enviar lembrete de recorrência", { err: e, action: "pet_recurrence_reminder", orderId: order.id });
      });
    }
  } else if (status === "CANCELADO") {
    // ── Cancel linked FinancialTransaction ──
    const ft = await prisma.financialTransaction.findFirst({
      where: { storeId, descricao: { contains: `(ID: ${id})` }, tipo: "ENTRADA" },
    });
    if (ft) {
      await prisma.financialTransaction.update({
        where: { id: ft.id },
        data: { status: "CANCELADA" },
      });
    }
    // ── Cancel linked AccountReceivable ──
    if (order.pet) {
      const tutor = await prisma.petTutor.findFirst({ where: { id: order.pet.tutorId } });
      if (tutor) {
        const customer = await prisma.customer.findFirst({
          where: { storeId, telefoneWhatsapp: tutor.telefone || undefined },
          orderBy: { createdAt: "desc" },
        });
        if (customer) {
          const ar = await prisma.accountReceivable.findFirst({
            where: { storeId, customerId: customer.id, formaPagamentoEsperada: "FIADO", status: "PENDENTE" },
            orderBy: { dataVencimento: "desc" },
          });
          if (ar) {
            await prisma.accountReceivable.update({
              where: { id: ar.id },
              data: { status: "CANCELADO" },
            });
          }
        }
      }
    }
  }

  const updated = await prisma.petServiceOrder.update({
    where: { id },
    data,
    include: {
      pet: { select: { id: true, nome: true, especie: true, tutor: { select: { id: true, nome: true, telefone: true } } } },
      items: { include: { catalog: { select: { id: true, nome: true } } } },
    },
  });
  return res.json(updated);
}, "atualizar status ordem");

export const updateServiceOrder = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const id = req.params.id as string;
  const { items, desconto, observacoes, dataSaida, horaInicio, horaFim, formaPagamento } = req.body;

  const order = await prisma.petServiceOrder.findFirst({ where: { id, storeId } });
  if (!order) return res.status(404).json({ message: "Ordem nao encontrada" });

  let newValorTotal = Number(order.valorTotal);

  if (items && Array.isArray(items) && items.length > 0) {
    newValorTotal = 0;
    for (const item of items) {
      const catalog = await prisma.petServiceCatalog.findFirst({ where: { id: item.catalogItemId, storeId } });
      if (!catalog) return res.status(400).json({ message: "Item catalogo nao encontrado: " + item.catalogItemId });
      const qtd = item.quantidade || 1;
      const preco = item.precoUnitario !== undefined ? Number(item.precoUnitario) : Number(catalog.preco);
      newValorTotal += preco * qtd;
    }
  }

  const valorDesconto = desconto !== undefined ? Number(desconto) : Number(order.desconto);
  const valorFinal = newValorTotal - valorDesconto;

  const updateData: any = {};
  if (dataSaida !== undefined) updateData.dataSaida = dataSaida || null;
  if (horaInicio !== undefined) updateData.horaInicio = horaInicio || null;
  if (horaFim !== undefined) updateData.horaFim = horaFim || null;
  if (observacoes !== undefined) updateData.observacoes = observacoes;
  if (items !== undefined) updateData.valorTotal = newValorTotal;
  if (desconto !== undefined) updateData.desconto = valorDesconto;
  if (items !== undefined || desconto !== undefined) updateData.valorFinal = Math.max(0, valorFinal);
  if (formaPagamento !== undefined) updateData.formaPagamento = formaPagamento;

  const updated = await prisma.petServiceOrder.update({
    where: { id },
    data: updateData,
  });

  // ── Sync FinancialTransaction for CONCLUIDO orders ──
  if (order.status === "CONCLUIDO") {
    const ft = await prisma.financialTransaction.findFirst({
      where: { storeId, descricao: { contains: `(ID: ${id})` }, tipo: "ENTRADA" },
    });

    // Determine FT status based on formaPagamento
    const newStatus = formaPagamento === "FIADO" ? "PENDENTE" : "ATIVA";

    if (ft) {
      const ftUpdate: any = { descricao: `Prestação de Serviço Pet (ID: ${id})` };
      if (items !== undefined || desconto !== undefined) ftUpdate.valor = Math.max(0, valorFinal);
      if (formaPagamento !== undefined) {
        ftUpdate.status = newStatus;
        ftUpdate.formaPagamento = formaPagamento;
      }
      await prisma.financialTransaction.update({ where: { id: ft.id }, data: ftUpdate });
    } else if (Number(updated.valorFinal) > 0 && formaPagamento !== undefined) {
      // Create FT if missing (orders completed before FT integration existed)
      const wallet = await prisma.wallet.findFirst({ where: { storeId }, orderBy: { nome: "asc" } });
      if (wallet) {
        await prisma.financialTransaction.create({
          data: {
            storeId,
            walletId: wallet.id,
            tipo: "ENTRADA",
            status: newStatus,
            valor: updated.valorFinal,
            descricao: `Prestação de Serviço Pet (ID: ${updated.id})`,
            categoria: "PRESTACAO_SERVICO_PET",
            dataTransacao: order.dataEntrada || order.createdAt,
            formaPagamento: formaPagamento || null,
          },
        });
      }
    }

    // ── Sync AccountReceivable for FIADO changes ──
    if (formaPagamento !== undefined && formaPagamento !== order.formaPagamento) {
      // Find AccountReceivable via tutor → customer link
      const orderWithPet = await prisma.petServiceOrder.findFirst({
        where: { id },
        select: { pet: { select: { tutorId: true } } },
      });
      let ar = null;
      if (orderWithPet?.pet) {
        const tutor = await prisma.petTutor.findFirst({ where: { id: orderWithPet.pet.tutorId } });
        if (tutor) {
          const customer = await prisma.customer.findFirst({
            where: { storeId, telefoneWhatsapp: tutor.telefone || undefined },
            orderBy: { createdAt: "desc" },
          });
          if (customer) {
            ar = await prisma.accountReceivable.findFirst({
              where: { storeId, customerId: customer.id, formaPagamentoEsperada: "FIADO", status: "PENDENTE" },
              orderBy: { dataVencimento: "desc" },
            });
          }
        }
      }

      if (formaPagamento === "FIADO" && !ar && Number(updated.valorFinal) > 0 && orderWithPet?.pet) {
        const tutor = await prisma.petTutor.findFirst({ where: { id: orderWithPet.pet.tutorId } });
        if (tutor) {
          const customer = await prisma.customer.findFirst({
            where: { storeId, telefoneWhatsapp: tutor.telefone || undefined },
            orderBy: { createdAt: "desc" },
          });
          const customerId = customer?.id || (
            await prisma.customer.create({
              data: { storeId, nomeCompleto: tutor.nome, telefoneWhatsapp: tutor.telefone || "", email: tutor.email || "" },
            })
          ).id;
          await prisma.accountReceivable.create({
            data: {
              storeId, customerId,
              dataVencimento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              numeroParcela: 1, totalParcelas: 1,
              valorParcela: updated.valorFinal,
              formaPagamentoEsperada: "FIADO", status: "PENDENTE",
            },
          });
        }
      } else if (formaPagamento !== "FIADO" && ar) {
        // Cancel AccountReceivable when changing FROM FIADO
        await prisma.accountReceivable.update({
          where: { id: ar.id },
          data: { status: "PAGO", dataPagamentoEfetivo: new Date() },
        });
      }
    }
  }

  return res.json(updated);
}, "atualizar ordem");

export const deleteServiceOrder = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const id = req.params.id as string;

  const order = await prisma.petServiceOrder.findFirst({ where: { id, storeId } });
  if (!order) return res.status(404).json({ message: "Ordem nao encontrada" });

  // Delete linked FinancialTransaction
  const ft = await prisma.financialTransaction.findFirst({
    where: { storeId, descricao: { contains: `(ID: ${id})` }, tipo: "ENTRADA" },
  });
  if (ft) {
    await prisma.financialTransaction.delete({ where: { id: ft.id } });
  }

  // Delete linked AccountReceivable
  if (order.formaPagamento === "FIADO" || order.status === "CONCLUIDO") {
    const orderWithPet = await prisma.petServiceOrder.findFirst({
      where: { id },
      select: { pet: { select: { tutorId: true } } },
    });
    if (orderWithPet?.pet) {
      const tutor = await prisma.petTutor.findFirst({ where: { id: orderWithPet.pet.tutorId } });
      if (tutor) {
        const customer = await prisma.customer.findFirst({
          where: { storeId, telefoneWhatsapp: tutor.telefone || undefined },
          orderBy: { createdAt: "desc" },
        });
        if (customer) {
          const ar = await prisma.accountReceivable.findFirst({
            where: { storeId, customerId: customer.id, formaPagamentoEsperada: "FIADO", status: "PENDENTE" },
            orderBy: { dataVencimento: "desc" },
          });
          if (ar) {
            await prisma.accountReceivable.delete({ where: { id: ar.id } });
          }
        }
      }
    }
  }

  await prisma.petServiceOrder.delete({ where: { id } });

  return res.json({ message: "Ordem excluida com sucesso" });
}, "excluir ordem");

export const remindServiceOrder = asyncHandler(async (req: Request, res: Response) => {
  const storeId = getStoreId(req);
  const id = req.params.id as string;
  const result = await lembrarOrdem(storeId, id);
  if (!result.ok) return res.status(400).json({ message: result.error || "Falha ao enviar lembrete" });
  return res.json({ ok: true });
}, "lembrar ordem");
