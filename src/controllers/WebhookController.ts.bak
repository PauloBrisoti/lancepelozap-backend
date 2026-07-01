import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export class WebhookController {
  static async handleMercadoPago(req: Request, res: Response) {
    try {
      const { type, data } = req.body;
      const queryId = req.query.id as string;
      const topic = req.query.topic as string;

      console.log('--- NOVO WEBHOOK MERCADO PAGO ---');
      console.log('Query:', req.query);
      console.log('Body:', req.body);

      // Tratamento para API de Assinaturas (Preapproval)
      if (type === 'subscription_preapproval' || topic === 'subscription_preapproval') {
        const id = data?.id || queryId;
        if (id) {
          // 1. Buscar se a assinatura existe no banco
          const subscription = await prisma.subscription.findFirst({
            where: { mpPreapprovalId: id }
          });

          if (subscription) {
            // Em um ambiente real, aqui nós faríamos um GET na API do MP
            // usando o `id` recebido para conferir o status oficial.
            // Exemplo fictício baseado no status retornado:
            // const mpData = await fetch(`https://api.mercadopago.com/preapproval/${id}`, { headers: { Authorization: \`Bearer \${process.env.MP_ACCESS_TOKEN}\` } }).then(r => r.json());
            
            // Para efeitos práticos desta fase, vamos assumir que recebemos um status 'authorized' 
            // e vamos renovar a assinatura por 1 mês a partir de hoje.
            const novoVencimento = new Date();
            novoVencimento.setMonth(novoVencimento.getMonth() + 1);

            await prisma.subscription.update({
              where: { id: subscription.id },
              data: {
                statusPagamento: 'PAGO',
                dataVencimento: novoVencimento,
                mpStatus: 'authorized' // mock do status recebido
              }
            });

            console.log(`Assinatura ${subscription.id} renovada via Webhook!`);
          }
        }
      }

      // O MercadoPago exige retorno 200 rápido para webhooks
      return res.status(200).send('OK');
    } catch (error) {
      console.error('Erro no Webhook do Mercado Pago:', error);
      return res.status(500).send('Internal Error');
    }
  }
}
