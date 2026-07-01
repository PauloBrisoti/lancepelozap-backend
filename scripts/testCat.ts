import { prisma } from '../src/lib/prisma';
import { CategoryController } from '../src/controllers/CategoryController';

async function test() {
  const user = await prisma.user.findFirst();
  if (!user) throw new Error("No user");

  const req = {
    user: { tenantId: user.tenantId },
    body: { nome: 'Teste', corHexadecimal: '#000000' }
  } as any;

  const res = {
    status: (s: number) => ({
      json: (j: any) => console.log('Status', s, 'JSON', j),
      send: () => console.log('Status', s, 'Send')
    }),
    json: (j: any) => console.log('JSON', j)
  } as any;

  const controller = new CategoryController();
  await controller.create(req, res);
}

test().catch(console.error);
