import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { RBAC_MODULES } from '../lib/rbacModules';

const routesSource = readFileSync(join(__dirname, '..', 'routes', 'super-admin.routes.ts'), 'utf-8');

const usedModules = [...routesSource.matchAll(/requireInternalPermission\('([A-Z_]+)'/g)]
  .map(m => m[1]);
const canonical = [...RBAC_MODULES];

describe('Cobertura RBAC de módulos', () => {
  it('nenhum módulo da matriz é fantasma (protege ao menos 1 rota)', () => {
    const ghosts = canonical.filter(m => !usedModules.includes(m));
    expect(ghosts).toEqual([]);
  });

  it('nenhuma rota usa módulo fora da matriz canônica', () => {
    const orphans = usedModules.filter(m => !canonical.includes(m));
    expect(orphans).toEqual([]);
  });

  it('a matriz canônica tem todos os módulos ativos (sem órfãos vazios)', () => {
    expect(canonical.length).toBeGreaterThanOrEqual(1);
    expect(new Set(canonical).size).toBe(canonical.length);
  });
});
