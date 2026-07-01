import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { LegacyImportController } from './src/controllers/LegacyImportController.js';

async function test() {
  const file_path = "/Users/paulobarbosa/Downloads/Gestao_perfume_v3 (5) (1) (2).xlsx";
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file_path);
  
  const allKeywords = ['pedido', 'vendido', 'sinal recebido', 'valor total', 'status', 'forma pgto', 'data', 'cliente', 'produto', 'qtd', 'quantidade'];
  let sheet = LegacyImportController.findSheet(workbook, ['produtos vendidos', 'produtos_vendidos', 'venda', 'vendido', 'pedido'], ['pedido', 'sinal', 'status', 'forma pgto']);
  
  if (!sheet) {
    console.log("Nenhuma planilha encontrada.");
    return;
  }
  
  console.log("Planilha Selecionada:", sheet.name);
}

test();
