import { Request, Response } from "express";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import { prisma } from "../lib/prisma";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret";

export class TwoFactorController {
  // Gera o segredo e o QRCode para o usuário logado
  async generateSecret(req: Request, res: Response) {
    try {
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
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Erro ao gerar 2FA" });
    }
  }

  // Valida o primeiro código para ATIVAR o 2FA definitivamente
  async enable2FA(req: Request, res: Response) {
    try {
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

      return res.json({ message: "2FA ativado com sucesso!" });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Erro ao ativar 2FA" });
    }
  }

  // Rota pública para quem recebeu require2FA no login
  async validateLogin(req: Request, res: Response) {
    try {
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

      const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
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

      // Código válido! Emitir o JWT real
      const authToken = jwt.sign(
        { userId: user.id, email: user.email, role: user.role, storeId: decoded.storeId },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      res.cookie("authToken", authToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      // Fetch user access info to return proper availableStores
      const userWithRelations = await prisma.user.findUnique({
        where: { id: user.id },
        include: {
          clientAccess: true,
          storeAccess: { include: { store: { include: { control: true } } } }
        }
      });
      const publicData = {
         id: user.id,
         nome: user.nome,
         email: user.email,
         role: user.role,
         ativo: user.ativo,
         storeAccess: userWithRelations?.storeAccess,
         availableStores: userWithRelations?.storeAccess.map(a => a.store)
      };

      return res.json({ message: "Login realizado com sucesso", user: publicData });

    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Erro ao validar 2FA" });
    }
  }
}
