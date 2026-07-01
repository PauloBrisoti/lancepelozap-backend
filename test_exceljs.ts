import ExcelJS from 'exceljs';
import fs from 'fs';

async function run() {
  const isCsv = true;
  fs.writeFileSync('test.csv', 'Nome,Preço\nBola,10\nCarro,20');

  const workbook = new ExcelJS.Workbook();
  if (isCsv) {
    await workbook.csv.readFile('test.csv');
  } else {
    await workbook.xlsx.readFile('test.csv');
  }

  const sheet = workbook.worksheets[0];
  console.log("Sheet name:", sheet?.name);

  const results: any[] = [];
  const headers: string[] = [];

  sheet.getRow(1).eachCell((cell: any, colNumber: number) => {
    headers[colNumber] = cell.value?.toString().toLowerCase().trim() || `col${colNumber}`;
  });

  sheet.eachRow((row: any, rowNumber: number) => {
    if (rowNumber === 1) return;
    const rowObj: any = {};
    row.eachCell((cell: any, colNumber: number) => {
      let val = cell.value;
      if (val && typeof val === 'object' && val.result !== undefined) val = val.result;
      if (val && typeof val === 'object' && val.text !== undefined) val = val.text;
      rowObj[headers[colNumber]] = val;
    });
    results.push(rowObj);
  });

  console.log(results);
}

run().catch(console.error);
