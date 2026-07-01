const ExcelJS = require('exceljs');

async function check() {
  const file_path = "/Users/paulobarbosa/Downloads/Gestao_perfume_v3 (5) (1) (2).xlsx";
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file_path);
  const sheet = workbook.getWorksheet('Produtos Vendidos');
  
  console.log("Row 1:", sheet.getRow(1).values);
  console.log("Row 2:", sheet.getRow(2).values);
}
check();
