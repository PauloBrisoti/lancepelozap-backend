import { prisma } from "../lib/prisma";
import { differenceInDays, startOfDay } from "date-fns";

function log(msg: string) {
  console.log(`[PetRecorrenciaCron] ${new Date().toISOString()} ${msg}`);
}

export async function processarCobrancasRecorrentes() {
  log("Iniciando verificacao de cobrancas recorrentes (INDETERMINADO)...");

  try {
    const ordens = await prisma.petServiceOrder.findMany({
      where: {
        status: { not: "CANCELADO" },
        recorrente: false, // Ordens com recorrência contínua são geridas pelo novo fluxo
        dataSaida: null,
        items: {
          some: {
            catalog: { tipoDuracao: "INDETERMINADO" },
          },
        },
      },
      include: {
        pet: {
          select: {
            id: true,
            nome: true,
            tutorId: true,
            tutor: {
              select: { id: true, nome: true, telefone: true, email: true },
            },
          },
        },
        items: {
          where: { catalog: { tipoDuracao: "INDETERMINADO" } },
          include: { catalog: { select: { id: true, nome: true, preco: true } } },
          take: 1,
        },
      },
    });

    log(`Encontradas ${ordens.length} ordens INDETERMINADO ativas.`);

    const hoje = startOfDay(new Date());
    let criadas = 0;

    for (const ordem of ordens) {
      try {
        const diasDesdeEntrada = differenceInDays(hoje, startOfDay(ordem.dataEntrada));
        if (diasDesdeEntrada < 30) continue;

        const ciclosCompletos = Math.floor(diasDesdeEntrada / 30);

        if (ordem.ultimaCobranca) {
          const diasDesdeUltimaCobranca = differenceInDays(hoje, startOfDay(ordem.ultimaCobranca));
          if (diasDesdeUltimaCobranca < 28) continue;
        }

        const precoBase = ordem.items[0]?.catalog?.preco
          ? Number(ordem.items[0].catalog.preco)
          : 0;
        if (precoBase <= 0) {
          log(`Ordem ${ordem.id}: preco base zero, pulando`);
          continue;
        }

        const tutor = ordem.pet.tutor;
        if (!tutor) {
          log(`Ordem ${ordem.id}: tutor nao encontrado, pulando`);
          continue;
        }

        const customer = await prisma.customer.findFirst({
          where: { storeId: ordem.storeId, telefoneWhatsapp: tutor.telefone || undefined },
          orderBy: { createdAt: "desc" },
        });
        const customerId = customer?.id || (
          await prisma.customer.create({
            data: {
              storeId: ordem.storeId,
              nomeCompleto: tutor.nome,
              telefoneWhatsapp: tutor.telefone || "",
              email: tutor.email || "",
            },
          })
        ).id;

        const mesRef = `${hoje.getMonth() + 1}/${hoje.getFullYear()}`;
        const descricao = `Mensalidade Asilo - Pet: ${ordem.pet.nome} - Ref: ${mesRef}`;

        await prisma.accountReceivable.create({
          data: {
            storeId: ordem.storeId,
            customerId,
            dataVencimento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            numeroParcela: ciclosCompletos,
            totalParcelas: 0,
            valorParcela: precoBase,
            formaPagamentoEsperada: "FIADO",
            status: "PENDENTE",
          },
        });

        await prisma.petServiceOrder.update({
          where: { id: ordem.id },
          data: { ultimaCobranca: new Date() },
        });

        log(`Cobranca criada: ${descricao} - R$ ${precoBase.toFixed(2)}`);
        criadas++;
      } catch (err: any) {
        log(`Erro ao processar ordem ${ordem.id}: ${err.message}`);
      }
    }

    log(`Cobrancas criadas neste ciclo: ${criadas}`);
  } catch (err: any) {
    log(`Erro geral no cron: ${err.message}`);
  }
}
