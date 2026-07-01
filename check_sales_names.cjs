const ExcelJS = require('exceljs');

async function check() {
  const file_path = "/Users/paulobarbosa/Downloads/Gestao_perfume_v3 (5) (1) (2).xlsx";
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file_path);
  
  workbook.worksheets.forEach(sheet => {
    let countGisele = 0;
    sheet.eachRow(row => {
      const rowStr = JSON.stringify(row.values).toLowerCase();
      if (rowStr.includes("gisele") || rowStr.includes("flavio") || rowStr.includes("marcia")) {
        countGisele++;
      }
    });
    if (countGisele > 0) {
      console.log(`Planilha: ${sheet.name} - Encontrou ${countGisele} vezes as palavras chaves (Gisele/Flavio/Marcia)`);
    }
  });
}
check();
