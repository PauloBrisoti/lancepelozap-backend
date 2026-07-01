import { prisma } from './lib/prisma';

async function run() {
  const superUser = await prisma.user.findFirst({
    where: { email: 'super@lancepelozap.com.br' }
  });
  console.log("Super User:", superUser);
}
run().catch(console.error);
