export class WhatsAppService {
  private baseUrl: string;
  private token: string;
  private instance: string;

  constructor(baseUrl: string, token: string, instance: string = 'default') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
    this.instance = instance;
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'api-key': this.token,
    };
  }

  async sendText(phoneNumber: string, text: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseUrl}/message/sendText/${this.instance}`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({
            number: phoneNumber.replace(/\D/g, ''),
            text,
            options: { delay: 1000, presence: 'composing' },
          }),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        console.error('Evolution API error:', err);
        return false;
      }

      return true;
    } catch (error) {
      console.error('WhatsApp send error:', error);
      return false;
    }
  }

  async sendMedia(
    phoneNumber: string,
    mediaUrl: string,
    caption?: string
  ): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseUrl}/message/sendMedia/${this.instance}`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({
            number: phoneNumber.replace(/\D/g, ''),
            options: { delay: 1000, presence: 'composing' },
            mediaMessage: {
              mediatype: 'image',
              media: mediaUrl,
              caption: caption || '',
            },
          }),
        }
      );

      return response.ok;
    } catch (error) {
      console.error('WhatsApp media error:', error);
      return false;
    }
  }

  async checkConnection(): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseUrl}/instance/connectionState/${this.instance}`,
        { headers: this.getHeaders() }
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  formatPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 11 || digits.length === 10) {
      return `55${digits}`;
    }
    if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
      return digits;
    }
    return digits;
  }
}
