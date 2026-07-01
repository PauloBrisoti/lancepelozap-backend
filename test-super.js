const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();

async function run() {
  const user = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
  if (!user) return console.log('No SUPER_ADMIN found');

  const token = jwt.sign(
    { id: user.id, tenantId: user.tenantId, role: user.role },
    process.env.JWT_SECRET || 'supersecretkey',
    { expiresIn: "7d" }
  );

  console.log("TOKEN:", token);

  const res = await fetch('http://localhost:3001/api/super-admin/tenants', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `authToken=${token}`
    },
    body: JSON.stringify({
      nomeFantasia: 'Teste Loja API',
      nomeResponsavel: 'Admin Teste',
      emailResponsavel: 'teste.api@gmail.com',
      senhaResponsavel: '12345'
    })
  });
  
  const data = await res.json();
  console.log("STATUS:", res.status);
  console.log("RESPONSE:", data);
}

require('dotenv').config();
run().catch(console.error).finally(() => prisma.$disconnect());
