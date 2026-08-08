import fs from 'fs';
import path from 'path';
import { Request, Response, NextFunction } from 'express';

/**
 * Validação de conteúdo real de arquivos (magic bytes).
 *
 * Extensão e MIME type do cliente são forjáveis — a única verificação confiável
 * é a assinatura binária no início do arquivo. Cada tipo de upload deve chamar
 * validateFileMagic() com a lista de tipos que aceita, ANTES de processar o arquivo.
 */

export type FileKind =
  | 'jpeg'
  | 'png'
  | 'gif'
  | 'webp'
  | 'pdf'
  | 'xlsx'
  | 'xls'
  | 'csv'
  | 'text';

interface MagicRule {
  kind: FileKind;
  /** Bytes exatos no início (hex, sem espaços). */
  signature: string;
  offset?: number;
  /** Extensões aceitas como fallback quando o arquivo é vazio (0 bytes). */
  extensions: string[];
}

const MAGIC_RULES: MagicRule[] = [
  { kind: 'jpeg', signature: 'ffd8ff', extensions: ['.jpg', '.jpeg'] },
  { kind: 'png', signature: '89504e470d0a1a0a', extensions: ['.png'] },
  { kind: 'gif', signature: '4749463837', extensions: ['.gif'] },
  { kind: 'gif', signature: '4749463839', extensions: ['.gif'] },
  { kind: 'webp', signature: '52494646', offset: 0, extensions: ['.webp'] },
  { kind: 'pdf', signature: '25504446', extensions: ['.pdf'] },
  { kind: 'xlsx', signature: '504b0304', extensions: ['.xlsx'] }, // ZIP (OOXML)
  { kind: 'xls', signature: 'd0cf11e0a1b11ae1', extensions: ['.xls'] }, // OLE2
  { kind: 'text', signature: '', extensions: ['.csv', '.txt'] },
];

/** WEBP é RIFF + 'WEBP' nos bytes 8..11. */
const WEBP_MARKER = '57454250';

/**
 * Lê os primeiros bytes do arquivo e retorna o(s) tipo(s) detectado(s).
 * Retorna lista vazia se o conteúdo não corresponde a nenhuma assinatura.
 */
export function detectFileKind(filePath: string): FileKind[] {
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return [];
  }
  try {
    const buffer = Buffer.alloc(16);
    const read = fs.readSync(fd, buffer, 0, 16, 0);
    const head = buffer.subarray(0, read).toString('hex').toLowerCase();

    if (read === 0) return []; // arquivo vazio nunca é aceitável

    // WEBP: RIFF (52494646) + tamanho (4 bytes) + WEBP (57454250)
    if (head.startsWith('52494646') && head.length >= 24 && head.slice(16, 24) === WEBP_MARKER.toLowerCase()) {
      return ['webp'];
    }

    const found: FileKind[] = [];
    for (const rule of MAGIC_RULES) {
      if (rule.kind === 'text') continue; // texto tratado abaixo
      if (rule.signature && head.startsWith(rule.signature, rule.offset || 0)) {
        if (!found.includes(rule.kind)) found.push(rule.kind);
      }
    }

    // Texto puro (CSV/JSON/outros): sem bytes binários controlados nos 16 primeiros
    if (found.length === 0 && isPrintableText(head)) {
      found.push('text');
    }
    return found;
  } finally {
    fs.closeSync(fd);
  }
}

/** Hex de bytes imprimíveis (exclui NUL, ESC e bytes binários comuns). */
function isPrintableText(hex: string): boolean {
  const bytes = Buffer.from(hex, 'hex');
  return bytes.every(
    (b) =>
      b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e) || b >= 0x80
  );
}

/**
 * Valida um arquivo enviado: o conteúdo real precisa corresponder a um dos
 * tipos permitidos (pela assinatura binária). A extensão é conferida como
 * camada extra (o usuário pode renomear, mas não reverter o magic bytes).
 *
 * @param filePath caminho do arquivo gravado pelo multer
 * @param originalName nome original (para conferir a extensão)
 * @param allowed tipos aceitos para este endpoint
 * @returns mensagem de erro, ou null se válido
 */
export function validateFileMagic(
  filePath: string,
  originalName: string,
  allowed: FileKind[]
): string | null {
  const ext = path.extname(originalName).toLowerCase();
  const detected = detectFileKind(filePath);

  if (detected.length === 0) {
    return 'Arquivo inválido ou corrompido: conteúdo não reconhecido.';
  }

  const matchesAllowed = detected.some((k) => allowed.includes(k));
  if (!matchesAllowed) {
    return 'Tipo de arquivo não permitido: o conteúdo não corresponde à extensão informada.';
  }

  // Camada extra: extensão deve pertencer a um dos tipos permitidos.
  const extOk = allowed.some((k) =>
    MAGIC_RULES.filter((r) => r.kind === k).some((r) => r.extensions.includes(ext))
  );
  if (!extOk) {
    return `Extensão .${ext.replace('.', '')} não permitida.`;
  }

  return null;
}

/** Tipos de imagem (PIX, comprovantes, anexos). */
export const IMAGE_KINDS: FileKind[] = ['jpeg', 'png', 'gif', 'webp'];
/** Planilhas (imports, planilha, anexos). */
export const SPREADSHEET_KINDS: FileKind[] = ['xlsx', 'xls', 'csv'];
/** Documentos (comprovantes, anexos, catálogo). */
export const DOCUMENT_KINDS: FileKind[] = ['pdf'];

/**
 * Middleware Express para uso APÓS upload.single()/upload.array() do multer:
 * valida o conteúdo real do arquivo (magic bytes) e a extensão. Em falha,
 * remove o arquivo gravado e responde 400.
 */
export function validateUpload(allowed: FileKind[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const file = req.file;
    if (!file) return next(); // ausência de arquivo é tratada pelo controller

    const error = validateFileMagic(file.path, file.originalname, allowed);
    if (error) {
      fs.unlink(file.path, () => {});
      return res.status(400).json({ error });
    }
    next();
  };
}
