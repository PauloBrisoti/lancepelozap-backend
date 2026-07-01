import { Request, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import { prisma } from '../lib/prisma';

export class PdfCatalogController {
  static async importPdfCatalog(req: Request, res: Response) {
    try {
      const storeId = (req as any).user?.storeId;
      if (!storeId) return res.status(401).json({ error: 'Não autorizado' });

      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ 
          error: 'A Chave GEMINI_API_KEY não está configurada no backend. Para extrair imagens e dados de PDF, adicione a chave no arquivo .env' 
        });
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      const pdfData = fs.readFileSync(req.file.path);
      
      const prompt = `
Você é um assistente de e-commerce e catálogo. 
Recebi um arquivo de catálogo de produtos em PDF. 
Quero que você extraia todos os produtos contidos nele.
Para cada produto, identifique o nome, a marca ou categoria, o código/SKU (se houver), e alguma descrição ou detalhe importante (se houver).
Para a categoria, deduza uma categoria genérica e curta (ex: Roupas, Eletrônicos, Acessórios) com base no produto. NÃO repita o nome do produto na categoria.
IGNORE preços, pois eles serão definidos manualmente.
Retorne EXCLUSIVAMENTE um JSON array com os objetos extraídos. O array deve ter a seguinte estrutura:
[
  {
    "nome": "Nome do Produto",
    "categoria": "Categoria ou Marca",
    "codigo": "12345",
    "descricao": "Detalhe importante"
  }
]
Não inclua crases (markdown), nem a palavra "json" na resposta, apenas retorne o array JSON válido.
      `;

      const result = await model.generateContent([
        {
          inlineData: {
            data: pdfData.toString("base64"),
            mimeType: "application/pdf"
          }
        },
        prompt
      ]);

      let responseText = result.response.text().trim();
      responseText = responseText.replace(/^```json/, '').replace(/```$/, '').trim();
      
      let parsedProducts = [];
      try {
        parsedProducts = JSON.parse(responseText);
      } catch (err) {
        console.error("Erro ao fazer parse do JSON do Gemini", responseText);
        return res.status(500).json({ error: 'A Inteligência Artificial falhou ao estruturar os produtos.' });
      }

      if (!Array.isArray(parsedProducts) || parsedProducts.length === 0) {
        return res.status(400).json({ error: 'Nenhum produto identificado no PDF.' });
      }

      let successCount = 0;
      let errorCount = 0;

      for (const item of parsedProducts) {
        try {
          if (!item.nome) continue;

          let categoryId: string = '';
          const categoryName = item.categoria || 'Geral';
          
          let cat = await prisma.category.findFirst({
            where: { storeId, nome: { equals: categoryName, mode: 'insensitive' } }
          });
          if (!cat) {
            cat = await prisma.category.create({
              data: {
                storeId,
                nome: categoryName,
                corHexadecimal: '#cccccc'
              }
            });
          }
          categoryId = cat.id;

          const existingProduct = await prisma.product.findFirst({
            where: { storeId, nome: item.nome }
          });

          if (!existingProduct) {
            await prisma.product.create({
              data: {
                storeId,
                categoryId,
                nome: item.nome,
                codigoBarrasEan: item.codigo ? String(item.codigo) : Math.random().toString(36).substring(2, 8).toUpperCase(),
                descricaoVariante: item.descricao ? String(item.descricao) : null,
                precoCusto: 0,
                precoVendaSugerido: 0,
                qtdEstoqueAtual: 0
              }
            });
            successCount++;
          }
        } catch (e) {
          errorCount++;
        }
      }

      if (req.file && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }

      return res.status(200).json({
        message: 'Catálogo processado com sucesso!',
        successCount,
        errorCount,
        parsedProducts
      });

    } catch (error: any) {
      if (req.file && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      console.error('Erro na importação de PDF:', error);
      
      let errorMessage = 'Erro interno ao processar o PDF.';
      if (error.message && error.message.includes('413')) {
        errorMessage = 'O PDF é muito grande para a Inteligência Artificial processar de uma só vez (limite de 20MB de texto/imagens diretas). Divida o PDF em partes menores.';
      } else if (error.message && error.message.includes('400')) {
         errorMessage = 'Erro de comunicação com a Inteligência Artificial (Verifique se o arquivo não está corrompido ou é pesado demais).';
      }

      return res.status(500).json({ error: errorMessage, details: error.message });
    }
  }
}
