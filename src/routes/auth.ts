import { Router } from "express";
import { login, logout, me, forgotPassword, resetPassword, updateProfile, completeProfile } from "../controllers/authController";
import { registerTenant } from "../controllers/OnboardingController";
import { TwoFactorController } from "../controllers/TwoFactorController";
import { requireAuth } from "../middleware/auth";
import { validate, loginSchema, registerSchema, completeProfileSchema } from "../lib/validation";
import rateLimit from "express-rate-limit";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 100 : 20,
  message: { error: "Muitas tentativas de login. Tente novamente mais tarde." },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10, // máximo 10 tentativas por IP por hora
  message: { error: "Muitas tentativas de cadastro. Tente novamente mais tarde." },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Não conta requisições bem-sucedidas
});

// POST /api/auth/login  -> Login de usuário (com validação Zod + rate limit)
authRouter.post("/login", validate(loginSchema), loginLimiter, login);

// POST /api/auth/logout -> Logout de usuário
authRouter.post("/logout", logout);

// GET /api/auth/me      -> Retorna dados do usuário autenticado
authRouter.get("/me", requireAuth, me);

// PUT /api/auth/profile -> Atualiza nome/email/senha do próprio usuário
authRouter.put("/profile", requireAuth, updateProfile);

// POST /api/auth/register -> Cadastro de Nova Loja (com validação + rate limit)
authRouter.post("/register", validate(registerSchema), registerLimiter, registerTenant);

const twoFactorController = new TwoFactorController();
authRouter.get("/2fa/generate", requireAuth, twoFactorController.generateSecret);
authRouter.post("/2fa/enable", requireAuth, twoFactorController.enable2FA);
authRouter.post("/2fa/validate", twoFactorController.validateLogin);

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5, // máximo 5 solicitações por IP por hora
  message: { error: "Muitas solicitações de recuperação. Tente novamente mais tarde." },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/auth/forgot-password -> Solicita link de recuperação de senha
authRouter.post("/forgot-password", forgotPasswordLimiter, forgotPassword);

// POST /api/auth/reset-password -> Redefine a senha com o token
authRouter.post("/reset-password", resetPassword);

// POST /api/auth/complete-profile -> Cliente completa dados do cadastro pós-aprovação
authRouter.post("/complete-profile", requireAuth, validate(completeProfileSchema), completeProfile);
