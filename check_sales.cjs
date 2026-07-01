const ExcelJS = require('exceljs');

async function check() {
  const file_path = "/Users/paulobarbosa/Downloads/Gestao_perfume_v3 (5) (1) (2).xlsx";
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file_path);
  
  ['Pedidos', 'Produtos Vendidos'].forEach(name => {
    const sheet = workbook.getWorksheet(name);
    if (sheet) {
      console.log(`\n--- ${name} ---`);
      console.log(`Total de linhas na planilha: ${sheet.rowCount}`);
      let countCrédito = 0;
      let countFiado = 0;
      
      sheet.eachRow((row, rowNumber) => {
        const rowStr = JSON.stringify(row.values).toLowerCase();
        if (rowStr.includes("crédito") || rowStr.includes("credito") || rowStr.includes("cartão")) countCrédito++;
        if (rowStr.includes("fiado") || rowStr.includes("crediário") || rowStr.includes("crediario")) countFiado++;
      });
      console.log(`Menções: Crédito=${countCrédito}, Fiado=${countFiado}`);
    }
  });
}
check();
