import ExcelJS from 'exceljs';

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile('./uploads/temp/4551dd66dbeda67847f261cbc631fd3e');
  
  const sheet = workbook.worksheets.find(w => w.name === 'Cadastro de Produto');
  if (!sheet) {
    console.log("No sheet found.");
    return;
  }
  
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < 25) {
      console.log(`Row ${rowNumber}:`, JSON.stringify(row.values));
    }
  });
}
main().catch(console.error);
