import { HttpError } from '../lib/asyncHandler';
import { parseDate as parseStoreDate } from '../lib/dateUtils';

export type BankStatementType = 'CREDITO' | 'DEBITO';

export interface ParsedBankStatementItem {
  data: Date;
  descricao: string;
  valor: number;
  tipo: BankStatementType;
}

export interface ParsedBankStatement {
  format: 'CSV' | 'OFX';
  banco?: string;
  items: ParsedBankStatementItem[];
}

const DATE_HEADERS = new Set([
  'data', 'date', 'datatransacao', 'datamovimento', 'dtlancamento',
  'dtmovimento', 'datalancamento', 'databalancete', 'posteddate',
]);

const DESCRIPTION_HEADERS = new Set([
  'descricao', 'historico', 'memo', 'description', 'detalhe', 'detalhes',
  'lancamento', 'nome', 'payee', 'estabelecimento',
]);

const VALUE_HEADERS = new Set([
  'valor', 'amount', 'value', 'montante', 'valorlancamento', 'valortransacao',
]);

const TYPE_HEADERS = new Set([
  'tipo', 'type', 'natureza', 'tipolancamento', 'debitocredito', 'credito_debito',
]);

function stripBom(value: string): string {
  return value.replace(/^\uFEFF/, '');
}

function normalizeLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function detectDelimiter(line: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char in counts) counts[char]++;
  }

  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : ',';
}

function splitCsvRecords(content: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (char === '"') {
      if (inQuotes && content[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      record.push(cell);
      cell = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && content[i + 1] === '\n') i++;
      record.push(cell);
      records.push(record);
      record = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || record.length > 0) {
    record.push(cell);
    records.push(record);
  }

  return records;
}

function parseAmount(raw: string): number | null {
  let value = String(raw ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(/R\$/gi, '')
    .replace(/[^\d.,()+-]/g, '');

  if (!value) return null;

  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  if (value.startsWith('-')) {
    negative = true;
    value = value.slice(1);
  } else if (value.startsWith('+')) {
    value = value.slice(1);
  }
  if (value.endsWith('-')) {
    negative = true;
    value = value.slice(0, -1);
  }

  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');
  let normalized: string;

  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot
      ? value.replace(/\./g, '').replace(',', '.')
      : value.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const parts = value.split(',');
    const isThousands = parts.length > 2 || (parts.length === 2 && parts[1].length === 3);
    normalized = isThousands ? value.replace(/,/g, '') : value.replace(',', '.');
  } else if (lastDot >= 0) {
    const parts = value.split('.');
    const isThousands = parts.length > 2 || (parts.length === 2 && parts[1].length === 3);
    normalized = isThousands ? value.replace(/\./g, '') : value;
  } else {
    normalized = value;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

export function normalizeStatementType(raw?: string | null): BankStatementType | null {
  if (!raw) return null;
  const value = normalizeLabel(raw);

  if (['c', 'credito', 'credit', 'cr', 'entrada', 'recebimento', 'deposito'].some((term) => value === term)) {
    return 'CREDITO';
  }
  if (['d', 'debito', 'debit', 'db', 'saida', 'pagamento', 'saque'].some((term) => value === term)) {
    return 'DEBITO';
  }
  if (value.includes('credit') || value.includes('cred') || value.includes('entrada') || value.includes('receb') || value.includes('depos')) {
    return 'CREDITO';
  }
  if (value.includes('debit') || value.includes('deb') || value.includes('saida') || value.includes('pag') || value.includes('saque')) {
    return 'DEBITO';
  }
  return null;
}

function buildDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;

  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
  const parsed = parseStoreDate(iso);
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

export function parseStatementDate(raw?: string | null): Date | null {
  if (!raw) return null;
  const value = raw.trim();

  let match = value.match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    return buildDate(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
  }

  match = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    return buildDate(year, Number(match[2]), Number(match[1]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
  }

  match = value.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?/);
  if (match) {
    return buildDate(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
  }

  const fallback = parseStoreDate(value);
  return fallback && !Number.isNaN(fallback.getTime()) ? fallback : null;
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .trim();
}

function extractTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<\\s*${tag}\\s*>([^<\\r\\n]*)`, 'i'));
  return match ? decodeXml(match[1]) : null;
}

export class BankStatementParserService {
  static parse(content: string, filename = ''): ParsedBankStatement {
    if (!content || !content.trim()) {
      throw new HttpError('Arquivo de extrato vazio.', 400);
    }

    const looksLikeOfx = /<OFX>/i.test(content) || /<STMTTRN>/i.test(content) || filename.toLowerCase().endsWith('.ofx');
    if (looksLikeOfx) {
      const result = BankStatementParserService.parseOFX(content);
      return { format: 'OFX', banco: result.banco, items: result.items };
    }

    return { format: 'CSV', items: BankStatementParserService.parseCSV(content) };
  }

  static parseCSV(content: string): ParsedBankStatementItem[] {
    const clean = stripBom(content).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const firstLine = clean.split('\n').find((line) => line.trim().length > 0) || '';
    const delimiter = detectDelimiter(firstLine);

    const rows = splitCsvRecords(clean, delimiter)
      .map((row) => row.map((cell) => cell.trim()))
      .filter((row) => row.some((cell) => cell.length > 0));

    if (rows.length === 0) {
      throw new HttpError('Nenhum lançamento encontrado no arquivo CSV.', 400);
    }

    const headers = rows[0].map(normalizeLabel);
    const findColumn = (aliases: Set<string>) => headers.findIndex((header) => aliases.has(header));

    let dataIndex = findColumn(DATE_HEADERS);
    let descriptionIndex = findColumn(DESCRIPTION_HEADERS);
    let valueIndex = findColumn(VALUE_HEADERS);
    let typeIndex = findColumn(TYPE_HEADERS);
    let firstDataRow = 1;

    if (dataIndex < 0 || valueIndex < 0) {
      dataIndex = 0;
      descriptionIndex = 1;
      valueIndex = 2;
      typeIndex = 3;
      firstDataRow = 0;
    }

    const items: ParsedBankStatementItem[] = [];

    for (let i = firstDataRow; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every((cell) => cell.length === 0)) continue;

      const data = parseStatementDate(row[dataIndex]);
      const signedValue = parseAmount(row[valueIndex] ?? '');
      if (!data || signedValue === null) continue;

      const rawType = typeIndex >= 0 ? row[typeIndex] : undefined;
      const explicitType = normalizeStatementType(rawType);
      const tipo = explicitType ?? (signedValue < 0 ? 'DEBITO' : 'CREDITO');
      const descricao = (descriptionIndex >= 0 ? row[descriptionIndex] : '')?.trim() || 'Lançamento bancário';

      items.push({
        data,
        descricao,
        valor: Math.abs(signedValue),
        tipo,
      });
    }

    if (items.length === 0) {
      throw new HttpError(
        'Nenhum lançamento válido encontrado no CSV. Verifique as colunas de data e valor.',
        400,
      );
    }

    return items;
  }

  static parseOFX(content: string): { banco?: string; items: ParsedBankStatementItem[] } {
    const clean = stripBom(content);

    let blocks = Array.from(clean.matchAll(/<\s*STMTTRN\s*>([\s\S]*?)<\s*\/\s*STMTTRN\s*>/gi), (match) => match[1]);
    if (blocks.length === 0) {
      blocks = clean
        .split(/<\s*STMTTRN\s*>/i)
        .slice(1)
        .map((block) => block.split(/<\s*\/\s*BANKTRANLIST\s*>/i)[0]);
    }

    const items: ParsedBankStatementItem[] = [];

    for (const block of blocks) {
      const amountRaw = extractTag(block, 'TRNAMT');
      if (!amountRaw) continue;

      const signedValue = parseAmount(amountRaw);
      if (signedValue === null) continue;

      const data = parseStatementDate(extractTag(block, 'DTPOSTED'));
      if (!data) continue;

      const explicitType = normalizeStatementType(extractTag(block, 'TRNTYPE'));
      const tipo = signedValue !== 0
        ? (signedValue < 0 ? 'DEBITO' : 'CREDITO')
        : (explicitType ?? 'CREDITO');

      const descricao = extractTag(block, 'MEMO')
        || extractTag(block, 'NAME')
        || extractTag(block, 'PAYEE')
        || 'Lançamento bancário';

      items.push({
        data,
        descricao,
        valor: Math.abs(signedValue),
        tipo,
      });
    }

    if (items.length === 0) {
      throw new HttpError(
        'Nenhum lançamento OFX válido encontrado no arquivo.',
        400,
      );
    }

    const banco = extractTag(clean, 'ORG') || undefined;
    return { banco, items };
  }
}
