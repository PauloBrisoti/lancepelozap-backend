import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import fs from 'fs';
import ExcelJS from 'exceljs';

export class ImportController {
  
  // POST /api/import/csv/clientes
  async importCustomers(req: Request, res: Response) {
    try {
      let storeId = (req.user?.storeId as string || '').trim();
      const logStr = `[${new Date().toISOString()}] IMPORT CUSTOMERS\nreq.user: ${JSON.stringify(req.user)}\nstoreId: "${storeId}"\nx-store-id: "${req.headers['x-store-id']}"\n`;
      fs.appendFileSync('imports.log', logStr);
      
      if (!storeId || storeId === 'null' || storeId === 'undefined') {
        return res.status(403).json({ error: 'Acesso negado: loja não identificada ou inválida.' });
      }

      const storeExists = await prisma.store.findUnique({ where: { id: storeId } });
      fs.appendFileSync('imports.log', `[CUSTOMERS] storeExists result for ${storeId}: ${storeExists ? storeExists.id : 'null'}\n`);
      
      if (!storeExists) {
        return res.status(403).json({ error: 'Acesso negado: a loja vinculada não existe mais. Faça login novamente ou selecione uma loja válida.' });
      }

      if (!req.file) return res.status(400).json({ error: 'Arquivo não fornecido' });
      
      if (req.file.originalname.toLowerCase().endsWith('.pdf') || req.file.mimetype.includes('pdf')) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Processamento automático de PDF ainda não suportado. Utilize Excel ou CSV.' });
      }

      let successCount = 0;
      let errorCount = 0;

      const workbook = new ExcelJS.Workbook();
      const isCsv = req.file.originalname.toLowerCase().endsWith('.csv') || req.file.mimetype.includes('csv');
      
      if (isCsv) {
        const content = fs.readFileSync(req.file.path, 'utf8');
        const firstLine = content.split('\n')[0] || '';
        const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
        await workbook.csv.readFile(req.file.path, { parserOptions: { delimiter } });
      } else {
        await workbook.xlsx.readFile(req.file.path);
      }

      let sheet = workbook.worksheets[0];
      let foundTargetSheet = false;
      let headerRowNumber = 1;

      for (const s of workbook.worksheets) {
        let hasRequiredCol = false;
        // Check first 5 rows to find the header row
        for (let i = 1; i <= 5; i++) {
          const row = s.getRow(i);
          if (!row.values || !row.values.length) continue;
          
          row.eachCell((cell: any) => {
            // Remove BOM, quotes, and trim
            const val = cell.value?.toString().toLowerCase().replace(/[\uFEFF"']/g, '').trim() || '';
            if (['nome', 'nomecompleto', 'nome completo', 'cliente'].includes(val)) {
              hasRequiredCol = true;
            }
          });
          
          if (hasRequiredCol) {
            headerRowNumber = i;
            break;
          }
        }
        
        if (hasRequiredCol) {
          sheet = s;
          foundTargetSheet = true;
          break;
        }
      }

      // Se for CSV e tem conteúdo, assume a primeira aba mesmo se o cabeçalho for esquisito
      if (isCsv && workbook.worksheets.length > 0) {
        sheet = workbook.worksheets[0];
        foundTargetSheet = true;
      }

      if (!sheet || !foundTargetSheet) {
        return res.status(400).json({ error: 'Nenhuma planilha encontrada com a coluna Nome/Cliente' });
      }
      
      const results: any[] = [];
      const headers: string[] = [];

      sheet.getRow(headerRowNumber).eachCell((cell: any, colNumber: number) => {
        headers[colNumber] = cell.value?.toString().toLowerCase().replace(/[\uFEFF"']/g, '').trim() || `col${colNumber}`;
      });

      sheet.eachRow((row: any, rowNumber: number) => {
        if (rowNumber <= headerRowNumber) return;
        const rowObj: any = {};
        row.eachCell((cell: any, colNumber: number) => {
          let val = cell.value;
          if (val && typeof val === 'object' && val.result !== undefined) val = val.result;
          if (val && typeof val === 'object' && val.text !== undefined) val = val.text;
          rowObj[headers[colNumber]] = val;
        });
        results.push(rowObj);
      });

      for (const row of results) {
        try {
          const getVal = (keys: string[]) => {
            const key = Object.keys(row).find(k => keys.includes(k.toLowerCase().trim()));
            return key ? row[key] : null;
          };

          const nomeCompleto = getVal(['nome', 'nomecompleto', 'nome completo', 'cliente']);
          if (!nomeCompleto) continue; // Nome é obrigatório
          
          const telefoneWhatsapp = getVal(['telefone', 'whatsapp', 'celular', 'telefone whatsapp']);
          const cpf = getVal(['cpf', 'documento', 'cpf/cnpj']);
          const cep = getVal(['cep', 'c.e.p']);
          const enderecoCompleto = getVal(['endereco', 'endereço', 'endereco completo', 'endereço completo']);
          
          if (!nomeCompleto) {
            fs.appendFileSync('imports.log', `[ROW SKIP CUSTOMERS] Missing nomeCompleto. Keys found: ${Object.keys(row)}\n`);
            continue; // Nome é obrigatório
          }

          await prisma.customer.create({
            data: {
              storeId,
              nomeCompleto,
              telefoneWhatsapp: telefoneWhatsapp || null,
              cpf: cpf || null,
              cep: cep || null,
              enderecoCompleto: enderecoCompleto || null
            }
          });
          successCount++;
        } catch (e) {
          errorCount++;
        }
      }
      
      fs.unlinkSync(req.file.path);

      fs.appendFileSync('imports.log', `[CUSTOMERS SUMMARY] Parsed rows: ${results.length}, Success: ${successCount}, Errors: ${errorCount}\nFirst row keys: ${results.length > 0 ? JSON.stringify(Object.keys(results[0])) : 'none'}\n`);
      
      return res.json({ 
        message: 'Importação finalizada', 
        successCount, 
        errorCount 
      });
    } catch (error: any) {
      console.error(error);
      fs.appendFileSync('imports.log', `[FATAL ERROR CUSTOMERS] ${error.message}\n${error.stack}\n`);
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: error.message || 'Formato de arquivo inválido. Tente enviar novamente como .xlsx ou .csv' });
    }
  }

  // POST /api/import/csv/produtos
  async importProducts(req: Request, res: Response) {
    try {
      let storeId = (req.user?.storeId as string || '').trim();
      const logStr = `[${new Date().toISOString()}] IMPORT PRODUCTS\nreq.user: ${JSON.stringify(req.user)}\nstoreId: "${storeId}"\nx-store-id: "${req.headers['x-store-id']}"\n`;
      fs.appendFileSync('imports.log', logStr);
      
      if (!storeId || storeId === 'null' || storeId === 'undefined') {
        return res.status(403).json({ error: 'Acesso negado: loja não identificada ou inválida.' });
      }

      console.log(`Executing prisma.store.findUnique for ID: "${storeId}" (length: ${storeId.length})`);
      // Check if store actually exists to prevent Foreign Key errors
      const storeExists = await prisma.store.findUnique({ where: { id: storeId } });
      fs.appendFileSync('imports.log', `[PRODUCTS] storeExists result for ${storeId}: ${storeExists ? storeExists.id : 'null'}\n`);
      
      if (!storeExists) {
        return res.status(403).json({ error: 'Acesso negado: a loja vinculada não existe mais. Faça login novamente ou selecione uma loja válida.' });
      }

      if (!req.file) return res.status(400).json({ error: 'Arquivo não fornecido' });

      if (req.file.originalname.toLowerCase().endsWith('.pdf') || req.file.mimetype.includes('pdf')) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Processamento automático de PDF ainda não suportado. Utilize Excel ou CSV.' });
      }

      // Opcional: Pegar uma categoria padrão (Geral)
      let defaultCategory = await prisma.category.findFirst({
        where: { storeId, nome: 'Geral' }
      });
      if (!defaultCategory) {
        defaultCategory = await prisma.category.create({
          data: { storeId, nome: 'Geral', corHexadecimal: '#cccccc' }
        });
      }

      let successCount = 0;
      let errorCount = 0;

      const workbook = new ExcelJS.Workbook();
      const isCsv = req.file.originalname.toLowerCase().endsWith('.csv') || req.file.mimetype.includes('csv');
      
      if (isCsv) {
        const content = fs.readFileSync(req.file.path, 'utf8');
        const firstLine = content.split('\n')[0] || '';
        const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
        await workbook.csv.readFile(req.file.path, { parserOptions: { delimiter } });
      } else {
        await workbook.xlsx.readFile(req.file.path);
      }

      let sheet = workbook.worksheets[0];
      let foundTargetSheet = false;
      let headerRowNumber = 1;

      for (const s of workbook.worksheets) {
        let hasRequiredCol = false;
        // Check first 5 rows to find the header row
        for (let i = 1; i <= 5; i++) {
          const row = s.getRow(i);
          if (!row.values || !row.values.length) continue;
          
          row.eachCell((cell: any) => {
            // Remove BOM, quotes, and trim
            const val = cell.value?.toString().toLowerCase().replace(/[\uFEFF"']/g, '').trim() || '';
            if (['nome', 'nome do produto', 'produto', 'descrição', 'titulo', 'sku'].includes(val)) {
              hasRequiredCol = true;
            }
          });
          
          if (hasRequiredCol) {
            headerRowNumber = i;
            break;
          }
        }
        
        if (hasRequiredCol) {
          sheet = s;
          foundTargetSheet = true;
          break;
        }
      }

      // Se for CSV e tem conteúdo, assume a primeira aba mesmo se o cabeçalho for esquisito
      if (isCsv && workbook.worksheets.length > 0) {
        sheet = workbook.worksheets[0];
        foundTargetSheet = true;
      }

      if (!sheet || !foundTargetSheet) {
        return res.status(400).json({ error: 'Nenhuma planilha encontrada com a coluna Nome/Produto' });
      }
      
      const results: any[] = [];
      const headers: string[] = [];

      sheet.getRow(headerRowNumber).eachCell((cell: any, colNumber: number) => {
        headers[colNumber] = cell.value?.toString().toLowerCase().replace(/[\uFEFF"']/g, '').trim() || `col${colNumber}`;
      });

      sheet.eachRow((row: any, rowNumber: number) => {
        if (rowNumber <= headerRowNumber) return;
        const rowObj: any = {};
        row.eachCell((cell: any, colNumber: number) => {
          let val = cell.value;
          if (val && typeof val === 'object' && val.result !== undefined) val = val.result;
          if (val && typeof val === 'object' && val.text !== undefined) val = val.text;
          rowObj[headers[colNumber]] = val;
        });
        results.push(rowObj);
      });

      console.log("Results parsed from file:", results.length);
      console.log("First row:", results[0]);

      for (const row of results) {
        try {
          // Flexible key matching for Portuguese headers
          const getVal = (keys: string[]) => {
            const key = Object.keys(row).find(k => keys.includes(k.toLowerCase().trim()));
            return key ? row[key] : null;
          };

          const nomeKey = Object.keys(row).find(k => ['nome', 'nome do produto', 'produto', 'descrição', 'titulo'].includes(k.toLowerCase().trim()));
          const nome = nomeKey ? row[nomeKey] : null;

          const precoVendaKey = Object.keys(row).find(k => ['preco', 'preço', 'valor', 'precovenda', 'preco venda sugerido', 'precovendasugerido', 'preco_venda_sugerido', 'preço de venda', 'preco de venda', 'saldo (r$)', 'saldo', 'saida (r$)', 'saída (r$)'].includes(k.toLowerCase().trim()));
          let precoVendaStr = precoVendaKey ? row[precoVendaKey] : null;

          const precoCustoKey = Object.keys(row).find(k => ['custo', 'preco de custo', 'preço de custo', 'precocusto', 'preco_custo', 'entrada (r$)', 'entrada'].includes(k.toLowerCase().trim()));
          const precoCustoStr = precoCustoKey ? row[precoCustoKey] : null;

          const estoqueKey = Object.keys(row).find(k => ['estoque', 'qtd', 'quantidade', 'qtdestoqueatual', 'qtd_estoque_atual', 'estoque atual'].includes(k.toLowerCase().trim()));
          const estoqueStr = estoqueKey ? row[estoqueKey] : null;

          const encomendaKey = Object.keys(row).find(k => ['encomenda', 'feito encomenda', 'sob encomenda', 'status'].includes(k.toLowerCase().trim()));
          const encomendaStr = encomendaKey ? row[encomendaKey] : null;
          
          const codigoKey = Object.keys(row).find(k => ['codigo', 'código', 'ean', 'sku', 'código de barras', 'codigo de barras', 'ref', 'referencia', 'referência'].includes(k.toLowerCase().trim()));
          const codigoStr = codigoKey ? row[codigoKey] : null;

          // Collect all extra columns to save them so we don't lose data
          const knownKeys = [nomeKey, precoVendaKey, precoCustoKey, estoqueKey, encomendaKey, codigoKey].filter(Boolean);
          const extraInfo: string[] = [];
          Object.keys(row).forEach(k => {
            if (!knownKeys.includes(k) && row[k] !== null && row[k] !== undefined && row[k] !== '') {
               extraInfo.push(`${k}: ${row[k]}`);
            }
          });
          const descricaoExtra = extraInfo.length > 0 ? extraInfo.join(' | ') : null;

          if (!precoVendaStr && precoCustoStr) {
            precoVendaStr = precoCustoStr;
          }

          if (!nome || !precoVendaStr) {
            console.log("Missing fields:", { nome, precoVendaStr });
            fs.appendFileSync('imports.log', `[ROW SKIP] Missing required fields. Nome: "${nome}", PrecoVenda: "${precoVendaStr}"\n`);
            errorCount++;
            continue;
          }

          const precoVenda = parseFloat(String(precoVendaStr).replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) || 0;
          const precoCusto = precoCustoStr ? parseFloat(String(precoCustoStr).replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) : 0;
          const estoque = estoqueStr ? parseFloat(String(estoqueStr).replace(',', '.')) : 0;

          let statusProd = 'ATIVO';
          if (encomendaStr && String(encomendaStr).toLowerCase().includes('encomenda')) {
            statusProd = 'ENCOMENDA';
          } else if (estoque <= 0) {
            statusProd = 'SEM_ESTOQUE';
          }

          await prisma.product.create({
            data: {
              storeId,
              categoryId: defaultCategory.id,
              nome: String(nome).trim(),
              codigoBarrasEan: codigoStr ? String(codigoStr).trim() : null,
              descricaoVariante: descricaoExtra,
              precoVendaSugerido: precoVenda,
              precoCusto: precoCusto,
              qtdEstoqueAtual: estoque,
              status: statusProd
            }
          });
          successCount++;
        } catch (e) {
          console.error("Error creating product:", e);
          errorCount++;
        }
      }

      fs.unlinkSync(req.file.path);

      fs.appendFileSync('imports.log', `[PRODUCTS SUMMARY] Parsed rows: ${results.length}, Success: ${successCount}, Errors: ${errorCount}\nFirst row keys: ${results.length > 0 ? JSON.stringify(Object.keys(results[0])) : 'none'}\n`);

      return res.json({ 
        message: 'Importação finalizada', 
        successCount, 
        errorCount 
      });
    } catch (error: any) {
      console.error(error);
      fs.appendFileSync('imports.log', `[FATAL ERROR PRODUCTS] ${error.message}\n${error.stack}\n`);
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: error.message || 'Formato de arquivo inválido. Tente enviar novamente como .xlsx ou .csv' });
    }
  }

}
