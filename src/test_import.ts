import ExcelJS from 'exceljs';

async function run() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Planilha 1');
  ws.columns = [
    { header: 'Nome', key: 'nome' },
    { header: 'Preço', key: 'preco' }
  ];
  ws.addRow({ nome: 'Produto A', preco: 10 });
  
  await wb.csv.writeFile('test.csv');
  
  const wbRead = new ExcelJS.Workbook();
  await wbRead.csv.readFile('test.csv');
  
  console.log("Worksheets length:", wbRead.worksheets.length);
  
  let sheet = wbRead.worksheets[0];
  let foundTargetSheet = false;
  
  for (const s of wbRead.worksheets) {
    let hasRequiredCol = false;
    s.getRow(1).eachCell((cell: any) => {
      const val = cell.value?.toString().toLowerCase().trim() || '';
      console.log("Val:", val);
      if (['nome', 'nome do produto', 'produto', 'descrição', 'titulo'].includes(val)) {
        hasRequiredCol = true;
      }
    });
    if (hasRequiredCol) {
      sheet = s;
      foundTargetSheet = true;
      break;
    }
  }
  
  console.log("Found:", foundTargetSheet);
}
run();
