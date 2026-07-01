import nodemailer from 'nodemailer';
import { prisma } from '../lib/prisma';

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  fromEmail: string;
}

/**
 * Remove caracteres perigosos para evitar XSS em templates de email.
 * Ex: <script>alert('xss')</script> → &lt;script&gt;alert('xss')&lt;/script&gt;
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function getSmtpConfig(): Promise<SmtpConfig | null> {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { chave: 'SMTP_CONFIG' } });
    return (setting?.valor as unknown as SmtpConfig) || null;
  } catch {
    return null;
  }
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  smtpOverride?: SmtpConfig
): Promise<boolean> {
  const config = smtpOverride || (await getSmtpConfig());
  if (!config?.host) throw new Error('SMTP não configurado');

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.password },
  });

  try {
    await transporter.sendMail({
      from: config.fromEmail || 'noreply@lancepelozap.com.br',
      to,
      subject,
      html,
    });
    return true;
  } catch (error: any) {
    console.error('[EMAIL] Falha ao enviar para', to, error.message);
    throw new Error(`Falha ao enviar email: ${error.message}`);
  }
}

/**
 * Envia email com link para redefinir senha.
 * NUNCA inclui a senha atual no corpo do email.
 */
export async function sendPasswordReset(email: string, resetLink: string): Promise<boolean> {
  const link = escapeHtml(resetLink);
  return sendEmail(
    email,
    'Recuperação de Senha - Lance Pelo Zap',
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#059669">Recuperação de Senha</h2>
      <p>Recebemos uma solicitação de recuperação de senha para sua conta.</p>
      <p>Clique no botão abaixo para criar uma nova senha:</p>
      <a href="${link}" style="display:inline-block;background:#059669;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">
        Redefinir Senha
      </a>
      <p style="color:#6b7280;font-size:12px">Se não foi você, ignore este email. Sua conta está segura.</p>
      <p style="color:#6b7280;font-size:12px">Este link expira em 1 hora.</p>
    </div>`
  );
}

/**
 * Email de boas-vindas com link para definir a senha.
 * ⚠️ NUNCA enviar a senha por email — apenas link de ativação.
 */
export async function sendPendingApproval(email: string, nome: string): Promise<boolean> {
  const nomeSeguro = escapeHtml(nome);
  return sendEmail(
    email,
    'Cadastro recebido - Controle de Vendas e Finanças',
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#059669">Olá, ${nomeSeguro}!</h2>
      <p>Seu cadastro foi recebido com sucesso!</p>
      <p>Sua solicitação está <strong>aguardando análise</strong> do administrador. Você receberá outro e-mail assim que sua conta for aprovada.</p>
      <p><strong>O que acontece agora?</strong></p>
      <ul>
        <li>✅ Cadastro recebido</li>
        <li>⏳ Análise do administrador</li>
        <li>📧 Você receberá um e-mail de confirmação</li>
        <li>🚀 Acesso liberado ao sistema</li>
      </ul>
      <p style="color:#6b7280;font-size:12px">Se tiver dúvidas, entre em contato pelo WhatsApp (11) 96640-1931</p>
    </div>`
  );
}

export async function sendAccountApproved(email: string, nome: string): Promise<boolean> {
  const nomeSeguro = escapeHtml(nome);
  return sendEmail(
    email,
    'Conta aprovada - Controle de Vendas e Finanças',
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#059669">Bem-vindo, ${nomeSeguro}!</h2>
      <p>Sua conta foi <strong>aprovada</strong>! 🎉</p>
      <p>Você já pode acessar o sistema e começar a usar todos os recursos.</p>
      <a href="https://app.lancepelozap.com.br/login" style="display:inline-block;background:#059669;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">
        Acessar Sistema
      </a>
      <p style="color:#6b7280;font-size:12px">Dúvidas? Fale conosco pelo WhatsApp (11) 96640-1931</p>
    </div>`
  );
}

export async function sendNewTicketNotification(storeName: string, subject: string, ticketId: string): Promise<boolean> {
  return sendEmail(
    'contato@lancepelozap.com.br',
    `[Chamado] ${subject} - ${storeName}`,
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#059669">Novo Chamado de Suporte</h2>
      <p><strong>Loja:</strong> ${escapeHtml(storeName)}</p>
      <p><strong>Assunto:</strong> ${escapeHtml(subject)}</p>
      <a href="https://app.lancepelozap.com.br/admin/chamados" style="display:inline-block;background:#059669;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">
        Ver Chamado
      </a>
    </div>`
  );
}

export async function sendWelcomeEmail(
  email: string,
  nome: string,
  activationLink: string
): Promise<boolean> {
  const nomeSeguro = escapeHtml(nome);
  const link = escapeHtml(activationLink);
  return sendEmail(
    email,
    'Bem-vindo ao Lance Pelo Zap!',
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#059669">Bem-vindo, ${nomeSeguro}!</h2>
      <p>Sua conta foi criada com sucesso.</p>
      <p><strong>Email de acesso:</strong> ${escapeHtml(email)}</p>
      <p>Clique no link abaixo para ativar sua conta e definir sua senha:</p>
      <a href="${link}" style="display:inline-block;background:#059669;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">
        Ativar Minha Conta
      </a>
      <p style="color:#6b7280;font-size:12px">Este link expira em 24 horas.</p>
    </div>`
  );
}
