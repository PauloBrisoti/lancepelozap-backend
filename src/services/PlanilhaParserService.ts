import { getErrorMessage } from '../lib/errors';
import ExcelJS from 'exceljs';
import { prisma } from '../lib/prisma';
import fs from 'fs';
import path from 'path';
import { parseDate as parseLocalDate } from '../lib/dateUtils';

// ============================================================
// SINÔNIMOS DE COLUNAS — Mapeamento semântico
// ============================================================
const COLUMN_SYNONYMS: Record<string, string[]> = {
  // Produtos
  nome: ['nome', 'nome do produto', 'produto', 'descrição', 'descricao', 'titulo', 'título', 'item', 'produto/serviço'],
  codigo: ['código', 'codigo', 'ref', 'referência', 'referencia', 'sku', 'ean', 'código de barras', 'codigo de barras'],
  categoria: ['categoria', 'grupo', 'departamento', 'seção', 'secao', 'tipo'],
  custo: ['custo', 'preço de custo', 'preco de custo', 'preço custo', 'preco custo', 'custo unitário', 'custo unitario', 'vlr. custo', 'valor custo', 'custo unit.', 'entrada (r$)', 'entrada r$'],
  venda: ['venda', 'preço', 'preco', 'preço de venda', 'preco de venda', 'preço venda', 'preco venda', 'valor', 'valor de venda', 'valor unitário', 'valor unitario', 'vlr. venda', 'valor venda', 'preço sugerido', 'preco sugerido', 'saida (r$)', 'saída (r$)', 'saldo (r$)', 'precovenda', 'preco_venda_sugerido'],
  estoque: ['estoque', 'qtd', 'quantidade', 'saldo', 'estoque atual', 'qtd. estoque', 'qtde', 'saldo atual'],
  unidade: ['unidade', 'und', 'un', 'medida'],

  // Clientes
  nomeCliente: ['nome', 'nome completo', 'cliente', 'cliente nome', 'nome do cliente', 'cliente'],
  cpf: ['cpf', 'documento', 'cpf/cnpj', 'doc', 'documento'],
  telefone: ['telefone', 'whatsapp', 'celular', 'tel', 'fone', 'telefone whatsapp'],
  email: ['email', 'e-mail', 'correio'],
  endereco: ['endereço', 'endereco', 'endereço completo', 'endereco completo'],

  // Vendas
  data: ['data', 'data da venda', 'data venda', 'dt', 'data do pedido'],
  produtoNome: ['produto', 'nome do produto', 'item', 'descrição', 'descricao'],
  quantidade: ['quantidade', 'qtd', 'qtde', 'qty', 'quant'],
  valorUnitario: ['valor unitário', 'valor unitario', 'preço unitário', 'preco unitario', 'vlr unitário', 'preco un.', 'r$ un.', 'preço un.'],
  valorTotal: ['total', 'valor total', 'valor', 'subtotal', 'total r$', 'total (r$)'],
  desconto: ['desconto', 'desc', 'desconto r$', 'desc.'],
  formaPagamento: ['forma pagamento', 'forma de pagamento', 'pagamento', 'tipo pagamento', 'pagto', 'condição', 'condicao'],
  parcelas: ['parcelas', 'parcela', 'nº parcelas', 'n parcelas', 'quantidade parcelas', 'qtd parcelas'],
  taxaMaquina: ['taxa', 'taxa máquina', 'taxa maquina', 'taxa cartão', 'taxa cartao', 'taxa operadora', '% taxa'],
  vendedor: ['vendedor', 'funcionário', 'funcionario', 'vendedor(a)', 'atendente'],
  sinal: ['sinal', 'entrada', 'sinal recebido', 'valor sinal'],
  clienteNome: ['cliente', 'nome cliente', 'cliente nome', 'comprador'],
  observacao: ['observação', 'observacao', 'obs', 'notas'],

  // Fiado / Crediário
  vencimento: ['vencimento', 'data vencimento', 'dt vencimento', 'data de vencimento', 'vcto'],
  valorParcela: ['valor parcela', 'vlr parcela', 'parcela valor'],
  status: ['status', 'situação', 'situacao', 'estado'],
};

// ============================================================
// TIPOS
// ============================================================
export interface SheetPreview {
  name: string;
  detectedType: SheetType;
  columns: string[];
  sampleRows: Record<string, string>[];
  rowCount: number;
}

export type SheetType = 'PRODUTOS' | 'CLIENTES' | 'VENDAS' | 'FIADO' | 'FUNCIONARIOS' | 'FORNECEDORES' | 'ESTOQUE_INICIAL' | 'DESCONHECIDA';

export interface ParsedData {
  produtos: ParsedProduct[];
  clientes: ParsedCustomer[];
  vendas: ParsedSale[];
  fiado: ParsedReceivable[];
  funcionarios: ParsedEmployee[];
  fornecedores: ParsedSupplier[];
}

export interface ParsedProduct {
  nome: string;
  codigo?: string;
  categoria?: string;
  custo: number;
  venda: number;
  estoque: number;
  unidade?: string;
}

export interface ParsedCustomer {
  nome: string;
  cpf?: string;
  telefone?: string;
  email?: string;
  endereco?: string;
}

export interface ParsedSale {
  data?: string;
  clienteNome?: string;
  produtos: SaleItem[];
  valorTotal: number;
  desconto: number;
  formaPagamento: string;
  parcelas: number;
  taxaMaquina: number;
  sinal: number;
  vendedor?: string;
  observacao?: string;
}

export interface SaleItem {
  nome: string;
  quantidade: number;
  valorUnitario: number;
}

export interface ParsedReceivable {
  clienteNome: string;
  valorParcela: number;
  vencimento?: string;
  numeroParcela: number;
  totalParcelas: number;
  status?: string;
}

export interface ParsedEmployee {
  nome: string;
  email: string;
  cargo: string;
}

export interface ParsedSupplier {
  nome: string;
  contato?: string;
  telefone?: string;
}

export interface ValidationError {
  sheet: string;
  row: number;
  field: string;
  message: string;
}

export interface ParseResult {
  success: boolean;
  preview: SheetPreview[];
  data?: ParsedData;
  errors: ValidationError[];
  warnings: string[];
}

// ============================================================
// SERVIÇO PRINCIPAL
// ============================================================
export class PlanilhaParserService {

  // ----------------------------------------------------------
  // 1. LER E DETECTAR ABAS
  // ----------------------------------------------------------
  static async readFile(filePath: string, originalName: string): Promise<{ workbook: ExcelJS.Workbook; ext: string }> {
    const ext = path.extname(originalName).toLowerCase();
    const workbook = new ExcelJS.Workbook();

    if (ext === '.csv') {
      const content = fs.readFileSync(filePath, 'utf8');
      const firstLine = content.split('\n')[0] || '';
      const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
      await workbook.csv.readFile(filePath, { parserOptions: { delimiter } });
    } else if (ext === '.xlsx' || ext === '.xls') {
      await workbook.xlsx.readFile(filePath);
    } else {
      throw new Error(`Formato não suportado: ${ext}. Use .xlsx, .xls ou .csv`);
    }

    return { workbook, ext };
  }

  // ----------------------------------------------------------
  // 2. DETECTAR TIPO DE ABA
  // ----------------------------------------------------------
  static detectSheetType(rows: Record<string, string>[]): SheetType {
    const allKeys = new Set<string>();
    rows.forEach(r => Object.keys(r).forEach(k => {
      allKeys.add(k.toLowerCase().trim());
    }));

    // Use EXACT match for detection (not .includes) to avoid false positives
    const keyMatch = (synonyms: string[]) =>
      Array.from(allKeys).some(k => synonyms.some(s => k === s));

    const keys = Array.from(allKeys);

    // Detectores específicos (exact match)
    const hasCusto = keyMatch(COLUMN_SYNONYMS.custo);
    const hasVenda = keyMatch(COLUMN_SYNONYMS.venda);
    const hasEstoque = keyMatch(COLUMN_SYNONYMS.estoque);
    const hasQuantidade = keyMatch(COLUMN_SYNONYMS.quantidade);
    const hasData = keyMatch(COLUMN_SYNONYMS.data);
    const hasVencimento = keyMatch(COLUMN_SYNONYMS.vencimento);
    const hasVendedor = keyMatch(COLUMN_SYNONYMS.vendedor);
    const hasTelefone = keyMatch(COLUMN_SYNONYMS.telefone);

    // Nome de produto vs cliente: partial match para capturar variações
    const hasProdutoNome = keys.some(k => COLUMN_SYNONYMS.produtoNome.some(s => k.includes(s) || s.includes(k)));
    const hasClienteNome = keys.some(k => COLUMN_SYNONYMS.nomeCliente.some(s => k.includes(s) || s.includes(k)));

    // Produto genérico (só "nome" + custo/venda)
    const hasNomeGenerico = keys.some(k => k === 'nome' || k === 'descrição' || k === 'descricao');
    const hasCategoria = keys.some(k => COLUMN_SYNONYMS.categoria.some(s => k === s));

    // Lógica de detecção por prioridade
    // 1. Produtos: tem custo + venda + estoque + (nome do produto OU nome genérico)
    if (hasCusto && hasVenda && (hasEstoque || hasCategoria)) {
      if (hasProdutoNome || hasNomeGenerico) return 'PRODUTOS';
    }

    // 2. Vendas: produto + quantidade + data
    if ((hasProdutoNome || hasNomeGenerico) && hasQuantidade && hasData) return 'VENDAS';

    // 3. Fiado: cliente + vencimento
    if (hasClienteNome && hasVencimento) return 'FIADO';

    // 4. Clientes: nome + (telefone ou cpf) e não tem custo/venda
    if ((hasClienteNome || hasNomeGenerico) && (hasTelefone || hasCpfKeys(keys)) && !hasCusto && !hasVenda) return 'CLIENTES';

    // 5. Fornecedores: nome + telefone sem vencimento
    if ((hasClienteNome || hasNomeGenerico) && (hasTelefone || hasCategoria) && !hasVencimento && !hasCusto && !hasVenda) return 'FORNECEDORES';

    // 6. Funcionários: vendedor
    if (hasVendedor) return 'FUNCIONARIOS';

    // 7. Estoque inicial: produto + estoque sem custo/venda
    if ((hasProdutoNome || hasNomeGenerico) && hasEstoque && !hasCusto && !hasVenda) return 'ESTOQUE_INICIAL';

    return 'DESCONHECIDA';
  }

  // ----------------------------------------------------------
  // 3. MAPEAR COLUNA PARA CAMPO
  // ----------------------------------------------------------
  static mapColumn(header: string): string | null {
    const clean = header.toLowerCase().trim().replace(/[\uFEFF"']/g, '');
    for (const [field, synonyms] of Object.entries(COLUMN_SYNONYMS)) {
      if (synonyms.some(s => clean === s || clean.includes(s))) {
        return field;
      }
    }
    return null;
  }

  // ----------------------------------------------------------
  // 4. PARSE DE VALORES
  // ----------------------------------------------------------
  static parseBRL(val: unknown): number {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return val;
    const str = String(val)
      .replace(/[R$\s]/g, '')
      .replace(/\./g, '')
      .replace(',', '.')
      .trim();
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
  }

  static parseDate(val: unknown): string | undefined {
    if (val instanceof Date) return val.toISOString().split('T')[0];
    if (!val) return undefined;
    const str = String(val).trim();
    // DD/MM/YYYY
    const brMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (brMatch) {
      return `${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`;
    }
    // YYYY-MM-DD
    const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) return str;
    return undefined;
  }

  // ----------------------------------------------------------
  // 5. PARSE COMPLETO
  // ----------------------------------------------------------
  static async parse(filePath: string, originalName: string): Promise<ParseResult> {
    const { workbook } = await this.readFile(filePath, originalName);

    const previews: SheetPreview[] = [];
    const data: ParsedData = {
      produtos: [], clientes: [], vendas: [], fiado: [], funcionarios: [], fornecedores: []
    };
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    for (const sheet of workbook.worksheets) {
      const rows = this.sheetToRows(sheet);
      if (rows.length === 0) continue;

      const sheetType = this.detectSheetType(rows);
      const columns = Object.keys(rows[0]);

      previews.push({
        name: sheet.name,
        detectedType: sheetType,
        columns,
        sampleRows: rows.slice(0, 5),
        rowCount: rows.length,
      });

      try {
        switch (sheetType) {
          case 'PRODUTOS':
            this.parseProdutos(rows, data, errors, sheet.name);
            break;
          case 'CLIENTES':
            this.parseClientes(rows, data, errors, sheet.name);
            break;
          case 'VENDAS':
            this.parseVendas(rows, data, errors, sheet.name);
            break;
          case 'FIADO':
            this.parseFiado(rows, data, errors, sheet.name);
            break;
          case 'FUNCIONARIOS':
            this.parseFuncionarios(rows, data, errors, sheet.name);
            break;
          case 'FORNECEDORES':
            this.parseFornecedores(rows, data, errors, sheet.name);
            break;
          case 'ESTOQUE_INICIAL':
            this.parseEstoqueInicial(rows, data, errors, sheet.name);
            break;
          case 'DESCONHECIDA':
            warnings.push(`Aba "${sheet.name}" não foi reconhecida automaticamente. Colunas encontradas: ${columns.join(', ')}`);
            break;
        }
      } catch (err: unknown) {
        errors.push({ sheet: sheet.name, row: 0, field: '', message: `Erro ao processar aba: ${getErrorMessage(err)}` });
      }
    }

    // Validações de integridade
    this.validateIntegrity(data, errors, warnings);

    return {
      success: errors.length === 0,
      preview: previews,
      data,
      errors,
      warnings,
    };
  }

  // ----------------------------------------------------------
  // 6. MÉTODOS DE PARSE POR TIPO
  // ----------------------------------------------------------
  private static sheetToRows(sheet: ExcelJS.Worksheet): Record<string, string>[] {
    const rows: Record<string, string>[] = [];
    let headerRow = 0;
    let headers: string[] = [];

    // Encontrar linha de cabeçalho (primeira linha com conteúdo significativo)
    for (let i = 1; i <= 5; i++) {
      const row = sheet.getRow(i);
      const vals = (row.values as any[])?.filter(v => v != null) || [];
      if (vals.length >= 2) {
        headerRow = i;
        headers = (row.values as any[]).slice(1).map((v: any) =>
          String(v || '').toLowerCase().trim().replace(/[\uFEFF"']/g, '')
        );
        break;
      }
    }

    if (headerRow === 0 || headers.length === 0) return rows;

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRow) return;
      const rowObj: Record<string, string> = {};
      let hasValue = false;
      (row.values as any[])?.slice(1).forEach((val: any, idx: number) => {
        if (idx < headers.length) {
          const strVal = val?.toString?.()?.trim() || '';
          rowObj[headers[idx]] = strVal;
          if (strVal) hasValue = true;
        }
      });
      if (hasValue) rows.push(rowObj);
    });

    return rows;
  }

  private static parseProdutos(rows: Record<string, string>[], data: ParsedData, errors: ValidationError[], sheet: string) {
    rows.forEach((row, idx) => {
      const linha = idx + 6;
      const nome = this.getField(row, 'nome');
      if (!nome) {
        errors.push({ sheet, row: linha, field: 'nome', message: 'Nome do produto é obrigatório' });
        return;
      }
      data.produtos.push({
        nome,
        codigo: this.getField(row, 'codigo'),
        categoria: this.getField(row, 'categoria'),
        custo: this.parseBRL(this.getField(row, 'custo')),
        venda: this.parseBRL(this.getField(row, 'venda')),
        estoque: this.parseBRL(this.getField(row, 'estoque')),
        unidade: this.getField(row, 'unidade'),
      });
    });
  }

  private static parseClientes(rows: Record<string, string>[], data: ParsedData, errors: ValidationError[], sheet: string) {
    rows.forEach((row, idx) => {
      const linha = idx + 6;
      const nome = this.getField(row, 'nomeCliente');
      if (!nome) {
        errors.push({ sheet, row: linha, field: 'nome', message: 'Nome do cliente é obrigatório' });
        return;
      }
      data.clientes.push({
        nome,
        cpf: this.getField(row, 'cpf'),
        telefone: this.getField(row, 'telefone'),
        email: this.getField(row, 'email'),
        endereco: this.getField(row, 'endereco'),
      });
    });
  }

  private static parseVendas(rows: Record<string, string>[], data: ParsedData, errors: ValidationError[], sheet: string) {
    // Agrupar por linhas que podem ter múltiplos itens na mesma venda
    const vendasMap = new Map<string, ParsedSale>();

    rows.forEach((row, idx) => {
      const linha = idx + 6;
      const clienteNome = this.getField(row, 'clienteNome') || 'Balcão';
      const dataStr = this.parseDate(this.getField(row, 'data')) || new Date().toISOString().split('T')[0];
      const produtoNome = this.getField(row, 'produtoNome');

      if (!produtoNome) {
        errors.push({ sheet, row: linha, field: 'produto', message: 'Produto não identificado na venda' });
        return;
      }

      // Chave única para agrupar itens da mesma venda (data + cliente + forma pgto)
      const formaPgto = this.normalizePaymentMethod(this.getField(row, 'formaPagamento'));
      const chave = `${dataStr}|${clienteNome}|${formaPgto}`;

      if (!vendasMap.has(chave)) {
        vendasMap.set(chave, {
          data: dataStr,
          clienteNome,
          produtos: [],
          valorTotal: 0,
          desconto: this.parseBRL(this.getField(row, 'desconto')),
          formaPagamento: formaPgto,
          parcelas: parseInt(this.getField(row, 'parcelas') || '1'),
          taxaMaquina: this.parseBRL(this.getField(row, 'taxaMaquina')),
          sinal: this.parseBRL(this.getField(row, 'sinal')),
          vendedor: this.getField(row, 'vendedor'),
          observacao: this.getField(row, 'observacao'),
        });
      }

      const sale = vendasMap.get(chave)!;
      const qtd = this.parseBRL(this.getField(row, 'quantidade')) || 1;
      const vendaUnit = this.parseBRL(this.getField(row, 'valorUnitario'));

      sale.produtos.push({
        nome: produtoNome,
        quantidade: qtd,
        valorUnitario: vendaUnit,
      });

      // Se tem valorTotal, usa ele. Senão, calcula.
      const totalRow = this.parseBRL(this.getField(row, 'valorTotal'));
      sale.valorTotal += totalRow > 0 ? totalRow : (qtd * vendaUnit);
    });

    data.vendas.push(...Array.from(vendasMap.values()));
  }

  private static parseFiado(rows: Record<string, string>[], data: ParsedData, errors: ValidationError[], sheet: string) {
    rows.forEach((row, idx) => {
      const linha = idx + 6;
      const clienteNome = this.getField(row, 'nomeCliente');
      if (!clienteNome) {
        errors.push({ sheet, row: linha, field: 'cliente', message: 'Cliente é obrigatório no fiado' });
        return;
      }
      data.fiado.push({
        clienteNome,
        valorParcela: this.parseBRL(this.getField(row, 'valorParcela')),
        vencimento: this.parseDate(this.getField(row, 'vencimento')),
        numeroParcela: parseInt(this.getField(row, 'parcelas') || '1'),
        totalParcelas: 1,
        status: this.getField(row, 'status'),
      });
    });
  }

  private static parseFuncionarios(rows: Record<string, string>[], data: ParsedData, _errors: ValidationError[], _sheet: string) {
    rows.forEach((row, _idx) => {
      const nome = this.getField(row, 'nome');
      if (!nome) return;
      data.funcionarios.push({
        nome,
        email: this.getField(row, 'email') || `${nome.toLowerCase().replace(/\s/g, '')}@email.com`,
        cargo: this.getField(row, 'cargo') || 'VENDEDOR',
      });
    });
  }

  private static parseFornecedores(rows: Record<string, string>[], data: ParsedData, _errors: ValidationError[], _sheet: string) {
    rows.forEach((row) => {
      const nome = this.getField(row, 'nome');
      if (!nome) return;
      data.fornecedores.push({
        nome,
        contato: this.getField(row, 'telefone'),
        telefone: this.getField(row, 'telefone'),
      });
    });
  }

  private static parseEstoqueInicial(rows: Record<string, string>[], data: ParsedData, _errors: ValidationError[], _sheet: string) {
    rows.forEach((row, _idx) => {
      const nome = this.getField(row, 'nome') || this.getField(row, 'nomeCliente');
      if (!nome) return;
      // Atualizar estoque de produto existente ou criar novo
      data.produtos.push({
        nome,
        codigo: this.getField(row, 'codigo'),
        custo: 0,
        venda: 0,
        estoque: this.parseBRL(this.getField(row, 'estoque')),
      });
    });
  }

  // ----------------------------------------------------------
  // 7. HELPER: GET FIELD COM SINÔNIMOS
  // ----------------------------------------------------------
  private static getField(row: Record<string, string>, field: string): string | undefined {
    const synonyms = COLUMN_SYNONYMS[field];
    if (!synonyms) return row[field];

    for (const key of Object.keys(row)) {
      const clean = key.toLowerCase().trim();
      if (synonyms.some(s => clean === s)) {
        return row[key];
      }
    }
    // Fallback: match parcial
    for (const key of Object.keys(row)) {
      const clean = key.toLowerCase().trim();
      if (synonyms.some(s => clean.includes(s) || s.includes(clean))) {
        return row[key];
      }
    }
    return undefined;
  }

  // ----------------------------------------------------------
  // 8. NORMALIZAR FORMA DE PAGAMENTO
  // ----------------------------------------------------------
  static normalizePaymentMethod(val?: string): string {
    if (!val) return 'PIX';
    const v = val.toLowerCase().trim();
    if (v.includes('pix')) return 'PIX';
    if (v.includes('dinheiro') || v.includes('cash') || v.includes('espécie')) return 'DINHEIRO';
    if (v.includes('débito') || v.includes('debito') || v.includes('débito')) return 'CARTAO_DEBITO';
    if (v.includes('crédito') || v.includes('credito') || v.includes('crédito a vista')) return 'CARTAO_CREDITO';
    if (v.includes('parcelado') || v.includes('crédito parcelado') || v.includes('credito parcelado')) return 'CARTAO_CREDITO';
    if (v.includes('fiado') || v.includes('crediário') || v.includes('crediario') || v.includes('a prazo') || v.includes('prazo')) return 'CREDIARIO';
    return 'PIX';
  }

  // ----------------------------------------------------------
  // 9. VALIDAÇÕES DE INTEGRIDADE
  // ----------------------------------------------------------
  private static validateIntegrity(data: ParsedData, _errors: ValidationError[], warnings: string[]) {
    // Verificar se há vendas sem produtos cadastrados
    const nomesProdutos = new Set(data.produtos.map(p => p.nome.toLowerCase()));

    for (const venda of data.vendas) {
      for (const item of venda.produtos) {
        if (!nomesProdutos.has(item.nome.toLowerCase())) {
          warnings.push(`Produto "${item.nome}" (venda de ${venda.clienteNome}) não encontrado no cadastro de produtos. Será criado automaticamente.`);
        }
      }
    }

    // Verificar fiado vinculado a cliente
    const nomesClientes = new Set(data.clientes.map(c => c.nome.toLowerCase()));
    for (const rec of data.fiado) {
      if (!nomesClientes.has(rec.clienteNome.toLowerCase())) {
        warnings.push(`Cliente "${rec.clienteNome}" (fiado) não encontrado no cadastro. Será criado automaticamente.`);
      }
    }

    // Verificar margens absurdas
    for (const prod of data.produtos) {
      if (prod.custo > 0 && prod.venda > 0) {
        const margem = ((prod.venda - prod.custo) / prod.custo) * 100;
        if (margem < 0) {
          warnings.push(`Produto "${prod.nome}" está com preço de venda (R$ ${prod.venda}) MENOR que o custo (R$ ${prod.custo}). Margem negativa de ${margem.toFixed(1)}%`);
        }
        if (margem > 1000) {
          warnings.push(`Produto "${prod.nome}" tem margem de ${margem.toFixed(0)}%. Verificar se custo está correto.`);
        }
      }
    }

    // Verificar estoque negativo
    for (const prod of data.produtos) {
      if (prod.estoque < 0) {
        warnings.push(`Produto "${prod.nome}" está com estoque negativo (${prod.estoque}).`);
      }
    }

    // Verificar CPF inválido
    for (const cli of data.clientes) {
      if (cli.cpf && cli.cpf.replace(/\D/g, '').length !== 11) {
        warnings.push(`CPF de "${cli.nome}" parece inválido: ${cli.cpf}`);
      }
    }
  }

  // ----------------------------------------------------------
  // 10. SALVAR NO BANCO (COM CHECKPOINT)
  // ----------------------------------------------------------
  static async saveToDatabase(storeId: string, data: ParsedData, userId: string): Promise<{ imported: Record<string, number>; warnings: string[] }> {
    const imported = { clientes: 0, produtos: 0, vendas: 0, fiado: 0, funcionarios: 0, fornecedores: 0 };
    const warnings: string[] = [];

    await prisma.$transaction(async (tx) => {
      // Garantir que existe uma categoria padrão
      let defaultCategory = await tx.category.findFirst({ where: { storeId, nome: 'Geral' } });
      if (!defaultCategory) {
        defaultCategory = await tx.category.create({
          data: { storeId, nome: 'Geral', corHexadecimal: '#cccccc' }
        });
      }

      // Garantir que existe uma carteira
      let wallet = await tx.wallet.findFirst({ where: { storeId } });
      if (!wallet) {
        wallet = await tx.wallet.create({
          data: { storeId, nome: 'Caixa Principal', tipo: 'EMPRESA', saldoAtual: 0 }
        });
      }

      // Garantir que existe um usuário para vincular vendas
      let userAccess = await tx.storeUserAccess.findFirst({ where: { storeId } });
      if (!userAccess) {
        const storeUser = await tx.user.findFirst();
        if (!storeUser) throw new Error('Nenhum usuário encontrado para vincular vendas');
        userAccess = await tx.storeUserAccess.create({
          data: { storeId, userId: storeUser.id, role: 'GERENTE' }
        });
      }

      // Mapas para evitar duplicatas
      const customerMap = new Map<string, string>();
      const productMap = new Map<string, string>();

      // 1. Importar clientes
      for (const c of data.clientes) {
        const key = c.nome.toLowerCase();
        if (customerMap.has(key)) continue;

        const existing = await tx.customer.findFirst({
          where: { storeId, nomeCompleto: { equals: c.nome, mode: 'insensitive' } }
        });

        if (existing) {
          customerMap.set(key, existing.id);
        } else {
          const created = await tx.customer.create({
            data: {
              storeId,
              nomeCompleto: c.nome,
              cpf: c.cpf || null,
              telefoneWhatsapp: c.telefone || null,
              email: c.email || null,
              enderecoCompleto: c.endereco || null,
            }
          });
          customerMap.set(key, created.id);
        }
        imported.clientes++;
      }

      // 2. Importar produtos
      for (const p of data.produtos) {
        const key = p.nome.toLowerCase();
        if (productMap.has(key)) continue;

        const existing = await tx.product.findFirst({
          where: { storeId, nome: { equals: p.nome, mode: 'insensitive' } }
        });

        if (existing) {
          // Atualizar preços e estoque
          await tx.product.update({
            where: { id: existing.id },
            data: {
              precoCusto: p.custo || existing.precoCusto,
              precoVendaSugerido: p.venda || existing.precoVendaSugerido,
              qtdEstoqueAtual: { increment: p.estoque },
            }
          });
          productMap.set(key, existing.id);
        } else {
          const created = await tx.product.create({
            data: {
              storeId,
              categoryId: defaultCategory.id,
              nome: p.nome,
              codigoBarrasEan: p.codigo || null,
              codigoVisual: p.codigo || null,
              precoCusto: p.custo,
              precoVendaSugerido: p.venda,
              qtdEstoqueAtual: p.estoque,
              status: p.estoque > 0 ? 'ATIVO' : 'SEM_ESTOQUE',
            }
          });
          productMap.set(key, created.id);
        }
        imported.produtos++;
      }

      // 3. Importar vendas
      for (const v of data.vendas) {
        const customerId = v.clienteNome
          ? customerMap.get(v.clienteNome.toLowerCase())
          : undefined;

        const dataVenda = v.data ? (parseLocalDate(v.data) || new Date()) : new Date();
        let cmvTotal = 0;
        const saleItemsData: any[] = [];

        for (const item of v.produtos) {
          const productKey = item.nome.toLowerCase();
          let productId = productMap.get(productKey);

          // Criar produto se não existir
          if (!productId) {
            const created = await tx.product.create({
              data: {
                storeId,
                categoryId: defaultCategory.id,
                nome: item.nome,
                codigoBarrasEan: Math.random().toString(36).substring(2, 8).toUpperCase(),
                precoCusto: 0,
                precoVendaSugerido: item.valorUnitario,
                qtdEstoqueAtual: 0,
                status: 'ATIVO',
              }
            });
            productId = created.id;
            productMap.set(productKey, productId);
            warnings.push(`Produto "${item.nome}" criado automaticamente durante importação de vendas.`);
          }

          const product = await tx.product.findUnique({ where: { id: productId } });
          const custoUnit = Number(product?.precoCusto || 0);
          cmvTotal += custoUnit * item.quantidade;

          saleItemsData.push({
            productId,
            quantidade: item.quantidade,
            precoUnitarioVendido: item.valorUnitario,
            custoUnitarioHistorico: custoUnit,
            comissaoVendedorValor: 0,
          });

          // Baixar estoque
          await tx.product.update({
            where: { id: productId },
            data: { qtdEstoqueAtual: { decrement: item.quantidade } }
          });
        }

        const sale = await tx.sale.create({
          data: {
            storeId,
            userId: userAccess.userId,
            customerId: customerId || null,
            dataVenda,
            valorTotalBruto: v.valorTotal,
            valorDesconto: v.desconto,
            valorTaxasGateway: v.taxaMaquina,
            valorTotalLiquido: v.valorTotal - v.desconto - v.taxaMaquina,
            cmvTotal,
            formaPagamento: v.formaPagamento,
            valorSinal: v.sinal,
            numeroParcelas: v.parcelas,
            status: v.formaPagamento === 'CREDIARIO' ? 'PENDENTE' : 'FINALIZADA',
            finalizedAt: v.formaPagamento === 'CREDIARIO' ? null : new Date(),
            observacoes: v.observacao || 'Importado via planilha',
            saleItems: { create: saleItemsData },
          }
        });

        // Sincronizar financeiro
        const valorRecebido = v.formaPagamento === 'CREDIARIO' ? v.sinal : (v.valorTotal - v.desconto - v.taxaMaquina);
        if (valorRecebido > 0) {
          await tx.financialTransaction.create({
            data: {
              storeId,
              walletId: wallet!.id,
              saleId: sale.id,
              tipo: 'ENTRADA',
              valor: valorRecebido,
              descricao: `Venda #${sale.id.substring(0, 8)} - ${v.clienteNome || 'Balcão'}`,
              categoria: 'VENDAS',
              dataTransacao: dataVenda,
            }
          });

          await tx.wallet.update({
            where: { id: wallet!.id },
            data: { saldoAtual: { increment: valorRecebido } }
          });
        }

        // Crediário: gerar parcelas
        if (v.formaPagamento === 'CREDIARIO' && customerId) {
          const valorRestante = v.valorTotal - v.desconto - v.taxaMaquina - v.sinal;
          if (valorRestante > 0) {
            const valorPorParcela = valorRestante / v.parcelas;
            for (let i = 1; i <= v.parcelas; i++) {
              const dtVencimento = new Date(dataVenda);
              dtVencimento.setDate(dtVencimento.getDate() + (i * 30));

              await tx.accountReceivable.create({
                data: {
                  storeId,
                  saleId: sale.id,
                  customerId,
                  dataVencimento: dtVencimento,
                  numeroParcela: i,
                  totalParcelas: v.parcelas,
                  valorParcela: valorPorParcela,
                  formaPagamentoEsperada: 'DINHEIRO',
                  status: 'PENDENTE',
                }
              });
            }
          }
        }

        imported.vendas++;
      }

      // 4. Importar fiado (crediário avulso)
      for (const rec of data.fiado) {
        const customerId = customerMap.get(rec.clienteNome.toLowerCase());
        const dtVencimento = rec.vencimento ? (parseLocalDate(rec.vencimento) || new Date()) : new Date();

        await tx.accountReceivable.create({
          data: {
            storeId,
            customerId: customerId || '',
            dataVencimento: dtVencimento,
            numeroParcela: rec.numeroParcela,
            totalParcelas: rec.totalParcelas,
            valorParcela: rec.valorParcela,
            formaPagamentoEsperada: 'DINHEIRO',
            status: rec.status === 'PAGO' ? 'PAGO' : 'PENDENTE',
          }
        });
        imported.fiado++;
      }

      // 5. Importar funcionários
      for (const f of data.funcionarios) {
        const existingUser = await tx.user.findFirst({
          where: { email: f.email }
        });

        if (existingUser) {
          // Verificar se já tem acesso à loja
          const existingAccess = await tx.storeUserAccess.findUnique({
            where: { storeId_userId: { storeId, userId: existingUser.id } }
          });
          if (!existingAccess) {
            await tx.storeUserAccess.create({
              data: {
                storeId,
                userId: existingUser.id,
                role: f.cargo.toUpperCase() === 'GERENTE' ? 'GERENTE' :
                      f.cargo.toUpperCase() === 'CAIXA' ? 'CAIXA' : 'VENDEDOR',
              }
            });
          }
        }
        imported.funcionarios++;
      }

      // Registrar auditoria
      await tx.auditLog.create({
        data: {
          storeId,
          userId,
          acao: 'IMPORTAR_PLANILHA',
          tabelaAfetada: 'MULTIPLA',
          dadosNovos: {
            imported,
            produtos: data.produtos.length,
            clientes: data.clientes.length,
            vendas: data.vendas.length,
          }
        }
      });
    });

    return { imported, warnings };
  }

  // ----------------------------------------------------------
  // 11. PREVIEW (SEM SALVAR)
  // ----------------------------------------------------------
  static async preview(filePath: string, originalName: string): Promise<ParseResult> {
    return this.parse(filePath, originalName);
  }
}

function hasCpfKeys(keys: string[]): boolean {
  const cpfs = ['cpf', 'documento', 'cpf/cnpj', 'doc', 'documento'];
  return keys.some(k => cpfs.includes(k));
}
