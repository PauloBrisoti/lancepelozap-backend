import ExcelJS from 'exceljs';
import fs from 'fs';

async function run() {
  fs.writeFileSync('test_sep.csv', 'Nome;Preço\nBola;10\nCarro;20');

  const workbook = new ExcelJS.Workbook();
  const sheet = await workbook.csv.readFile('test_sep.csv', { parserOptions: { delimiter: ';' } });

  console.log("Sheet name:", sheet?.name);
  console.log("Worksheets len:", workbook.worksheets.length);

  const results: any[] = [];
  const headers: string[] = [];

  sheet.getRow(1).eachCell((cell: any, colNumber: number) => {
    headers[colNumber] = cell.value?.toString().toLowerCase().trim() || `col${colNumber}`;
  });

  sheet.eachRow((row: any, rowNumber: number) => {
    if (rowNumber === 1) return;
    const rowObj: any = {};
    row.eachCell((cell: any, colNumber: number) => {
      rowObj[headers[colNumber]] = cell.value;
    });
    results.push(rowObj);
  });

  console.log(headers);
  console.log(results);
}

run().catch(console.error);
