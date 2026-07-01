import ExcelJS from 'exceljs';
import fs from 'fs';
import FormData from 'form-data';
import jwt from 'jsonwebtoken';
import 'dotenv/config';

async function run() {
  const token = jwt.sign({ userId: 'test', storeId: 'cmqk3zqtj00008zvkcx6xtq7m', role: 'ADMIN' }, process.env.JWT_SECRET || 'chave_secreta_provisoria_para_testes', { expiresIn: '1d' });

  const writeWb = new ExcelJS.Workbook();
  const ws = writeWb.addWorksheet('Produtos');
  ws.columns = [
    { header: 'Nome', key: 'nome', width: 30 },
    { header: 'Preço de Venda', key: 'precoVenda', width: 15 },
  ];
  ws.addRow({ nome: 'Teste Upload', precoVenda: 10 });
  await writeWb.xlsx.writeFile('test_upload.xlsx');

  const form = new FormData();
  form.append('file', fs.createReadStream('test_upload.xlsx'));

  const res = await fetch('http://localhost:3001/api/import/produtos', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: form
  });

  const data = await res.json();
  console.log("Response:", res.status, data);
}

run().catch(console.error);
