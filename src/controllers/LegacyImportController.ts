import { getErrorMessage } from '../lib/errors';
import { Request, Response } from 'express';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import ExcelJS from 'exceljs';
import { asyncHandler } from "../lib/asyncHandler";
import fs from 'fs';
import { normalizarCategoria } from '../lib/categorias';

export class LegacyImportController {
  static importLegacy = asyncHandler(async (req: Request, res: Response) => {

    try {
      const storeId = req.user?.storeId as string;
      const userId = req.user?.id as string;

      if (!storeId || !userId) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(401).json({ error: 'Usuário não autenticado ou sem loja vinculada.' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
      }

      const storeExists = await prisma.store.findUnique({ where: { id: storeId } });
      if (!storeExists) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(401).json({ error: 'A loja vinculada não existe mais.' });
      }

      const workbook = new ExcelJS.Workbook();
      const isCsv = req.file.originalname?.toLowerCase().endsWith('.csv') || req.file.mimetype?.includes('csv');
      
      if (isCsv) {
        const content = fs.readFileSync(req.file.path, 'utf8');
        const firstLine = content.split('\n')[0] || '';
        const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
        await workbook.csv.readFile(req.file.path, { parserOptions: { delimiter } });
      } else {
        await workbook.xlsx.readFile(req.file.path);
      }

      const customerMap = new Map<string, string>();
      const productMap = new Map<string, string>();

      let defaultCategory = await prisma.category.findFirst({
        where: { storeId, nome: 'Geral' }
      });
      if (!defaultCategory) {
        defaultCategory = await prisma.category.create({
          data: {
            storeId,
            nome: 'Geral',
            corHexadecimal: '#808080'
          }
        });
      }

      const stats = {
        customers: { processed: 0, errors: 0 },
        products: { processed: 0, errors: 0 },
        sales: { processed: 0, errors: 0 },
        financial: { processed: 0, errors: 0 }
      };

      stats.customers = await LegacyImportController.processClientes(storeId, workbook, customerMap);
      stats.products = await LegacyImportController.processProdutos(storeId, workbook, productMap, defaultCategory.id);
      stats.sales = await LegacyImportController.processVendas(storeId, userId, workbook, customerMap, productMap);
      stats.financial = await LegacyImportController.processFinanceiro(storeId, workbook);

      fs.appendFileSync('imports.log', `[IMPORT END] Result: ${JSON.stringify(stats)}\n`);

      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

      return res.json({ 
        message: 'Importação do legado concluída com sucesso.',
        results: stats
      });

    } catch (err: unknown) {
      logger.error('Erro na importação do legado:', err);
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(500).json({ error: '' });
    }
  }, "importar legacy");

  // --- HELPER METHODS ---
  static getHeadersAndStartRow(sheet: ExcelJS.Worksheet, keywords: string[]): { headers: string[], dataStartRow: number } {
    let bestRow = 1;
    let maxMatch = 0;
    
    // Procura nas primeiras 10 linhas qual parece ser o verdadeiro cabeçalho
    for (let r = 1; r <= Math.min(sheet.rowCount, 10); r++) {
      const row = sheet.getRow(r);
      if (!row.values) continue;
      
      const vals = (row.values as any[]).map(v => v?.toString().toLowerCase().trim() || '');
      const uniqueVals = new Set(vals);
      // Conta quantas palavras-chave aparecem de forma única nesta linha
      const matchCount = Array.from(uniqueVals).filter(v => v && keywords.some(k => v.includes(k))).length;
      
      // Escolhe a linha com mais matches ÚNICOS de palavras-chave
      if (matchCount > maxMatch || (matchCount > 0 && matchCount === maxMatch && uniqueVals.size > new Set(sheet.getRow(bestRow).values as any[]).size)) {
        maxMatch = matchCount;
        bestRow = r;
      }
    }

    const headers: string[] = [];
    sheet.getRow(bestRow).eachCell((cell, colNumber) => {
      headers[colNumber] = cell.value?.toString().toLowerCase().replace(/[\uFEFF"']/g, '').trim() || `col${colNumber}`;
    });
    
    return { headers, dataStartRow: bestRow + 1 };
  }

  static rowToObject(row: ExcelJS.Row, headers: string[]): any {
    const rowObj: any = {};
    row.eachCell((cell, colNumber) => {
      let val = cell.value;
      if (val && typeof val === 'object' && (val as any).result !== undefined) val = (val as any).result;
      if (val && typeof val === 'object' && (val as any).text !== undefined) val = (val as any).text;
      if (val !== undefined && val !== null) {
        rowObj[headers[colNumber]] = val;
      }
    });
    return rowObj;
  }

  static findSheet(workbook: ExcelJS.Workbook, nameKeywords: string[], headerKeywords: string[]) {
    // 1. Tenta achar pelo nome da aba primeiro, respeitando a ordem de prioridade das palavras-chave
    for (const kw of nameKeywords) {
      const match = workbook.worksheets.find(s => s.name.toLowerCase().includes(kw));
      if (match) return match;
    }

    // 2. Se não achar, procura nas colunas, mas exige pelo menos 2 palavras-chave únicas
    return workbook.worksheets.find(s => {
      for (let r = 1; r <= Math.min(s.rowCount, 10); r++) {
        const row = s.getRow(r);
        if (!row.values) continue;
        const vals = (row.values as any[]).map(v => v?.toString().toLowerCase().trim() || '');
        const matchCount = headerKeywords.filter(k => vals.some(v => v && v.includes(k))).length;
        if (matchCount >= 2) {
          return true;
        }
      }
      return false;
    });
  }

  // --- PROCESS METHODS ---
  static async processClientes(storeId: string, workbook: ExcelJS.Workbook, customerMap: Map<string, string>) {
    let stats = { processed: 0, errors: 0 };
    const allKeywords = ['cliente', 'telefone', 'celular', 'endereço', 'endereco', 'código', 'codigo', 'nome'];
    let sheet = this.findSheet(workbook, ['cliente'], ['cliente', 'telefone', 'endereço', 'endereco', 'celular']);
    if (!sheet) {
      fs.appendFileSync('imports.log', `[MISSING] Clientes sheet not found\n`);
      return stats;
    }
    fs.appendFileSync('imports.log', `[FOUND] Clientes sheet: ${sheet.name}\n`);

    const { headers, dataStartRow } = this.getHeadersAndStartRow(sheet, allKeywords);

    for (let i = dataStartRow; i <= sheet.rowCount; i++) {
      try {
        const row = sheet.getRow(i);
        if (!row.values || !(row.values as any[]).length) continue;
        
        const rowObj = this.rowToObject(row, headers);
        
        const codigo = this.getVal(rowObj, ['código', 'codigo']);
        const nome = this.getVal(rowObj, ['nome', 'cliente', 'nome completo']);
        const telefoneRaw = this.getVal(rowObj, ['telefone', 'celular', 'whatsapp']) || '';
        const endereco = this.getVal(rowObj, ['endereço', 'endereco']);

        if (!nome && !codigo && !telefoneRaw) {
          // Linha vazia ou apenas com fórmulas pré-preenchidas sem dados
          continue;
        }

        if (!nome) {
          // LGPD: sem JSON.stringify(rowObj) — linha contém CPF, telefone e endereço
          fs.appendFileSync('imports.log', `[CLIENTE ERR] Row ${i} nome vazio\n`);
          stats.errors++;
          continue;
        }

        const telefoneLimpo = telefoneRaw.toString().replace(/\D/g, '');

        let customer = await prisma.customer.findFirst({
          where: { 
            storeId, 
            OR: [
              { nomeCompleto: nome.toString().trim() }, 
              ...(telefoneLimpo ? [{ telefoneWhatsapp: telefoneLimpo }] : [])
            ] 
          }
        });

        if (!customer) {
          customer = await prisma.customer.create({
            data: {
              storeId,
              nomeCompleto: nome.toString().trim(),
              telefoneWhatsapp: telefoneLimpo || null,
              enderecoCompleto: endereco ? endereco.toString() : null
            }
          });
        }

        if (codigo) customerMap.set(codigo.toString().trim(), customer.id);
        customerMap.set(nome.toString().trim().toLowerCase(), customer.id);
        stats.processed++;
      } catch (err: unknown) {
        fs.appendFileSync('imports.log', `[CLIENTE ERR] Row ${i}: ${getErrorMessage(err)}\n`);
        stats.errors++;
      }
    }
    return stats;
  }

  static getVal(rowObj: any, keys: string[]): any {
    // 1. Exact match
    for (const key of keys) {
      const foundKey = Object.keys(rowObj).find(k => k === key);
      if (foundKey && rowObj[foundKey] !== undefined && rowObj[foundKey] !== null) {
        let val = rowObj[foundKey];
        if (typeof val === 'object') {
          if (val.result !== undefined) return val.result;
          if (val.formula) return ''; 
        }
        return val;
      }
    }

    // 2. Includes match (safe)
    for (const key of keys) {
      const foundKey = Object.keys(rowObj).find(k => {
        if (!k.includes(key)) return false;
        // Prevent false positives for "produto"
        if (key === 'produto' && (k.includes('custo') || k.includes('venda') || k.includes('preço') || k.includes('cód') || k.includes('cadastro'))) return false;
        if (key === 'nome' && (k.includes('cliente') || k.includes('produto') || k.includes('fantasia'))) return false;
        if (key === 'cliente' && k.includes('cód')) return false;
        return true;
      });
      if (foundKey && rowObj[foundKey] !== undefined && rowObj[foundKey] !== null) {
        let val = rowObj[foundKey];
        if (typeof val === 'object') {
          if (val.result !== undefined) return val.result;
          if (val.formula) return ''; 
        }
        return val;
      }
    }
    return undefined;
  }

  static parseNumber(val: any): number {
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (!val) return 0;
    const str = val.toString().replace('R$', '').trim();
    let num = 0;
    if (str.includes(',') && str.includes('.')) {
      num = parseFloat(str.replace(/\./g, '').replace(',', '.'));
    } else if (str.includes(',')) {
      num = parseFloat(str.replace(',', '.'));
    } else {
      num = parseFloat(str);
    }
    return isNaN(num) ? 0 : num;
  }

  static async processProdutos(storeId: string, workbook: ExcelJS.Workbook, productMap: Map<string, string>, categoryId: string) {
    let stats = { processed: 0, errors: 0 };
    const allKeywords = ['produto', 'marca', 'estoque', 'custo', 'venda', 'lucro', 'qtd', 'código', 'codigo', 'nome'];
    
    // Filtra abas que tenham "vendido" ou "venda" no nome para não confundir com o histórico de vendas
    const sheetMatches = workbook.worksheets.filter(s => {
       const name = s.name.toLowerCase();
       return (name.includes('produto') && !name.includes('vendid') && !name.includes('venda')) || name.includes('estoque');
    });
    let sheet = sheetMatches[0] || this.findSheet(workbook, ['cadastro de produto', 'estoque'], ['produto', 'marca', 'estoque', 'custo', 'venda', 'lucro']);
    if (!sheet) {
      fs.appendFileSync('imports.log', `[MISSING] Produtos sheet not found\n`);
      return stats;
    }
    fs.appendFileSync('imports.log', `[FOUND] Produtos sheet: ${sheet.name}\n`);

    const { headers, dataStartRow } = this.getHeadersAndStartRow(sheet, allKeywords);
    fs.appendFileSync('imports.log', `[DEBUG PRODUTOS] Headers detected on row ${dataStartRow - 1}: ${JSON.stringify(headers)}\n`);
    // LGPD: a primeira linha não é mais logada — podia conter dados de clientes

    for (let i = dataStartRow; i <= sheet.rowCount; i++) {
      try {
        const row = sheet.getRow(i);
        if (!row.values || !(row.values as any[]).length) continue;
        
        const rowObj = this.rowToObject(row, headers);
        
        const codigo = this.getVal(rowObj, ['código', 'codigo']);
        const produto = this.getVal(rowObj, ['produto', 'nome', 'descrição', 'descricao']);
        const marca = this.getVal(rowObj, ['marca', 'categoria']);
        const qtdEstoque = parseFloat(this.getVal(rowObj, ['qtd em estoque', 'estoque', 'qtd']) || '0');
        
        let custoStr = this.getVal(rowObj, ['custo de compra (r$)', 'custo de compra', 'custo', 'valor de custo']);
        let vendaStr = this.getVal(rowObj, ['venda sugerida (r$)', 'venda sugerida', 'venda', 'valor de venda', 'preço']);

        const custoNum = this.parseNumber(custoStr);
        const vendaNum = this.parseNumber(vendaStr);

        if (!produto && !codigo && !marca && custoStr === '0' && vendaStr === '0') {
          continue; // Linha vazia ou com fórmulas vazias
        }

        if (!produto) {
          fs.appendFileSync('imports.log', `[PRODUTO ERR] Row ${i} produto vazio. obj=${JSON.stringify(rowObj)}\n`);
          stats.errors++;
          continue;
        }

        const nomeDoProduto = produto.toString().trim();
        const nomeUpper = nomeDoProduto.toUpperCase();

        // Resolvendo Categoria de forma Inteligente
        let guessedCategoryName = 'Geral';
        if (nomeUpper.includes('BODY SPLASH')) guessedCategoryName = 'Body splash';
        else if (nomeUpper.includes('KIT')) guessedCategoryName = 'Kit de hidratação com body splash';
        else if (nomeUpper.includes('HIDRATANTE') || nomeUpper.includes('LOÇÃO') || nomeUpper.includes('CREME') || nomeUpper.includes('BARE VANILLA')) guessedCategoryName = 'Hidratante';
        else if (nomeUpper.includes('DECANT') || nomeUpper.includes('AMOSTRA')) guessedCategoryName = 'Decants';
        else if (nomeUpper.includes('FOR MEN') || nomeUpper.includes('MASCULINO') || nomeUpper.includes('EXTREME STORY') || nomeUpper.includes('ASAD') || nomeUpper.includes('BILLION PARIS')) guessedCategoryName = 'Perfume Masculino';
        else guessedCategoryName = 'Perfume Feminino';

        let finalCategoryId = categoryId;
        let cat = await prisma.category.findFirst({ where: { storeId, nome: guessedCategoryName } });
        if (!cat) {
           cat = await prisma.category.create({ data: { storeId, nome: guessedCategoryName, corHexadecimal: '#eec2ff' } });
        }
        finalCategoryId = cat.id;

        // Collect all extra columns
        const knownKeys = ['código', 'codigo', 'produto', 'nome', 'descrição', 'descricao', 'marca', 'categoria', 'qtd em estoque', 'estoque', 'qtd', 'custo de compra (r$)', 'custo de compra', 'custo', 'valor de custo', 'venda sugerida (r$)', 'venda sugerida', 'venda', 'valor de venda', 'preço'];
        const extraInfo: string[] = [];
        Object.keys(rowObj).forEach(k => {
          if (!knownKeys.includes(k.toLowerCase().trim()) && rowObj[k] !== null && rowObj[k] !== undefined && rowObj[k] !== '') {
             extraInfo.push(`${k}: ${rowObj[k]}`);
          }
        });
        const descricaoExtra = extraInfo.length > 0 ? extraInfo.join(' | ') : null;

        let p = await prisma.product.findFirst({
          where: { storeId, nome: nomeDoProduto }
        });

        if (!p) {
          p = await prisma.product.create({
            data: {
              storeId,
              categoryId: finalCategoryId,
              codigoBarrasEan: 'PRD' + Math.floor(100000 + Math.random() * 900000).toString(),
              nome: nomeDoProduto,
              descricaoVariante: descricaoExtra,
              precoCusto: isNaN(custoNum) ? 0 : custoNum,
              precoVendaSugerido: isNaN(vendaNum) ? 0 : vendaNum,
              qtdEstoqueAtual: isNaN(qtdEstoque) ? 0 : qtdEstoque
            }
          });
        } else {
          p = await prisma.product.update({
            where: { id: p.id },
            data: { qtdEstoqueAtual: isNaN(qtdEstoque) ? p.qtdEstoqueAtual : qtdEstoque }
          });
        }

        if (codigo) productMap.set(codigo.toString().trim(), p.id);
        productMap.set(produto.toString().trim().toLowerCase(), p.id);
        stats.processed++;
      } catch (err: unknown) {
        fs.appendFileSync('imports.log', `[PRODUTO ERR] Row ${i}: ${getErrorMessage(err)}\n`);
        stats.errors++;
      }
    }
    return stats;
  }

  static async processVendas(storeId: string, userId: string, workbook: ExcelJS.Workbook, customerMap: Map<string, string>, productMap: Map<string, string>) {
    let stats = { processed: 0, errors: 0 };
    const allKeywords = ['pedido', 'vendido', 'sinal recebido', 'valor total', 'status', 'forma pgto', 'data', 'cliente', 'produto', 'qtd', 'quantidade'];
    let sheet = this.findSheet(workbook, ['produtos vendidos', 'produtos_vendidos', 'venda', 'vendido', 'pedido'], ['pedido', 'sinal', 'status', 'forma pgto']);
    if (!sheet) {
      fs.appendFileSync('imports.log', `[MISSING] Vendas sheet not found\n`);
      return stats;
    }
    fs.appendFileSync('imports.log', `[FOUND] Vendas sheet: ${sheet.name}\n`);

    const { headers, dataStartRow } = this.getHeadersAndStartRow(sheet, allKeywords);
    const pedidos = new Map<string, any[]>();
    
    let defaultWallet = await prisma.wallet.findFirst({ where: { storeId } });
    if (!defaultWallet) {
      defaultWallet = await prisma.wallet.create({
        data: { storeId, nome: 'Carteira Principal', tipo: 'CAIXA_FISICO', saldoAtual: 0 }
      });
    }

    for (let i = dataStartRow; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i);
      if (!row.values || !(row.values as any[]).length) continue;
      
      const rowObj = this.rowToObject(row, headers);
      let numeroPedido = this.getVal(rowObj, ['nº pedido', 'pedido', 'numero', 'nº venda', 'venda']);
      
      const codProduto = this.getVal(rowObj, ['cód. produto', 'produto', 'nome do produto']);
      const codCliente = this.getVal(rowObj, ['cód. cliente', 'cliente', 'nome do cliente']);

      if (!numeroPedido && !codProduto && !codCliente) {
        continue; // Linha com fórmulas vazias
      }

      if (!numeroPedido) {
        numeroPedido = `linha_${i}`;
      }
      
      if (!pedidos.has(numeroPedido.toString())) {
        pedidos.set(numeroPedido.toString(), []);
      }
      pedidos.get(numeroPedido.toString())!.push(rowObj);
    }

    for (const [numero, itens] of pedidos.entries()) {
      try {
        if (itens.length === 0) continue;

        const firstItem = itens[0];
        const dataVendaRaw = this.getVal(firstItem, ['data', 'data venda']);
        let dataVenda = new Date();
        if (dataVendaRaw) {
          if (typeof dataVendaRaw === 'string' && dataVendaRaw.includes('/')) {
            const parts = dataVendaRaw.split('/');
            if (parts.length >= 3) {
              const day = parseInt(parts[0], 10);
              const month = parseInt(parts[1], 10) - 1;
              let yearStr = parts[2].split(' ')[0];
              const year = yearStr.length === 2 ? 2000 + parseInt(yearStr, 10) : parseInt(yearStr, 10);
              dataVenda = new Date(year, month, day);
            }
          } else {
            const parsed = new Date(dataVendaRaw);
            if (!isNaN(parsed.getTime())) {
              dataVenda = parsed;
            }
          }
        }

        const codCliente = this.getVal(firstItem, ['cód. cliente', 'cliente', 'nome do cliente']);
        const customerId = customerMap.get(codCliente?.toString().trim().toLowerCase()) || customerMap.get(codCliente?.toString().trim());

        let valorTotalStr = this.getVal(firstItem, ['valor', 'valor total', 'total', 'total da venda', 'total pago']);
        let sinalRecebidoStr = this.getVal(firstItem, ['sinal recebido', 'sinal']);

        const valorTotal = this.parseNumber(valorTotalStr);
        let sinalRecebido = this.parseNumber(sinalRecebidoStr);
        const status = this.getVal(firstItem, ['status'])?.toString().toUpperCase() || 'FINALIZADA';
        const formaPgtoRaw = this.getVal(firstItem, ['forma pgto', 'forma de pagamento', 'pagamento'])?.toString().toUpperCase() || 'PIX';
        
        // Formata forma de pagamento
        let formaPgto = 'OUTROS';
        if (formaPgtoRaw.includes('PIX')) formaPgto = 'PIX';
        else if (formaPgtoRaw.includes('CREDITO') || formaPgtoRaw.includes('CRÉDITO')) formaPgto = 'CARTAO_CREDITO';
        else if (formaPgtoRaw.includes('DEBITO') || formaPgtoRaw.includes('DÉBITO')) formaPgto = 'CARTAO_DEBITO';
        else if (formaPgtoRaw.includes('DINHEIRO')) formaPgto = 'DINHEIRO';
        else if (formaPgtoRaw.includes('CREDI') || formaPgtoRaw.includes('FIADO')) formaPgto = 'CREDIARIO';
        else formaPgto = formaPgtoRaw.substring(0, 50); // Fallback para manter a original

        // Se a forma de pagamento não for fiado/crediário, e o sinal estiver zerado, assume-se pago integralmente
        if (sinalRecebido === 0 && !formaPgto.includes('CREDIARIO') && !formaPgtoRaw.includes('CREDI')) {
          sinalRecebido = valorTotal;
        }

        const knownKeys = ['data', 'data venda', 'cód. cliente', 'cliente', 'nome do cliente', 'valor', 'valor total', 'total', 'total da venda', 'total pago', 'sinal recebido', 'sinal', 'status', 'forma pgto', 'nº pedido', 'pedido', 'numero', 'cód. produto', 'produto', 'nome do produto', 'qtd', 'quantidade', 'custo unit', 'custo', 'custo de compra', 'venda unit', 'venda', 'preço unitário', 'preco unitario'];
        const extraInfo: string[] = [];
        Object.keys(firstItem).forEach(k => {
          if (!knownKeys.includes(k.toLowerCase().trim()) && firstItem[k] !== null && firstItem[k] !== undefined && firstItem[k] !== '') {
             extraInfo.push(`${k}: ${firstItem[k]}`);
          }
        });
        const observacoesExtra = extraInfo.length > 0 ? extraInfo.join(' | ') : null;

        const sale = await prisma.sale.create({
          data: {
            storeId,
            userId,
            customerId: customerId || null,
            dataVenda: dataVenda,
            valorTotalBruto: valorTotal,
            valorDesconto: 0,
            valorTotalLiquido: valorTotal,
            valorSinal: sinalRecebido,
            formaPagamento: formaPgto,
            status: status,
            finalizedAt: status === 'FINALIZADA' ? new Date() : null,
            observacoes: observacoesExtra
          }
        });

        // Tenta pegar categoria geral
        let defaultCategory = await prisma.category.findFirst({ where: { storeId, nome: 'Geral' } });

        for (const item of itens) {
          const codProduto = this.getVal(item, ['cód. produto', 'produto', 'nome do produto']);
          let productId = productMap.get(codProduto?.toString().trim().toLowerCase()) || productMap.get(codProduto?.toString().trim());
          const qtd = parseFloat(this.getVal(item, ['qtd', 'quantidade']) || '1') || 1;
          
          let custoUnitStr = this.getVal(item, ['custo unit', 'custo', 'custo de compra']);
          let vendaUnitStr = this.getVal(item, ['venda unit', 'venda', 'preço unitário', 'preco unitario']);

          const custoUnit = this.parseNumber(custoUnitStr);
          let vendaUnit = this.parseNumber(vendaUnitStr) || (valorTotal / itens.length); // fallback

          if (!productId && codProduto) {
            // Criar o produto se não existir
            try {
              if (!defaultCategory) {
                 defaultCategory = await prisma.category.create({ data: { storeId, nome: 'Geral', corHexadecimal: '#cccccc' } });
              }
              const newProd = await prisma.product.create({
                data: {
                  storeId,
                  categoryId: defaultCategory.id,
                  codigoBarrasEan: 'PRD' + Math.floor(100000 + Math.random() * 900000).toString(),
                  nome: codProduto.toString().trim(),
                  precoCusto: custoUnit,
                  precoVendaSugerido: vendaUnit,
                  qtdEstoqueAtual: 0,
                  status: 'ATIVO'
                }
              });
              productId = newProd.id;
              productMap.set(codProduto.toString().trim().toLowerCase(), productId);
            } catch (e) {
               fs.appendFileSync('imports.log', `[VENDA ERR] Failed to create missing product ${codProduto}\n`);
            }
          }

          if (productId) {
            await prisma.saleItem.create({
              data: {
                saleId: sale.id,
                productId: productId,
                quantidade: qtd,
                precoUnitarioVendido: vendaUnit,
                custoUnitarioHistorico: custoUnit
              }
            });
          }
        }

        // Fiado / Contas a receber
        if (valorTotal > sinalRecebido) {
          if (customerId) {
            await prisma.accountReceivable.create({
              data: {
                storeId,
                saleId: sale.id,
                customerId,
                dataVencimento: new Date(new Date().setDate(new Date().getDate() + 30)),
                valorParcela: valorTotal - sinalRecebido,
                formaPagamentoEsperada: 'DINHEIRO',
                status: 'PENDENTE'
              }
            });
          }
        }

        // Se houve algum valor pago (sinal ou total), cria a transação financeira da venda
        if (sinalRecebido > 0) {
          await prisma.financialTransaction.create({
            data: {
              storeId,
              walletId: defaultWallet.id,
              tipo: 'ENTRADA',
              categoria: 'VENDAS',
              descricao: `Venda ${numero !== 'linha_' ? '#' + numero : 'Avulsa'}`,
              valor: sinalRecebido,
              dataTransacao: dataVenda
            }
          });
          // Atualiza saldo da carteira
          await prisma.wallet.update({
            where: { id: defaultWallet.id },
            data: { saldoAtual: { increment: sinalRecebido } }
          });
        }

        stats.processed++;
      } catch (err: unknown) {
        fs.appendFileSync('imports.log', `[VENDA ERR] Pedido ${numero}: ${getErrorMessage(err)}\n`);
        stats.errors++;
      }
    }
    return stats;
  }

  static async processFinanceiro(storeId: string, workbook: ExcelJS.Workbook) {
    let stats = { processed: 0, errors: 0 };
    const allKeywords = ['entrada', 'saída', 'saida', 'saldo', 'fluxo', 'financeiro', 'descrição', 'data', 'categoria'];
    let sheet = this.findSheet(workbook, ['fluxo de caixa', 'financeiro', 'caixa'], ['entrada', 'saída', 'saida', 'saldo']);
    if (!sheet) {
      fs.appendFileSync('imports.log', `[MISSING] Financeiro sheet not found\n`);
      return stats;
    }
    fs.appendFileSync('imports.log', `[FOUND] Financeiro sheet: ${sheet.name}\n`);

    const { headers, dataStartRow } = this.getHeadersAndStartRow(sheet, allKeywords);

    let defaultWallet = await prisma.wallet.findFirst({ where: { storeId } });
    if (!defaultWallet) {
      defaultWallet = await prisma.wallet.create({
        data: {
          storeId,
          nome: 'Carteira Principal',
          tipo: 'CAIXA_FISICO',
          saldoAtual: 0
        }
      });
    }

    for (let i = dataStartRow; i <= sheet.rowCount; i++) {
      try {
        const row = sheet.getRow(i);
        if (!row.values || !(row.values as any[]).length) continue;
        
        const rowObj = this.rowToObject(row, headers);
        
        const dataRaw = this.getVal(rowObj, ['data']);
        const descricao = this.getVal(rowObj, ['descrição', 'descricao', 'histórico', 'historico']) || 'Importação Legada';
        const categoria = this.getVal(rowObj, ['categoria', 'tipo']);
        
        const entradaStr = this.getVal(rowObj, ['entrada', 'entrada (r$)', 'receita', 'credito', 'crédito', 'valor recebido']);
        const saidaStr = this.getVal(rowObj, ['saída', 'saida', 'saída (r$)', 'saida (r$)', 'despesa', 'debito', 'débito', 'valor pago']);

        if (!dataRaw && descricao === 'Importação Legada' && !categoria && entradaStr === '0' && saidaStr === '0') {
          continue; // Linha vazia de fórmula
        }

        let data = new Date();
        if (dataRaw) {
          if (typeof dataRaw === 'string' && dataRaw.includes('/')) {
            const parts = dataRaw.split('/');
            if (parts.length >= 3) {
              const day = parseInt(parts[0], 10);
              const month = parseInt(parts[1], 10) - 1;
              let yearStr = parts[2].split(' ')[0];
              const year = yearStr.length === 2 ? 2000 + parseInt(yearStr, 10) : parseInt(yearStr, 10);
              data = new Date(year, month, day);
            }
          } else {
            const parsed = new Date(dataRaw);
            if (!isNaN(parsed.getTime())) {
              data = parsed;
            }
          }
        }
        const entrada = this.parseNumber(entradaStr);
        const saida = this.parseNumber(saidaStr);

        if (descricao.toString().toLowerCase().includes('saldo inicial')) {
          const saldoInicialStr = this.getVal(rowObj, ['saldo do dia', 'saldo']);
          const saldoFinal = entrada > 0 ? entrada : this.parseNumber(saldoInicialStr);

          let wallet = await prisma.wallet.findFirst({ where: { storeId } });
          if (!wallet) {
            await prisma.wallet.create({
              data: { storeId, nome: 'Caixa Principal', tipo: 'CAIXA', saldoAtual: saldoFinal }
            });
          } else {
            await prisma.wallet.update({
              where: { id: wallet.id },
              data: { saldoAtual: saldoFinal }
            });
          }
          continue;
        }

        if (entrada > 0) {
          await prisma.financialTransaction.create({
            data: {
              storeId,
              walletId: defaultWallet.id,
              tipo: 'ENTRADA',
              valor: entrada,
              descricao: descricao.toString(),
              categoria: normalizarCategoria(categoria),
              dataTransacao: isNaN(data.getTime()) ? new Date() : data
            }
          });
          stats.processed++;
        }

        if (saida > 0) {
          await prisma.financialTransaction.create({
            data: {
              storeId,
              walletId: defaultWallet.id,
              tipo: 'SAIDA',
              valor: saida,
              descricao: descricao.toString(),
              categoria: normalizarCategoria(categoria),
              dataTransacao: isNaN(data.getTime()) ? new Date() : data
            }
          });
          stats.processed++;
        }
      } catch (err: unknown) {
        fs.appendFileSync('imports.log', `[FINANCEIRO ERR] Row ${i}: ${getErrorMessage(err)}\n`);
        stats.errors++;
      }
    }
    return stats;
  }
}
