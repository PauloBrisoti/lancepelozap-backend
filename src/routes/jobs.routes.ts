import { getErrorMessage } from '../lib/errors';
import { Router, Request, Response } from 'express';
import { rateLimitDistributed, limitFor } from '../lib/rateLimit';
import { requireCronSecret } from '../middleware/requireCronSecret';
import { processarCobrancasRecorrentes } from '../services/PetRecorrenciaCron';
import { processarLembretesHospedagem } from '../services/PetLembretesService';
import { executarVarreduraAutomatica } from '../services/VarreduraFinanceiraService';

const router = Router();

// Mesmo work dos jobs é caro: limite por IP, distribuído.
router.use(rateLimitDistributed({
  keyPrefix: 'jobs',
  keys: { ip: true },
  limits: [
    { windowMs: 60 * 1000, max: limitFor(10) },
    { windowMs: 60 * 60 * 1000, max: limitFor(60) },
  ],
  message: 'Muitas execuções de job. Tente novamente mais tarde.',
}));

// Gate de segredo (timing-safe, query string bloqueada)
router.use(requireCronSecret);

const wrap = (fn: () => Promise<void>) => async (_req: Request, res: Response) => {
  try {
    await fn();
    res.json({ ok: true, executedAt: new Date().toISOString() });
  } catch (err: unknown) {
    res.status(500).json({ ok: false, error: getErrorMessage(err) || 'Erro interno' });
  }
};

// POST /api/jobs/ping — validação de credencial SEM efeito colateral
// (usado em smoke tests e monitoramento externo)
router.post('/ping', (_req, res) => {
  res.json({ ok: true, executedAt: new Date().toISOString() });
});

// POST /api/jobs/pet-recorrencia — cobranças recorrentes de pet (cron diário 02:00)
router.post('/pet-recorrencia', wrap(processarCobrancasRecorrentes));

// POST /api/jobs/pet-lembretes — lembretes de hospedagem (cron diário 08:00)
router.post('/pet-lembretes', wrap(processarLembretesHospedagem));

// POST /api/jobs/varredura-financeira — varredura financeira (cron diário 09:00)
router.post('/varredura-financeira', wrap(executarVarreduraAutomatica));

export { router as jobsRoutes };
