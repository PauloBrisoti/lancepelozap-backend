import fs from 'fs';
const path = '/Users/paulobarbosa/Projetos/backend/src/scripts/seedUser.ts';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(/let tenant = await prisma\.store\.findFirst\(\);[\s\S]*?console\.log\(`Tenant criado: \$\{tenant\.id\}`\);\n  \}/, `let client = await prisma.client.findFirst();
  if (!client) {
    client = await prisma.client.create({
      data: {
        nomeCompleto: "Empresa Teste",
        email: "admin@example.com",
      }
    });
  }

  let control = await prisma.control.findFirst();
  if (!control) {
    control = await prisma.control.create({
      data: {
        clientId: client.id,
        nome: "Varejo Teste",
        tipo: "PJ"
      }
    });
  }

  let tenant = await prisma.store.findFirst();
  if (!tenant) {
    tenant = await prisma.store.create({
      data: {
        controlId: control.id,
        nomeFantasia: "Empresa Teste",
        cnpjCpf: "00000000000100"
      }
    });
    console.log(\`Tenant criado: \$\{tenant.id\}\`);
  }`);

code = code.replace(/storeId: tenant\.id/, `storeAccess: {
        create: {
          storeId: tenant.id,
          role: "GERENTE"
        }
      }`);

fs.writeFileSync(path, code);
