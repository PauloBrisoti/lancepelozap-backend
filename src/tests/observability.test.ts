import { describe, it, expect } from 'vitest';
import { Writable } from 'stream';
import { AppLogger, sanitize, maskSecretsInString, runWithContext, setContext } from '../lib/logger';

/** Captura as linhas JSON emitidas por um logger de teste. */
function captureLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString().trim());
      cb();
    },
  });
  const log = new AppLogger({ level: 'trace', destination: stream });
  return { log, lines };
}

function parseLine(line: string): Record<string, unknown> {
  return JSON.parse(line);
}

describe('Observabilidade — sanitização (data masking)', () => {
  it('mascara senhas/tokens em qualquer profundidade', () => {
    const { log, lines } = captureLogger();
    log.info('login', {
      password: 'super-secreta',
      nested: { passwordHash: 'abc123', resetToken: 'tok-xyz' },
      headers: { authorization: 'Bearer abc.def.ghi' },
    });
    const entry = parseLine(lines[0]);
    expect(entry.password).toBe('[REDACTED]');
    expect((entry.nested as any).passwordHash).toBe('[REDACTED]');
    expect((entry.nested as any).resetToken).toBe('[REDACTED]');
    expect((entry.headers as any).authorization).toBe('[REDACTED]');
    expect(JSON.stringify(entry)).not.toContain('super-secreta');
    expect(JSON.stringify(entry)).not.toContain('abc123');
    expect(JSON.stringify(entry)).not.toContain('Bearer');
  });

  it('mascara dados pessoais parcialmente (CPF, e-mail, telefone)', () => {
    const { log, lines } = captureLogger();
    log.info('cliente criado', { cpf: '12345678900', email: 'joao.silva@example.com', telefone: '11987654321' });
    const entry = parseLine(lines[0]);
    expect(String(entry.cpf)).not.toContain('12345678900');
    expect(String(entry.email)).not.toContain('joao.silva@example.com');
    expect(String(entry.telefone)).not.toContain('11987654321');
    expect(String(entry.cpf)).toContain('***');
    // prefixo/sufixo visíveis para diagnóstico
    expect(String(entry.cpf).startsWith('123')).toBe(true);
    expect(String(entry.cpf).endsWith('00')).toBe(true);
  });

  it('não mascara campos de negócio inofensivos', () => {
    const { log, lines } = captureLogger();
    log.info('venda', { saleId: 'VENDA-123', valor: 99.9, status: 'PAGO' });
    const entry = parseLine(lines[0]);
    expect(entry.saleId).toBe('VENDA-123');
    expect(entry.valor).toBe(99.9);
  });

  it('redige segredos embutidos em strings (query strings, mensagens)', () => {
    expect(maskSecretsInString('https://app.x/reset?token=abc123&x=1')).not.toContain('abc123');
    expect(maskSecretsInString('Bearer token=xyz')).not.toContain('xyz');
    expect(maskSecretsInString('mensagem normal sem segredo')).toBe('mensagem normal sem segredo');
  });

  it('nunca grava dados sensíveis em mensagens de erro', () => {
    const { log, lines } = captureLogger();
    const err = new Error('Falha ao logar com senha=topsecret');
    log.error('erro de autenticação', err, { cpf: '11122233344' });
    const entry = parseLine(lines[0]);
    expect(JSON.stringify(entry)).not.toContain('topsecret');
    expect(JSON.stringify(entry)).not.toContain('11122233344');
    expect((entry.err as any).message).toContain('[REDACTED]');
  });
});

describe('Observabilidade — contexto por requisição (AsyncLocalStorage)', () => {
  it('injetá requestId automaticamente via mixin', () => {
    const { log, lines } = captureLogger();
    runWithContext({ requestId: 'req-12345' }, () => {
      log.info('dentro da requisição', { acao: 'x' });
    });
    const entry = parseLine(lines[0]);
    expect(entry.requestId).toBe('req-12345');
  });

  it('setContext adiciona userId/storeId/role aos logs seguintes', () => {
    const { log, lines } = captureLogger();
    runWithContext({ requestId: 'req-1' }, () => {
      setContext({ userId: 'user-42', storeId: 'store-7', role: 'MANAGER' });
      log.warn('estoque baixo', { productId: 'p1' });
    });
    const entry = parseLine(lines[0]);
    expect(entry.userId).toBe('user-42');
    expect(entry.storeId).toBe('store-7');
    expect(entry.role).toBe('MANAGER');
    expect(entry.requestId).toBe('req-1');
  });

  it('logs fora de requisição não carregam contexto de outra', () => {
    const { log, lines } = captureLogger();
    runWithContext({ requestId: 'req-a' }, () => log.info('a'));
    log.info('b'); // fora do contexto
    const [first, second] = lines.map(parseLine);
    expect(first.requestId).toBe('req-a');
    expect(second.requestId).toBeUndefined();
  });
});

describe('Observabilidade — níveis e estrutura', () => {
  it('emite os 5 níveis com level correto (debug..fatal)', () => {
    const { log, lines } = captureLogger();
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e', new Error('boom'));
    log.fatal('f', new Error('morte'));
    const levels = lines.map(parseLine).map((l) => l.level);
    expect(levels).toEqual(['debug', 'info', 'warn', 'error', 'fatal']);
  });

  it('saída é JSON estruturado com timestamp', () => {
    const { log, lines } = captureLogger();
    log.info('ola');
    const entry = parseLine(lines[0]);
    expect(typeof entry.time).toBe('string');
    expect(entry.msg).toBe('ola');
    expect(entry.service).toBe('saas-backend');
  });

  it('sanitize é determinístico para objetos puros', () => {
    expect(sanitize({ a: { b: { token: 'x' } } })).toEqual({ a: { b: { token: '[REDACTED]' } } });
  });
});
