import fs from 'fs';
const path = '/Users/paulobarbosa/Projetos/backend/src/controllers/SuperAdminController.ts';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(/nomeMovel: 'Varejo e Estoque',\n\s*tipoSistema: 'VAREJO'/g, `nome: 'Varejo e Estoque',
            tipo: 'PJ'`);

fs.writeFileSync(path, code);
