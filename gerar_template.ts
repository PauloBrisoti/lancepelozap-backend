import ExcelJS from 'exceljs';

async function gerar() {
  const wb = new ExcelJS.Workbook();

  // ===== ABA 1: PRODUTOS =====
  const ws1 = wb.addWorksheet('Produtos');
  ws1.addRow(['Nome do Produto', 'Código (SKU/EAN)', 'Categoria', 'Preço de Custo (R$)', 'Preço de Venda (R$)', 'Estoque Atual', 'Unidade']);
  ws1.addRow(['Coca-Cola 2L', '7894900010017', 'Bebidas', 5.50, 9.00, 100, 'UN']);
  ws1.addRow(['Arroz 5kg', '7891234567890', 'Alimentos', 12.00, 22.90, 50, 'UN']);
  ws1.addRow(['', '', '', '', '', '', '']);
  ws1.addRow(['→ Colunas obrigatórias: Nome, Preço de Custo, Preço de Venda, Estoque']);
  ws1.addRow(['→ Código, Categoria e Unidade são opcionais']);

  // ===== ABA 2: CLIENTES =====
  const ws2 = wb.addWorksheet('Clientes');
  ws2.addRow(['Nome Completo', 'CPF', 'Telefone/WhatsApp', 'E-mail', 'Endereço Completo']);
  ws2.addRow(['João Silva', '529.982.247-25', '11911111111', 'joao@email.com', 'Rua A, 123 - Centro']);
  ws2.addRow(['Maria Souza', '123.456.789-09', '11922222222', 'maria@email.com', 'Av. B, 456']);
  ws2.addRow(['', '', '', '', '']);
  ws2.addRow(['→ Colunas obrigatórias: Nome']);
  ws2.addRow(['→ CPF, Telefone, E-mail e Endereço são opcionais']);

  // ===== ABA 3: VENDAS =====
  const ws3 = wb.addWorksheet('Vendas');
  ws3.addRow(['Data', 'Produto', 'Quantidade', 'Valor Unitário (R$)', 'Valor Total (R$)', 'Desconto (R$)', 'Forma Pagamento', 'Parcelas', 'Taxa Máquina (R$)', 'Sinal (R$)', 'Cliente', 'Vendedor', 'Observação']);
  ws3.addRow(['01/06/2026', 'Coca-Cola 2L', 2, 9.00, 18.00, 0, 'DINHEIRO', 1, 0, 0, 'João Silva', 'Carlos', '']);
  ws3.addRow(['15/06/2026', 'Arroz 5kg', 1, 22.90, 22.90, 2.00, 'PIX', 1, 0, 0, '', 'Carlos', '']);
  ws3.addRow(['15/06/2026', 'Coca-Cola 2L', 3, 9.00, 27.00, 0, 'CARTAO_CREDITO', 2, 3.99, 0, 'Maria Souza', 'Ana', '']);
  ws3.addRow(['', '', '', '', '', '', '', '', '', '', '', '', '']);
  ws3.addRow(['→ Data, Produto, Quantidade e Valor Unitário são obrigatórios']);
  ws3.addRow(['→ Forma Pagamento: DINHEIRO | PIX | CARTAO_CREDITO | CARTAO_DEBITO | CREDIARIO']);
  ws3.addRow(['→ Para vender fiado (CREDIARIO), preencha Sinal, Parcelas e Cliente']);

  // ===== ABA 4: FIADO =====
  const ws4 = wb.addWorksheet('Fiado');
  ws4.addRow(['Cliente', 'Valor Parcela (R$)', 'Vencimento', 'Nº Parcela', 'Total Parcelas', 'Status']);
  ws4.addRow(['João Silva', 25.00, '10/07/2026', 1, 2, 'PENDENTE']);
  ws4.addRow(['João Silva', 25.00, '10/08/2026', 2, 2, 'PENDENTE']);
  ws4.addRow(['', '', '', '', '', '']);
  ws4.addRow(['→ Colunas obrigatórias: Cliente, Valor Parcela, Vencimento']);
  ws4.addRow(['→ Status: PENDENTE | PAGO | VENCIDO']);

  // ===== ABA 5: FUNCIONÁRIOS =====
  const ws5 = wb.addWorksheet('Funcionarios');
  ws5.addRow(['Nome', 'E-mail', 'Cargo']);
  ws5.addRow(['Carlos Vendedor', 'carlos@email.com', 'VENDEDOR']);
  ws5.addRow(['Marina Caixa', 'marina@email.com', 'CAIXA']);
  ws5.addRow(['', '', '']);
  ws5.addRow(['→ Colunas obrigatórias: Nome, E-mail, Cargo']);

  // ===== ABA 6: FORNECEDORES =====
  const ws6 = wb.addWorksheet('Fornecedores');
  ws6.addRow(['Nome', 'Contato', 'Telefone']);
  ws6.addRow(['Distribuidora de Bebidas Ltda', 'João', '11333333333']);
  ws6.addRow(['Alimentos Premium S.A.', 'Maria', '11444444444']);
  ws6.addRow(['', '', '']);
  ws6.addRow(['→ Colunas obrigatórias: Nome']);

  // ===== ABA 7: ESTOQUE INICIAL =====
  const ws7 = wb.addWorksheet('Estoque Inicial');
  ws7.addRow(['Nome do Produto', 'Quantidade']);
  ws7.addRow(['Coca-Cola 2L', 200]);
  ws7.addRow(['Arroz 5kg', 80]);
  ws7.addRow(['', '']);
  ws7.addRow(['→ Use esta aba para registrar o estoque inicial dos produtos']);
  ws7.addRow(['→ O produto precisa existir (cadastrado na aba "Produtos")']);

  const filePath = '/Users/paulobarbosa/Projetos/template_importacao.xlsx';
  await wb.xlsx.writeFile(filePath);
  console.log(`Template gerado: ${filePath}`);
}

gerar().catch(console.error);
