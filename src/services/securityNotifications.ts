import { escapeHtml, sendEmail } from './email.service';
import { logger } from '../lib/logger';

/**
 * Notificações de segurança (fire-and-forget): nunca quebram o fluxo —
 * qualquer falha de SMTP é apenas logada.
 */
async function notify(subject: string, html: string, to: string) {
  try {
    await sendEmail(to, subject, html);
  } catch (err) {
    logger.error('Falha ao enviar notificação de segurança:', err);
  }
}

function layout(title: string, body: string): string {
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
    <h2 style="color:#dc2626">${title}</h2>${body}
    <p style="color:#6b7280;font-size:12px">Se não foi você, altere sua senha imediatamente e contate o suporte.</p>
  </div>`;
}

export function notifyPasswordChanged(email: string): void {
  void notify('Sua senha foi alterada', layout('Sua senha foi alterada', '<p>Alguém alterou a senha da sua conta.</p>'), email);
}

export function notifyPasswordReset(email: string): void {
  void notify('Sua senha foi redefinida', layout('Sua senha foi redefinida', '<p>A senha da sua conta foi redefinida com sucesso.</p>'), email);
}

export function notifyNewDevice(email: string, ip: string, userAgent?: string): void {
  const ua = userAgent ? `<p>Navegador/dispositivo: <code>${escapeHtml(userAgent)}</code></p>` : '';
  void notify(
    'Novo login detectado na sua conta',
    layout('Novo login detectado', `<p>Houve um login na sua conta de um dispositivo não reconhecido.</p><p>IP: <code>${escapeHtml(ip)}</code></p>${ua}`),
    email
  );
}

export function notifyTwoFactorChanged(email: string, ativado: boolean): void {
  const msg = ativado ? 'A autenticação em duas etapas (2FA) foi ATIVADA na sua conta.' : 'A autenticação em duas etapas (2FA) foi DESATIVADA na sua conta.';
  void notify(
    ativado ? '2FA ativado' : '2FA desativado',
    layout(ativado ? '2FA ativado' : '2FA desativado', `<p>${msg}</p>`),
    email
  );
}
