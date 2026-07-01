const ExcelJS = require('exceljs');

async function check() {
  const file_path = "/Users/paulobarbosa/Downloads/Gestao_perfume_v3 (5) (1) (2).xlsx";
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file_path);
  
  const sheet = workbook.getWorksheet('Produtos Vendidos');
  if (!sheet) return console.log("Planilha 'Produtos Vendidos' não encontrada");

  for (let i = 1; i <= 15; i++) {
    const row = sheet.getRow(i).values;
    console.log(`Linha ${i}:`, row);
  }
}
check();
