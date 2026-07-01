import fs from 'fs';

const filePath = '/Users/paulobarbosa/Projetos/backend/src/controllers/SubscriptionController.ts';
let code = fs.readFileSync(filePath, 'utf8');

code = code.replace(/tenant: true/, `client: true`);

code = code.replace(/const storeId = req\.user\?\.storeId as string;([\s\S]*?)if \(!storeId\)/g, `const clientId = (req.user as any)?.clientId as string;
$1if (!clientId)`);

code = code.replace(/where: \{ storeId \}/g, `where: { clientId }`);

code = code.replace(/storeId,[\s\n]*plano,[\s\n]*valorMensalidade:/g, `clientId,
          planId: plano,
          valorMensalidade:`);

code = code.replace(/where: \{ storeId: id \}/g, `where: { clientId: id }`);

fs.writeFileSync(filePath, code);
