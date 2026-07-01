import ExcelJS from 'exceljs';

async function gerar() {
  const wb = new ExcelJS.Workbook();

  // ===== INSTRUÇÕES =====
  const instr = wb.addWorksheet('Instruções');
  instr.addRow(['📋 GUIA RÁPIDO - IMPORTAR SEUS DADOS']);
  instr.addRow(['']);
  instr.addRow(['Preencha as abas abaixo com os dados do seu negócio.']);
  instr.addRow(['Cada aba representa um tipo de informação.']);
  instr.addRow(['Preencha apenas as que você tiver.']);
  instr.addRow(['']);
  instr.addRow(['✅ REGRAS:']);
  instr.addRow(['1. Não altere os nomes das colunas (primeira linha)']);
  instr.addRow(['2. Preencha os dados a partir da linha 2 (substitua os exemplos)']);
  instr.addRow(['3. Valores com vírgula use ponto: 10.50 (não 10,50)']);
  instr.addRow(['4. Datas: DD/MM/AAAA ou AAAA-MM-DD']);
  instr.addRow(['5. Forma de Pagamento: DINHEIRO | PIX | CARTAO_CREDITO | CARTAO_DEBITO | CREDIARIO']);
  instr.addRow(['']);
  instr.addRow(['📌 ABAS DISPONÍVEIS:']);
  instr.addRow(['  1. Produtos → Seu catálogo']);
  instr.addRow(['  2. Clientes → Seus clientes']);
  instr.addRow(['  3. Vendas → Histórico de vendas']);
  instr.addRow(['  4. Fiado → Contas a receber']);
  instr.addRow(['  5. Fornecedores → Seus fornecedores']);
  instr.addRow(['']);
  instr.addRow(['Após preencher, envie o arquivo para o suporte ou acesse o sistema em: Importar Planilha']);
  instr.getColumn(1).width = 70;

  // ===== PRODUTOS =====
  const prod = wb.addWorksheet('Produtos');
  prod.addRow(['Nome', 'Código (SKU/EAN)', 'Categoria', 'Preço Custo (R$)', 'Preço Venda (R$)', 'Estoque Atual', 'Unidade']);
  prod.addRow(['Ex: Coca-Cola 2L', '7894900010017', 'Bebidas', 5.50, 9.00, 100, 'UN']);
  prod.addRow(['', '', '', '', '', '', '']);
  prod.addRow(['→ Preencha a partir desta linha (apague os exemplos)']);
  prod.columns = [{ width: 30 }, { width: 22 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 14 }, { width: 10 }];
  prod.getRow(1).font = { bold: true };

  // ===== CLIENTES =====
  const cli = wb.addWorksheet('Clientes');
  cli.addRow(['Nome Completo', 'CPF', 'Telefone/WhatsApp', 'E-mail', 'Endereço']);
  cli.addRow(['Ex: João Silva', '529.982.247-25', '11911111111', 'joao@email.com', 'Rua A, 123 - Centro']);
  cli.addRow(['', '', '', '', '']);
  cli.addRow(['→ Preencha a partir desta linha']);
  cli.columns = [{ width: 30 }, { width: 18 }, { width: 22 }, { width: 30 }, { width: 40 }];
  cli.getRow(1).font = { bold: true };

  // ===== VENDAS =====
  const vend = wb.addWorksheet('Vendas');
  vend.addRow(['Data', 'Produto', 'Quantidade', 'Valor Unitário (R$)', 'Forma Pagamento', 'Cliente', 'Vendedor']);
  vend.addRow(['01/06/2026', 'Coca-Cola 2L', 2, 9.00, 'DINHEIRO', '', 'Carlos']);
  vend.addRow(['', '', '', '', '', '', '']);
  vend.addRow(['→ Preencha a partir desta linha']);
  vend.columns = [{ width: 15 }, { width: 25 }, { width: 12 }, { width: 18 }, { width: 20 }, { width: 25 }, { width: 15 }];
  vend.getRow(1).font = { bold: true };

  // ===== FIADO =====
  const fiado = wb.addWorksheet('Fiado');
  fiado.addRow(['Cliente', 'Valor Parcela (R$)', 'Vencimento', 'Status']);
  fiado.addRow(['Ex: João Silva', 25.00, '10/07/2026', 'PENDENTE']);
  fiado.addRow(['', '', '', '']);
  fiado.addRow(['→ Status: PENDENTE | PAGO | VENCIDO']);
  fiado.columns = [{ width: 25 }, { width: 18 }, { width: 15 }, { width: 12 }];
  fiado.getRow(1).font = { bold: true };

  // ===== FORNECEDORES =====
  const forn = wb.addWorksheet('Fornecedores');
  forn.addRow(['Nome', 'Contato', 'Telefone', 'E-mail']);
  forn.addRow(['Ex: Distribuidora de Bebidas Ltda', 'João', '11333333333', 'joao@fornecedor.com']);
  forn.addRow(['', '', '', '']);
  forn.addRow(['→ Preencha a partir desta linha']);
  forn.columns = [{ width: 35 }, { width: 20 }, { width: 18 }, { width: 30 }];
  forn.getRow(1).font = { bold: true };

  const filePath = '/Users/paulobarbosa/Projetos/template_para_cliente.xlsx';
  await wb.xlsx.writeFile(filePath);
  console.log(`✅ Template criado: ${filePath}`);
}

gerar().catch(console.error);
