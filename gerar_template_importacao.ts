import ExcelJS from 'exceljs';

async function gerar() {
  const wb = new ExcelJS.Workbook();

  // ===== INSTRUÇÕES =====
  const instr = wb.addWorksheet('Instruções');
  instr.addRow(['📋 GUIA DE IMPORTAÇÃO - LANCE PELO ZAP']);
  instr.addRow(['']);
  instr.addRow(['Use este arquivo para importar seus dados para o sistema.']);
  instr.addRow(['Cada aba representa um tipo de dado diferente.']);
  instr.addRow(['Preencha apenas as abas que você precisa.']);
  instr.addRow(['']);
  instr.addRow(['📌 REGRAS GERAIS:']);
  instr.addRow(['1. Não altere os nomes das colunas (primeira linha de cada aba)']);
  instr.addRow(['2. Preencha os dados a partir da linha 2']);
  instr.addRow(['3. Campos marcados com * são obrigatórios']);
  instr.addRow(['4. Valores decimais usam ponto (.) como separador: 10.50']);
  instr.addRow(['5. Datas no formato: DD/MM/AAAA ou AAAA-MM-DD']);
  instr.addRow(['']);
  instr.addRow(['📌 ABAS DISPONÍVEIS:']);
  instr.addRow(['  • Produtos     → Cadastro de produtos']);
  instr.addRow(['  • Clientes     → Cadastro de clientes']);
  instr.addRow(['  • Vendas       → Histórico de vendas']);
  instr.addRow(['  • Fiado        → Contas a receber']);
  instr.addRow(['  • Fornecedores → Cadastro de fornecedores']);
  instr.addRow(['']);
  instr.addRow(['Após preencher, acesse o sistema em:']);
  instr.addRow(['Menu → Importar Planilha → Selecione o arquivo → Importar']);

  instr.getColumn(1).width = 80;

  // ===== PRODUTOS =====
  const prod = wb.addWorksheet('Produtos');
  prod.addRow(['Nome*', 'Código (SKU/EAN)', 'Categoria*', 'Preço Custo*', 'Preço Venda*', 'Estoque Atual*', 'Unidade', 'NCM']);
  prod.addRow(['Coca-Cola 2L', '7894900010017', 'Bebidas', '5.50', '9.00', '100', 'UN', '22021000']);
  prod.addRow(['Arroz 5kg', '7891234567890', 'Alimentos', '12.00', '22.90', '50', 'UN', '10062000']);
  prod.addRow(['', '', '', '', '', '', '', '']);
  prod.addRow(['→ Colunas obrigatórias: Nome, Categoria, Preço Custo, Preço Venda, Estoque Atual']);
  prod.columns = [{ width: 30 }, { width: 20 }, { width: 20 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 10 }, { width: 10 }];

  // ===== CLIENTES =====
  const cli = wb.addWorksheet('Clientes');
  cli.addRow(['Nome Completo*', 'CPF', 'Telefone/WhatsApp', 'E-mail', 'Endereço Completo', 'CEP', 'Data Nascimento']);
  cli.addRow(['João Silva', '529.982.247-25', '11911111111', 'joao@email.com', 'Rua A, 123 - Centro', '01001-000', '15/05/1990']);
  cli.addRow(['Maria Souza', '123.456.789-09', '11922222222', 'maria@email.com', 'Av. B, 456', '02002-000', '20/08/1985']);
  cli.addRow(['', '', '', '', '', '', '']);
  cli.addRow(['→ Coluna obrigatória: Nome Completo']);
  cli.columns = [{ width: 30 }, { width: 18 }, { width: 22 }, { width: 30 }, { width: 40 }, { width: 12 }, { width: 18 }];

  // ===== VENDAS =====
  const vend = wb.addWorksheet('Vendas');
  vend.addRow(['Data*', 'Produto*', 'Quantidade*', 'Valor Unitário*', 'Desconto (R$)', 'Forma Pagamento', 'Parcelas', 'Cliente', 'Vendedor', 'Observação']);
  vend.addRow(['01/06/2026', 'Coca-Cola 2L', '2', '9.00', '0', 'DINHEIRO', '1', '', 'Carlos', '']);
  vend.addRow(['15/06/2026', 'Arroz 5kg', '1', '22.90', '2.00', 'PIX', '1', 'João Silva', 'Ana', '']);
  vend.addRow(['', '', '', '', '', '', '', '', '', '']);
  vend.addRow(['→ Colunas obrigatórias: Data, Produto, Quantidade, Valor Unitário']);
  vend.addRow(['→ Forma Pagamento: DINHEIRO | PIX | CARTAO_CREDITO | CARTAO_DEBITO | CREDIARIO']);
  vend.columns = [{ width: 15 }, { width: 25 }, { width: 12 }, { width: 15 }, { width: 15 }, { width: 20 }, { width: 10 }, { width: 25 }, { width: 15 }, { width: 30 }];

  // ===== FIADO =====
  const fiado = wb.addWorksheet('Fiado');
  fiado.addRow(['Cliente*', 'Valor Parcela*', 'Vencimento*', 'Nº Parcela', 'Total Parcelas', 'Status']);
  fiado.addRow(['João Silva', '25.00', '10/07/2026', '1', '2', 'PENDENTE']);
  fiado.addRow(['João Silva', '25.00', '10/08/2026', '2', '2', 'PENDENTE']);
  fiado.addRow(['', '', '', '', '', '']);
  fiado.addRow(['→ Status: PENDENTE | PAGO | VENCIDO']);
  fiado.columns = [{ width: 25 }, { width: 15 }, { width: 15 }, { width: 12 }, { width: 15 }, { width: 12 }];

  // ===== FORNECEDORES =====
  const forn = wb.addWorksheet('Fornecedores');
  forn.addRow(['Nome*', 'Contato', 'Telefone', 'E-mail', 'CNPJ/CPF']);
  forn.addRow(['Distribuidora de Bebidas Ltda', 'João', '11333333333', 'joao@distribuidora.com', '12.345.678/0001-90']);
  forn.addRow(['', '', '', '', '']);
  forn.addRow(['→ Coluna obrigatória: Nome']);

  const filePath = '/Users/paulobarbosa/Projetos/template_importacao_clientes.xlsx';
  await wb.xlsx.writeFile(filePath);
  console.log(`Template gerado: ${filePath}`);
}

gerar().catch(console.error);
