import crypto from 'crypto';
import { logger } from '../lib/logger';

const WUZAPI_URL = process.env.WUZAPI_URL || 'http://wuzapi:8080';
const WUZAPI_ADMIN_TOKEN = process.env.WUZAPI_ADMIN_TOKEN || '';
const WUZAPI_HMAC_KEY = process.env.WUZAPI_HMAC_KEY || '';

if (!WUZAPI_ADMIN_TOKEN) {
  logger.warn('[WuzAPI] WUZAPI_ADMIN_TOKEN não configurado — rotas de admin não funcionarão');
}

export interface WuzapiSession {
  token: string;
  status: string;
  user?: string;
}

export interface WuzapiMessageResponse {
  success: boolean;
  message?: string;
  id?: string;
  error?: string;
}

export interface WuzapiQRCode {
  base64: string;
  raw?: string;
}

class WuzapiService {
  /**
   * Headers para requisições ao admin token (gerenciamento de sessões)
   */
  private adminHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': WUZAPI_ADMIN_TOKEN,
    };
  }

  /**
   * Headers para requisições com token de sessão do usuário
   */
  private userHeaders(sessionToken: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'token': sessionToken,
    };
  }

  /**
   * Valida HMAC de webhook recebido
   */
  validateWebhookSignature(payload: string, signature: string): boolean {
    if (!WUZAPI_HMAC_KEY) {
      logger.warn('[WuzAPI] WUZAPI_HMAC_KEY não configurado — validação HMAC desabilitada');
      return true;
    }
    const expected = crypto
      .createHmac('sha256', WUZAPI_HMAC_KEY)
      .update(payload)
      .digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(signature || ''),
      Buffer.from(expected)
    );
  }

  /**
   * Criar nova sessão WhatsApp (retorna token + QR code)
   * POST /session/connect
   */
  async createSession(instanceName: string): Promise<{ token: string; qr: string }> {
    const resp = await fetch(`${WUZAPI_URL}/session/connect`, {
      method: 'POST',
      headers: this.adminHeaders(),
      body: JSON.stringify({ name: instanceName }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`WuzAPI createSession failed (${resp.status}): ${text}`);
    }

    const data = await resp.json() as { token: string; status: string };
    logger.info(`[WuzAPI] Sessão criada: ${instanceName} (status: ${data.status})`);

    // Buscar QR code imediatamente
    const qr = await this.getQRCode(data.token);

    return { token: data.token, qr };
  }

  /**
   * Obter QR code de uma sessão
   * GET /session/qr
   */
  async getQRCode(sessionToken: string): Promise<string> {
    const resp = await fetch(`${WUZAPI_URL}/session/qr`, {
      method: 'GET',
      headers: this.userHeaders(sessionToken),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`WuzAPI getQR failed (${resp.status}): ${text}`);
    }

    const data = await resp.json() as { base64?: string; raw?: string };

    // WuzAPI retorna { base64: "data:image/png;base64,..." }
    // ou { base64: "iVBOR..." (sem prefixo data:image)
    if (data.base64) {
      return data.base64.startsWith('data:')
        ? data.base64
        : `data:image/png;base64,${data.base64}`;
    }

    return '';
  }

  /**
   * Verificar status da sessão
   * GET /session/status
   */
  async getSessionStatus(sessionToken: string): Promise<{ connected: boolean; status: string; user?: string }> {
    const resp = await fetch(`${WUZAPI_URL}/session/status`, {
      method: 'GET',
      headers: this.userHeaders(sessionToken),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`WuzAPI status failed (${resp.status}): ${text}`);
    }

    const data = await resp.json() as { status: string; user?: string };
    return {
      connected: data.status === 'connected',
      status: data.status,
      user: data.user,
    };
  }

  /**
   * Encerrar sessão (logout)
   * POST /session/logout
   */
  async logout(sessionToken: string): Promise<void> {
    const resp = await fetch(`${WUZAPI_URL}/session/logout`, {
      method: 'POST',
      headers: this.userHeaders(sessionToken),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`WuzAPI logout failed (${resp.status}): ${text}`);
    }

    logger.info('[WuzAPI] Sessão encerrada');
  }

  /**
   * Enviar mensagem de texto
   * POST /chat/send/text
   */
  async sendText(sessionToken: string, phone: string, message: string): Promise<WuzapiMessageResponse> {
    // Formatar telefone: apenas dígitos, com código do país
    const phoneClean = phone.replace(/\D/g, '');
    const phoneFormatted = phoneClean.startsWith('55') ? phoneClean : `55${phoneClean}`;

    const resp = await fetch(`${WUZAPI_URL}/chat/send/text`, {
      method: 'POST',
      headers: this.userHeaders(sessionToken),
      body: JSON.stringify({
        phone: phoneFormatted,
        message,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.error(`[WuzAPI] sendText failed (${resp.status}): ${text}`);
      return { success: false, error: text };
    }

    const data = await resp.json() as { id?: string; key?: { id?: string } };
    return {
      success: true,
      id: data.id || data.key?.id,
    };
  }

  /**
   * Enviar mensagem com imagem (para lembretes)
   * POST /chat/send/image
   */
  async sendImage(sessionToken: string, phone: string, imageUrl: string, caption?: string): Promise<WuzapiMessageResponse> {
    const phoneClean = phone.replace(/\D/g, '');
    const phoneFormatted = phoneClean.startsWith('55') ? phoneClean : `55${phoneClean}`;

    const resp = await fetch(`${WUZAPI_URL}/chat/send/image`, {
      method: 'POST',
      headers: this.userHeaders(sessionToken),
      body: JSON.stringify({
        phone: phoneFormatted,
        image: imageUrl,
        caption: caption || '',
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.error(`[WuzAPI] sendImage failed (${resp.status}): ${text}`);
      return { success: false, error: text };
    }

    const data = await resp.json() as { id?: string; key?: { id?: string } };
    return {
      success: true,
      id: data.id || data.key?.id,
    };
  }

  /**
   * Marcar mensagem como lida
   * POST /chat/markread
   */
  async markAsRead(sessionToken: string, messageId: string): Promise<void> {
    await fetch(`${WUZAPI_URL}/chat/markread`, {
      method: 'POST',
      headers: this.userHeaders(sessionToken),
      body: JSON.stringify({ id: messageId }),
    });
  }

  /**
   * Verificar se número está registrado no WhatsApp
   * POST /chat/whatsmeow/check
   */
  async checkNumber(sessionToken: string, phone: string): Promise<{ exists: boolean; number?: string }> {
    const phoneClean = phone.replace(/\D/g, '');
    const phoneFormatted = phoneClean.startsWith('55') ? phoneClean : `55${phoneClean}`;

    const resp = await fetch(`${WUZAPI_URL}/chat/whatsmeow/check`, {
      method: 'POST',
      headers: this.userHeaders(sessionToken),
      body: JSON.stringify({ phone: phoneFormatted }),
    });

    if (!resp.ok) {
      return { exists: false };
    }

    const data = await resp.json() as { registered?: boolean; jid?: string };
    return {
      exists: data.registered === true,
      number: data.jid,
    };
  }
}

export const wuzapiService = new WuzapiService();
