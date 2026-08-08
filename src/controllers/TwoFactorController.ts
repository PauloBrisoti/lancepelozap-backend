import { Request, Response } from "express";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import { prisma } from "../lib/prisma";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../lib/jwt";
import { notifyTwoFactorChanged } from "../services/securityNotifications";
import { asyncHandler } from "../lib/asyncHandler";

export class TwoFactorController {
  // Gera o segredo e o QRCode para o usuário logado
  generateSecret = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Não autorizado" });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });

    if (user.twoFactorEnabled) {
      return res.status(400).json({ error: "2FA já está ativado." });
    }

    const secretData = speakeasy.generateSecret({ name: `Lance Pelo Zap (${user.email})` });
    const secret = secretData.base32;
    const otpauthUrl = secretData.otpauth_url || "";
    const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

    // Salva o segredo temporariamente (pode sobrescrever se ele tentar gerar de novo antes de validar)
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: secret }
    });

    return res.json({ qrCodeUrl, secret });
  }, "gerar 2FA");

  // Valida o primeiro código para ATIVAR o 2FA definitivamente
  enable2FA = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const { token } = req.body; // 6 digitos

    if (!userId) return res.status(401).json({ error: "Não autorizado" });
    if (!token) return res.status(400).json({ error: "Token é obrigatório" });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.twoFactorSecret) {
      return res.status(400).json({ error: "Geração de 2FA não iniciada." });
    }

    const isValid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: "base32",
      token: token
    });
    if (!isValid) {
      return res.status(400).json({ error: "Código inválido." });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true }
    });

    notifyTwoFactorChanged(user.email, true);

    return res.json({ message: "2FA ativado com sucesso!" });
  }, "ativar 2FA");

  // Desativa o 2FA — exige a senha atual para que uma sessão roubada não
  // consiga desativar a proteção; revoga todas as sessões existentes.
  async disable2FA(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const { senhaAtual } = req.body;

      if (!userId) return res.status(401).json({ error: "Não autorizado" });
      if (!senhaAtual) return res.status(400).json({ error: "Senha atual é obrigatória" });

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
      if (!user.twoFactorEnabled) return res.status(400).json({ error: "2FA não está ativado" });

      const { comparePassword } = await import("../utils/password");
      if (!(await comparePassword(senhaAtual, user.senhaHash))) {
        return res.status(400).json({ error: "Senha atual incorreta" });
      }

      await prisma.user.update({
        where: { id: userId },
        data: {
          twoFactorEnabled: false,
          twoFactorSecret: null,
          tokenVersion: { increment: 1 },
        },
      });

      notifyTwoFactorChanged(user.email, false);

      return res.json({ message: "2FA desativado. Faça login novamente." });
    } catch (error) {
  // Rota pública para quem recebeu require2FA no login
    }
  }

  // Rota pública para quem recebeu require2FA no login
  validateLogin = asyncHandler(async (req: Request, res: Response) => {
    const { tempToken, code } = req.body;
    if (!tempToken || !code) {
      return res.status(400).json({ error: "Token temporário e código são obrigatórios." });
    }

    // Decodifica o tempToken
    let decoded: any;
    try {
      decoded = jwt.verify(tempToken, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: "Sessão temporária inválida ou expirada." });
    }

    if (!decoded.userId || decoded.type !== "2FA_TEMP") {
      return res.status(401).json({ error: "Token inválido." });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { storeAccess: true, clientAccess: true }
    });
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      return res.status(400).json({ error: "Usuário inválido ou 2FA não configurado." });
    }

    const isValid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: "base32",
      token: code
    });
    if (!isValid) {
      return res.status(400).json({ error: "Código 2FA inválido." });
    }

    // Código válido! Emitir o JWT real com os MESMOS claims do login normal
    // (allowedStoreIds/clientId/internalRoleId — sem isso a troca de loja e
    // o RBAC interno quebram após o 2FA)
    const storeAccesses = (user as any).storeAccess || [];
    const allowedStoreIds = storeAccesses.map((acc: any) => acc.storeId);
    const storeId = decoded.storeId || (allowedStoreIds.length > 0 ? allowedStoreIds[0] : null);
    const clientId = (user as any).clientAccess?.[0]?.clientId || null;

    const authToken = jwt.sign(
      {
        id: user.id,
        email: user.email,
        storeId,
        allowedStoreIds,
        clientId,
        role: user.role,
        internalRoleId: (user as any).internalRoleId,
        tv: (user as any).tokenVersion,
      },
      JWT_SECRET,
      { expiresIn: "12h" }
    );

    // Mesmo comportamento do login normal: adminToken para SUPER_ADMIN
    const cookieName = user.role === 'SUPER_ADMIN' ? 'adminToken' : 'authToken';
    res.cookie(cookieName, authToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 12 * 60 * 60 * 1000,
    });

    // Fetch user access info to return proper availableStores
    const userWithRelations = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        clientAccess: true,
        storeAccess: { include: { store: { include: { control: true } } } }
      }
    });
    const clientAccess = userWithRelations?.clientAccess?.[0];
    const client = clientAccess ? await prisma.client.findUnique({ where: { id: clientAccess.clientId }, select: { dadosCompletos: true } }) : null;
    const publicData = {
       id: user.id,
       nome: user.nome,
       email: user.email,
       role: user.role,
       ativo: user.ativo,
       clientId: clientAccess?.clientId || null,
       dadosCompletos: client?.dadosCompletos ?? false,
       storeAccess: userWithRelations?.storeAccess.map(a => {
         // SEGURANÇA: nunca expor credenciais de integração (WhatsApp)
         const { whatsappApiKey, ...safeStore } = a.store as any;
         return { ...a, store: safeStore };
       }),
       availableStores: userWithRelations?.storeAccess.map(a => {
         // SEGURANÇA: nunca expor credenciais de integração (WhatsApp)
         const { whatsappApiKey, ...safeStore } = a.store as any;
         return safeStore;
       })
    };

    return res.json({ message: "Login realizado com sucesso", user: publicData });
  }, "validar 2FA");
}
