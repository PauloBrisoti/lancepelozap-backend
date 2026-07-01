import ExcelJS from 'exceljs';
import fs from 'fs';

async function run() {
  const writeWb = new ExcelJS.Workbook();
  const ws = writeWb.addWorksheet('Produtos');
  ws.columns = [
    { header: 'Nome', key: 'nome', width: 30 },
    { header: 'Preço de Venda', key: 'precoVenda', width: 15 },
  ];
  ws.addRow({ nome: 'Teste', precoVenda: 10 });
  await writeWb.xlsx.writeFile('test2.xlsx');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile('test2.xlsx');
  
  const sheet = workbook.worksheets[0];
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

  console.log("Headers:", headers);
  console.log("Results:", results);
}

run().catch(console.error);
