import { Router } from "express";
import { login, logout, me, forgotPassword, resetPassword, updateProfile, completeProfile, verifyEmail, resendVerification } from "../controllers/authController";
import { registerTenant } from "../controllers/OnboardingController";
import { TwoFactorController } from "../controllers/TwoFactorController";
import { requireAuth } from "../middleware/auth";
import { requireVerifiedEmail } from "../middleware/requireVerifiedEmail";
import { validate, loginSchema, registerSchema, completeProfileSchema } from "../lib/validation";
import { rateLimitDistributed, limitFor } from "../lib/rateLimit";

export const authRouter = Router();

// Login: por IP (10/min, 20/15min, 60/h) e por e-mail (10/15min, 30/h)
// — impede spray de senha em conta específica e brute-force por IP.
const loginLimiter = rateLimitDistributed({
  keyPrefix: 'auth-login',
  keys: { ip: true, email: true },
  limits: [
    { windowMs: 60 * 1000, max: limitFor(10) },
    { windowMs: 15 * 60 * 1000, max: limitFor(20) },
    { windowMs: 60 * 60 * 1000, max: limitFor(60) },
  ],
  message: "Muitas tentativas de login. Tente novamente mais tarde.",
});

const registerLimiter = rateLimitDistributed({
  keyPrefix: 'auth-register',
  keys: { ip: true },
  limits: [{ windowMs: 60 * 60 * 1000, max: limitFor(10) }],
  message: "Muitas tentativas de cadastro. Tente novamente mais tarde.",
});

const forgotPasswordLimiter = rateLimitDistributed({
  keyPrefix: 'auth-forgot',
  keys: { ip: true, email: true },
  limits: [
    { windowMs: 60 * 60 * 1000, max: limitFor(5) },
  ],
  message: "Muitas solicitações de recuperação. Tente novamente mais tarde.",
});

const resetPasswordLimiter = rateLimitDistributed({
  keyPrefix: 'auth-reset',
  keys: { ip: true },
  limits: [
    { windowMs: 15 * 60 * 1000, max: limitFor(10) },
    { windowMs: 60 * 60 * 1000, max: limitFor(30) },
  ],
  message: "Muitas tentativas de redefinição de senha. Tente novamente mais tarde.",
});

const validateTwoFactorLimiter = rateLimitDistributed({
  keyPrefix: 'auth-2fa',
  keys: { ip: true, email: true },
  limits: [
    { windowMs: 15 * 60 * 1000, max: limitFor(10) },
  ],
  message: "Muitas tentativas de validação 2FA. Tente novamente mais tarde.",
});

const resendVerificationLimiter = rateLimitDistributed({
  keyPrefix: 'auth-resend-verify',
  keys: { ip: true, email: true },
  limits: [
    { windowMs: 60 * 60 * 1000, max: limitFor(3) },
  ],
  message: "Muitos reenvios de verificação. Tente novamente mais tarde.",
});

// POST /api/auth/login  -> Login de usuário (validação Zod + rate limit + lockout progressivo + CAPTCHA)
authRouter.post("/login", validate(loginSchema), loginLimiter, login);

// POST /api/auth/logout -> Logout de usuário
authRouter.post("/logout", logout);

// GET /api/auth/me      -> Retorna dados do usuário autenticado
authRouter.get("/me", requireAuth, me);

// PUT /api/auth/profile -> Atualiza nome/email/senha (e-mail confirmado é
// pré-requisito para contas self-service; invalida sessões e notifica)
authRouter.put("/profile", requireAuth, requireVerifiedEmail, updateProfile);

// POST /api/auth/register -> Cadastro de Nova Loja (anti-enumeração + e-mail de confirmação)
authRouter.post("/register", validate(registerSchema), registerLimiter, registerTenant);

// POST /api/auth/verify-email -> Confirma o e-mail via token (uso único, 48h)
authRouter.post("/verify-email", verifyEmail);

// POST /api/auth/resend-verification -> Reenvia o link de confirmação (resposta genérica)
authRouter.post("/resend-verification", resendVerificationLimiter, resendVerification);

const twoFactorController = new TwoFactorController();
authRouter.get("/2fa/generate", requireAuth, requireVerifiedEmail, twoFactorController.generateSecret);
authRouter.post("/2fa/enable", requireAuth, requireVerifiedEmail, twoFactorController.enable2FA);
authRouter.post("/2fa/disable", requireAuth, requireVerifiedEmail, twoFactorController.disable2FA);
authRouter.post("/2fa/validate", validateTwoFactorLimiter, twoFactorController.validateLogin);

// POST /api/auth/forgot-password -> Solicita link de recuperação de senha
authRouter.post("/forgot-password", forgotPasswordLimiter, forgotPassword);

// POST /api/auth/reset-password -> Redefine a senha com o token
authRouter.post("/reset-password", resetPasswordLimiter, resetPassword);

// POST /api/auth/complete-profile -> Cliente completa dados do cadastro pós-aprovação
authRouter.post("/complete-profile", requireAuth, validate(completeProfileSchema), completeProfile);
