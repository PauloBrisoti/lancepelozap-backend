interface SendParams {
  apiUrl: string;
  apiKey: string;
  phone: string;       // 5511999999999 format
  message: string;
}

interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

import http from 'http';

function fetchUrl(urlStr: string, options: any, body: string): Promise<Response> {
  // Handle IPv6 URLs manually since Node.js fetch doesn't support them
  const match = urlStr.match(/^http:\/\/\[([a-fA-F0-9:]+)\]:(\d+)(\/.*)?$/);
  if (match) {
    const [, host, port, path] = match;
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: host,
        port: parseInt(port),
        path: path || '/',
        method: options.method || 'POST',
        headers: options.headers || {},
        family: 6,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            ok: res.statusCode && res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode || 500,
            json: async () => JSON.parse(Buffer.concat(chunks).toString()),
            text: async () => Buffer.concat(chunks).toString(),
          } as Response);
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
  return fetch(urlStr, options);
}

export async function sendWhatsApp({ apiUrl, apiKey, phone, message }: SendParams): Promise<SendResult> {
  const cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length < 10) return { success: false, error: 'Telefone inválido' };

  try {
    const body = JSON.stringify({
      number: cleanPhone,
      text: message,
      options: { delay: 0, linkPreview: false },
    });

    const response = await fetchUrl(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'api-key': apiKey, 'Client-Token': apiKey } : {}),
      },
    }, body);

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${text}` };
    }

    const data = await response.json();
    return { success: true, messageId: data?.id || data?.messageId || 'ok' };
  } catch (error: any) {
    return { success: false, error: error.message || 'Erro de conexão com API WhatsApp' };
  }
}
