# 💼 Lance Pelo Zap — Backend Core & Financial Engine

API corporativa para plataforma SaaS de controle financeiro e gestão operacional, projetada para atender operações multiloja com alto rigor contábil e consistência transacional.

---

## 🛠️ Stack Tecnológica & Arquitetura

* **Runtime & Linguagem:** Node.js, TypeScript
* **Framework Web:** Express.js com arquitetura modular (Controllers, Services, Middlewares)
* **ORM & Banco de Dados:** Prisma ORM com PostgreSQL
* **Cache & Segurança:** Redis (Rate Limiting distribuído, proteção anti-brute force)
* **Deploy & Processos:** PM2, Nginx Reverse Proxy, Ubuntu LTS

---

## 📊 Principais Engenhos & Regras de Negócio

* **Motor de DRE Automatizada (Regime de Competência):**
  * Apuração em tempo real de Receita Bruta, Deduções e Receita Líquida.
  * Cálculo dinâmico de Custo de Mercadorias Vendidas (CMV) ponderado por venda.
  * Dedução de despesas operacionais categorizadas com isolamento de aportes e retiradas.
  * Tratamento estrito de bordas para margens operacionais e crescimento percentual base-zero.

* **Tesouraria e Projeção de Liquidez (Regime de Caixa):**
  * Conciliação de caixa multiformas (PIX, Cartão, Dinheiro, Crediário).
  * Saldo Projetado integrando contas a pagar e a receber.
  * Apuração de dias de atraso e índice de inadimplência.
