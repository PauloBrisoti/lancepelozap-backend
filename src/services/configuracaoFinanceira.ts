import { prisma } from "../lib/prisma";

// ============================================================
// Configurações financeiras do SaaS (varredura + acesso)
// Armazenadas em SystemSetting (chave: 'VARRE_').
// Compartilhado entre o serviço de varredura e o middleware de auth
// para que o bloqueio de acesso respeite a mesma tolerância.
// ============================================================

export interface VarreduraConfig {
  escalonamento: number[];
  bloqueioAposDias: number;
  avisoBloqueioDias: number;
  relatorioEmail: string;
  enviarNotificacoes: boolean;
  toleranciaAcessoDias: number;
}

const DEFAULT_CONFIG: VarreduraConfig = {
  escalonamento: [1, 3, 7],
  bloqueioAposDias: 15,
  avisoBloqueioDias: 7,
  relatorioEmail: "contato@lancepelozap.com.br",
  enviarNotificacoes: true,
  toleranciaAcessoDias: 15,
};

export async function getVarreduraConfig(): Promise<VarreduraConfig> {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { chave: "VARRE_" } });
    const raw = setting?.valor as unknown as Partial<VarreduraConfig> | null;
    return {
      ...DEFAULT_CONFIG,
      ...(raw || {}),
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}
