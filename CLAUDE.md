# Finanças Pessoais

App de finanças pessoais 100% client-side (sem backend, sem build step). Controle de gastos/renda, contas e cartões, empréstimos, investimentos, orçamento, metas e um motor de sugestões ("Oportunidades"). Tudo persiste no `localStorage` do navegador.

## Stack

- HTML + CSS + JavaScript puro, via ES Modules (`type="module"`).
- Sem framework, sem bundler, sem transpiler.
- PWA: `manifest.json` + `sw.js` (instalável, funciona offline após a 1ª visita).
- Testes: test runner nativo do Node (`node --test`), só lógica pura (sem DOM).

## Rodando

```bash
python3 -m http.server 8000
```
Precisa ser servido por HTTP — ES Modules não funcionam com `file://`.

## Testes

```bash
npm test
```
Cobre: XIRR, parsing/dedupe de CSV, amortização de empréstimos (Price), saldo de contas/fatura, geração de transações recorrentes.

## Estrutura

- `index.html` — shell único da aplicação (todas as abas/telas).
- `js/app.js` — bootstrap e orquestração geral.
- `js/storage.js` — camada de persistência (`localStorage`).
- `js/accounts.js` — contas, saldo, fatura de cartão de crédito.
- `js/loans.js` — empréstimos/financiamentos, amortização Price.
- `js/recurring.js` — contas fixas / geração automática de transações mensais.
- `js/csv-import.js`, `js/ofx-import.js` — importação de extratos (CSV detecta colunas de tipo/categoria/conta automaticamente, além de data/descrição/valor).
- `js/auto-import.js` — importação automática a partir de uma pasta escolhida pelo usuário (File System Access API: `showDirectoryPicker`, só Chromium). Guarda o handle da pasta no IndexedDB; ledger de arquivos já importados fica em `Store.importedFiles`.
- `js/categorize.js` — regras de categorização automática por palavra-chave.
- `js/quotes.js` — cotação automática de investimentos (API pública de mercado).
- `js/advisor.js` — motor de regras da aba "Oportunidades".
- `js/charts.js` — gráficos do dashboard.
- `js/utils.js` — helpers gerais.
- `tests/*.test.mjs` — um arquivo de teste por módulo de lógica pura.

## Convenções e restrições do projeto

- **Sem backend, sem telemetria, sem enviar dados a lugar nenhum** — isso é a promessa central do app. Não introduzir chamadas de rede além da cotação pública opcional de investimentos.
- **Sem conta de usuário / sem sync entre dispositivos** — o backup é exportação/importação manual de JSON. Não implementar sincronização servidor-based.
- O PIN de acesso é só uma trava local (hash comparado no login), não criptografia — os dados continuam em texto plano no `localStorage`. Não apresentar isso como segurança forte.
- Fora de escopo deliberado (não implementar a menos que o usuário peça explicitamente e mude a decisão do projeto): Open Finance/integração bancária real, notificações push/e-mail, cálculo completo de IR (DARF/custo médio).
- A importação automática de pasta (`js/auto-import.js`) não é um backend/watcher real — é a File System Access API do próprio navegador, rodando só quando o app está aberto (ao carregar a página, ou no clique de "Verificar agora"). Não existe polling em segundo plano nem processo externo; isso quebraria a promessa de "100% no navegador, sem servidor".
