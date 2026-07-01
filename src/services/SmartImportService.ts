import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import { prisma } from '../lib/prisma';
import ExcelJS from 'exceljs';
import path from 'path';

export class SmartImportService {
  static async processFile(storeId: string, filePath: string, originalName: string) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('A Chave GEMINI_API_KEY não está configurada no backend.');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const ext = path.extname(originalName).toLowerCase();
    let promptData = '';
    let inlineData = null;

    if (ext === '.xlsx' || ext === '.xls') {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      let csvContent = '';
      workbook.worksheets.forEach(sheet => {
        csvContent += `\n--- Aba: ${sheet.name} ---\n`;
        sheet.eachRow((row, rowNumber) => {
          csvContent += JSON.stringify(row.values) + '\n';
        });
      });
      promptData = `Aqui estão os dados extraídos de uma planilha Excel (em formato de arrays por linha):\n${csvContent}\n\n`;
    } else if (ext === '.csv') {
      const csvContent = fs.readFileSync(filePath, 'utf-8');
      promptData = `Aqui estão os dados de um arquivo CSV:\n${csvContent}\n\n`;
    } else if (ext === '.pdf') {
      const pdfData = fs.readFileSync(filePath);
      inlineData = {
        data: pdfData.toString("base64"),
        mimeType: "application/pdf"
      };
      promptData = `Extraia as informações do extrato financeiro ou relatório anexado em PDF.\n\n`;
    } else {
      throw new Error('Formato não suportado para importação inteligente.');
    }

    const prompt = `
Você é um assistente financeiro de um sistema ERP SaaS.
Sua missão é ler os dados brutos de um cliente (que podem ser uma planilha bagunçada ou um extrato) e estruturá-los para salvar no banco de dados.
Categorize as despesas de acordo com o DRE comum (ex: Despesa com Veículo, Despesa com Alimentação, Impostos, etc).

Retorne EXCLUSIVAMENTE um JSON com a seguinte estrutura:
{
  "clientes": [{ "nome": "...", "telefone": "..." }],
  "produtos": [{ "nome": "...", "marca": "...", "custo": 0, "venda": 0, "estoque": 0 }],
  "vendas": [
    { 
      "cliente": "...", 
      "produtos": [{ "nome": "...", "qtd": 1, "vendaUnit": 0 }], 
      "data": "YYYY-MM-DD", 
      "formaPgto": "PIX|CARTAO_CREDITO|CARTAO_DEBITO|DINHEIRO|CREDIARIO|OUTROS", 
      "valorTotal": 0,
      "sinalRecebido": 0,
      "status": "ANDAMENTO"
    }
  ],
  "transacoes_financeiras": [
    { 
      "descricao": "...", 
      "categoria_dre": "...", 
      "tipo": "ENTRADA|SAIDA", 
      "valor": 0, 
      "data": "YYYY-MM-DD",
      "formaPgto": "PIX|CARTAO_CREDITO|CARTAO_DEBITO|DINHEIRO|OUTROS"
    }
  ]
}

- A aba "Cadastro de Produto" deve ser lida na íntegra. Retorne TODOS os produtos listados no array "produtos", mesmo os que possuem estoque vazio (0).
- Se um produto não tiver custo ou venda explícitos, coloque 0.
- A aba "Pedidos" contém uma coluna "Sinal Recebido". Preencha o campo "sinalRecebido" da venda com este valor. Se estiver vazio ou zero, coloque 0.
- A aba "Pedidos" representa vendas em "ANDAMENTO". A aba "Produtos Vendidos" representa o histórico de vendas "FINALIZADA".
- NÃO DUPLIQUE VENDAS! Se a mesma venda aparecer na aba "Pedidos" e "Produtos Vendidos", retorne-a apenas uma vez. Classifique o "status" corretamente.
- Se uma venda for "FIADO", "CREDIÁRIO" ou "A RECEBER", defina a formaPgto como "CREDIARIO".
- Se houver fluxo de caixa (extrato), preencha o array transacoes_financeiras. Se for receita de venda que já está no array vendas, NÃO duplique em transacoes_financeiras. Transações financeiras são gastos operacionais ou receitas não ligadas diretamente à venda detalhada.
- NÃO use crases (markdown), apenas o JSON puro e válido.

ATENÇÃO: É EXTREMAMENTE CRÍTICO QUE VOCÊ EXTRAIA TODAS AS LINHAS E TODOS OS ITENS! NÃO RESUMA DADOS. SE A PLANILHA TIVER 20 VENDAS, RETORNE UM ARRAY COM 20 OBJETOS DE VENDAS. NÃO OMITA NADA.
    `;

    const contents: any[] = [];
    if (inlineData) contents.push({ inlineData });
    contents.push(promptData + prompt);

    const result = await model.generateContent(contents);
    let responseText = result.response.text().trim();
    responseText = responseText.replace(/^```json/, '').replace(/```$/, '').trim();

    let parsedData;
    try {
      parsedData = JSON.parse(responseText);
    } catch (e) {
      throw new Error('A IA falhou ao gerar um formato estruturado válido.');
    }

    return this.saveToDatabase(storeId, parsedData);
  }

  private static sanitizeNumber(val: any): number {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    const limpo = String(val).replace(/[^0-9,-]+/g, "").replace(",", ".");
    return parseFloat(limpo) || 0;
  }

  private static async saveToDatabase(storeId: string, data: any) {
    let success = { clientes: 0, produtos: 0, vendas: 0, transacoes: 0 };

    // 1. Clientes
    const customerMap = new Map<string, string>();
    if (data?.clientes && Array.isArray(data.clientes)) {
      for (const c of data.clientes) {
        try {
          if (!c?.nome) continue;
          const nomeLimpo = String(c.nome).trim();
          let customer = await prisma.customer.findFirst({
            where: { storeId, nomeCompleto: { equals: nomeLimpo, mode: 'insensitive' } }
          });
          if (!customer) {
            customer = await prisma.customer.create({
              data: { storeId, nomeCompleto: nomeLimpo, telefoneWhatsapp: c?.telefone || null }
            });
          }
          success.clientes++;
          customerMap.set(nomeLimpo.toLowerCase(), customer.id);
        } catch (err) {
          console.error(`Erro ao importar cliente ${c?.nome}:`, err);
        }
      }
    }

    // 2. Produtos
    const productMap = new Map<string, string>();
    let defaultCategory = await prisma.category.findFirst({ where: { storeId, nome: 'Geral' } });
    if (!defaultCategory) {
      defaultCategory = await prisma.category.create({ data: { storeId, nome: 'Geral', corHexadecimal: '#cccccc' } });
    }

    if (data?.produtos && Array.isArray(data.produtos)) {
      for (const p of data.produtos) {
        try {
          if (!p?.nome) continue;
          const nomeLimpo = String(p.nome).trim();
          let product = await prisma.product.findFirst({
            where: { storeId, nome: { equals: nomeLimpo, mode: 'insensitive' } }
          });
          if (!product) {
            product = await prisma.product.create({
              data: {
                storeId,
                categoryId: defaultCategory.id,
                nome: nomeLimpo,
                codigoBarrasEan: Math.random().toString(36).substring(2, 8).toUpperCase(),
                precoCusto: this.sanitizeNumber(p?.custo),
                precoVendaSugerido: this.sanitizeNumber(p?.venda),
                qtdEstoqueAtual: this.sanitizeNumber(p?.estoque)
              }
            });
          }
          success.produtos++;
          productMap.set(nomeLimpo.toLowerCase(), product.id);
        } catch (err) {
          console.error(`Erro ao importar produto ${p?.nome}:`, err);
        }
      }
    }

    // 3. Vendas
    let wallet = await prisma.wallet.findFirst({ where: { storeId } });
    if (!wallet) {
      wallet = await prisma.wallet.create({ data: { storeId, nome: 'Caixa Principal', tipo: 'CAIXA', saldoAtual: 0 } });
    }

    if (data?.vendas && Array.isArray(data.vendas)) {
      let userAccess = await prisma.storeUserAccess.findFirst({ where: { storeId } });
      if (!userAccess) throw new Error("Loja não possui usuário para registrar vendas.");

      for (const v of data.vendas) {
        try {
          const nomeClienteLimpo = v?.cliente ? String(v.cliente).trim() : '';
          let customerId = nomeClienteLimpo ? customerMap.get(nomeClienteLimpo.toLowerCase()) : undefined;
          if (nomeClienteLimpo && !customerId) {
            const newC = await prisma.customer.create({ data: { storeId, nomeCompleto: nomeClienteLimpo } });
            customerId = newC.id;
            customerMap.set(nomeClienteLimpo.toLowerCase(), newC.id);
          }

          const date = v?.data ? new Date(v.data) : new Date();
          const formaPgto = v?.formaPgto || 'PIX';
          const cmvTotal = v?.produtos?.reduce((acc: number, p: any) => acc + (this.sanitizeNumber(p?.custo) * this.sanitizeNumber(p?.qtd || 1)), 0) || 0;
          const valorTotalVenda = this.sanitizeNumber(v?.valorTotal);
          const sinalRecebido = this.sanitizeNumber(v?.sinalRecebido);
          const statusVenda = v?.status === 'FINALIZADA' ? 'FINALIZADA' : 'ANDAMENTO';

          const sale = await prisma.sale.create({
            data: {
              storeId,
              userId: userAccess.userId,
              customerId: customerId || null,
              dataVenda: date,
              valorTotalBruto: valorTotalVenda,
              valorDesconto: 0,
              valorTotalLiquido: valorTotalVenda,
              valorSinal: sinalRecebido,
              formaPagamento: formaPgto,
              status: statusVenda,
              cmvTotal,
              observacoes: 'Importado via IA'
            }
          });

          if (v?.produtos && Array.isArray(v.produtos)) {
            for (const item of v.produtos) {
              try {
                const nomeProdLimpo = item?.nome ? String(item.nome).trim() : '';
                let productId = nomeProdLimpo ? productMap.get(nomeProdLimpo.toLowerCase()) : undefined;
                if (nomeProdLimpo && !productId) {
                   const newP = await prisma.product.create({
                     data: { storeId, categoryId: defaultCategory!.id, nome: nomeProdLimpo, codigoBarrasEan: Math.random().toString(36).substring(2,8), precoCusto: this.sanitizeNumber(item?.custo), precoVendaSugerido: this.sanitizeNumber(item?.vendaUnit), qtdEstoqueAtual: 0 }
                   });
                   productId = newP.id;
                   productMap.set(nomeProdLimpo.toLowerCase(), newP.id);
                }
                if (productId) {
                  await prisma.saleItem.create({
                    data: {
                      saleId: sale.id,
                      productId,
                      quantidade: this.sanitizeNumber(item?.qtd || 1),
                      precoUnitarioVendido: this.sanitizeNumber(item?.vendaUnit),
                      custoUnitarioHistorico: this.sanitizeNumber(item?.custo)
                    }
                  });
                }
              } catch (errItem) {
                console.error(`Erro ao importar item ${item?.nome} da venda:`, errItem);
              }
            }
          }

          const saldoDevedor = valorTotalVenda - sinalRecebido;

          if (sinalRecebido > 0) {
            await prisma.financialTransaction.create({
              data: {
                storeId, walletId: wallet.id, saleId: sale.id, tipo: 'ENTRADA', valor: sinalRecebido, dataTransacao: date, descricao: `Recebimento de Sinal/Venda via IA - ${nomeClienteLimpo}`, categoria: 'Venda'
              }
            });
            await prisma.wallet.update({
              where: { id: wallet.id },
              data: { saldoAtual: { increment: sinalRecebido } }
            });
            success.transacoes++;
            if (!data.transacoes_financeiras) data.transacoes_financeiras = [];
            data.transacoes_financeiras.push({ tipo: 'ENTRADA', valor: sinalRecebido, descricao: `Sinal da Venda - ${nomeClienteLimpo}` });
          }

          if (saldoDevedor > 0 && customerId) {
            await prisma.accountReceivable.create({
              data: {
                storeId, saleId: sale.id, customerId, dataVencimento: date, valorParcela: saldoDevedor, formaPagamentoEsperada: formaPgto === 'CREDIARIO' ? 'DINHEIRO' : formaPgto, status: 'PENDENTE'
              }
            });
          }
          success.vendas++;
        } catch (errVenda) {
          console.error(`Erro ao importar venda do cliente ${v?.cliente}:`, errVenda);
        }
      }
    }

    // 4. Transações Financeiras
    if (data?.transacoes_financeiras && Array.isArray(data.transacoes_financeiras)) {
      for (const t of data.transacoes_financeiras) {
        try {
          const date = t?.data ? new Date(t.data) : new Date();
          const valor = this.sanitizeNumber(t?.valor);
          const tipo = t?.tipo === 'SAIDA' ? 'SAIDA' : 'ENTRADA';

          await prisma.financialTransaction.create({
            data: {
              storeId,
              walletId: wallet.id,
              tipo,
              valor,
              dataTransacao: date,
              descricao: t?.descricao ? String(t.descricao) : 'Transação via IA',
              categoria: t?.categoria_dre ? String(t.categoria_dre) : 'Outros'
            }
          });

          await prisma.wallet.update({
            where: { id: wallet.id },
            data: {
              saldoAtual: tipo === 'ENTRADA' ? { increment: valor } : { decrement: valor }
            }
          });
          success.transacoes++;
        } catch (errTx) {
          console.error(`Erro ao importar transação ${t?.descricao}:`, errTx);
        }
      }
    }

    return { message: 'Processamento inteligente concluído', success, rawData: data };
  }
}
