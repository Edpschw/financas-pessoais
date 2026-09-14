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
Cobre: XIRR, parsing/dedupe de CSV/Excel/PDF, detecção de recorrência, amortização de empréstimos (Price), saldo de contas/fatura, geração de transações recorrentes.

## Estrutura

- `index.html` — shell único da aplicação (todas as abas/telas).
- `js/app.js` — bootstrap e orquestração geral.
- `js/storage.js` — camada de persistência (`localStorage`).
- `js/accounts.js` — contas, saldo, fatura de cartão de crédito.
- `js/loans.js` — empréstimos/financiamentos, amortização Price.
- `js/recurring.js` — contas fixas / geração automática de transações mensais.
- `js/csv-import.js`, `js/ofx-import.js`, `js/excel-import.js`, `js/pdf-import.js` — importação de extratos. CSV/Excel compartilham `guessMapping`/`rowsToTransactions` (detectam colunas de tipo/categoria/conta automaticamente, além de data/descrição/valor); PDF usa um parser de linha próprio (`DD/MM/YYYY DESCRIÇÃO VALOR`, valor já assinado) tunado para o layout de extrato do Itaú — linhas que começam com data mas não batem o padrão completo viram avisos em vez de travar o arquivo. `parseBrazilianAmount`/`normalizeDateToISO` (em `csv-import.js`) são compartilhados por todos os formatos.
- `js/auto-import.js` — importação automática a partir de uma pasta escolhida pelo usuário (File System Access API: `showDirectoryPicker`, só Chromium). Guarda o handle da pasta no IndexedDB; ledger de arquivos já processados (inclusive os manuais e os "não suportados") fica em `Store.importedFiles`. Reconhece `.csv/.ofx/.qfx/.xlsx/.xls/.pdf/.json`; imagem (`.jpg/.png/...`) é listada como "não suportado" — decisão deliberada de não fazer OCR (pesado, pouco confiável para foto de recibo).
- `js/json-import.js` — leitura de um backup JSON (mesmo formato de Configurações → Exportar backup) pela pasta automática. **Aditivo**, não confundir com `Store.replaceAll` (botão manual "Importar backup", que substitui tudo): soma transações (pelo pipeline normal de dedupe) e investimentos (`Store.mergeInvestments`, casa por nome pra não duplicar a mesma posição a cada nova leitura do mesmo arquivo) ao que já existe.
- `js/investment-flow.js` — detecta compra/resgate de ativos de investimento no extrato (`isInvestmentMovement`, palavras-chave tipo "compra td", "itaucor resgate" — deliberadamente NÃO inclui proventos/rendimentos recebidos, que são receita de verdade). Lançamentos assim são auto-categorizados como "Investimentos" (em vez de apagados) e ficam de fora das somas de receita/despesa no Dashboard, Análise Mensal e Recorrentes (`isAnalyzableTransaction`) — mas continuam visíveis/editáveis em Transações e na aba Dados. Motivo: comprar/resgatar um investimento é dinheiro mudando de lugar, não gasto nem renda; contar como despesa distorce a análise (ex: uma aplicação grande de uma vez parecendo um "custo recorrente").
- Aba **Dados**: log de importação (auditoria de arquivos, de `Store.importedFiles`) + tabela bruta de todas as transações (sem filtro de mês, com busca) + detector de duplicatas (`findDuplicateGroups` em `utils.js`, mesmo critério de `isDuplicateTransaction` — data/valor/tipo/descrição — mas rodando sobre o que já está salvo, não só no momento da importação). Útil quando o mesmo período é importado de mais de uma fonte (ex: CSV e PDF do mesmo extrato).
- `js/recurring-analysis.js` — detecção de lançamentos recorrentes (`detectRecurringGroups`, agrupa por descrição normalizada + tipo, exige recorrência em >= 3 meses distintos) e heurísticas de economia (`computeSavingsInsights`: assinaturas, tarifas, custo subindo, concentração vs renda). Alimenta a aba Recorrentes, inclusive a sugestão de categorização em lote (cria uma `categoryRule` + atualiza as transações do grupo de uma vez).
- `js/categorize.js` — regras de categorização automática por palavra-chave.
- `js/quotes.js` — cotação automática de investimentos (API pública de mercado).
- `js/advisor.js` — motor de regras da aba "Oportunidades".
- `js/charts.js` — gráficos (Chart.js vendorizado em `js/vendor/`, sem CDN).
- `js/vendor/` — bibliotecas de terceiros vendorizadas (não editar à mão; baixar de novo via `npm pack <pacote>` se precisar atualizar): `chart.umd.js` (Chart.js), `xlsx.full.min.js` (SheetJS, carregado via `<script>` clássico, global `XLSX`), `pdf.min.mjs` + `pdf.worker.min.mjs` (pdf.js, importado como ES module dentro de `pdf-import.js`).
- `js/utils.js` — helpers gerais.
- `tests/*.test.mjs` — um arquivo de teste por módulo de lógica pura. Os parsers de Excel/PDF são testados na parte pura (conversão de linhas já extraídas), não a extração real da biblioteca — isso é verificado manualmente no navegador (bibliotecas vendorizadas dependem de `window`/dynamic import, não rodam no test runner do Node).

## Convenções e restrições do projeto

- **Sem backend, sem telemetria, sem enviar dados a lugar nenhum** — isso é a promessa central do app. Não introduzir chamadas de rede além da cotação pública opcional de investimentos.
- **Sem conta de usuário / sem sync entre dispositivos** — o backup é exportação/importação manual de JSON. Não implementar sincronização servidor-based.
- O PIN de acesso é só uma trava local (hash comparado no login), não criptografia — os dados continuam em texto plano no `localStorage`. Não apresentar isso como segurança forte.
- Fora de escopo deliberado (não implementar a menos que o usuário peça explicitamente e mude a decisão do projeto): Open Finance/integração bancária real, notificações push/e-mail, cálculo completo de IR (DARF/custo médio).
- A importação automática de pasta (`js/auto-import.js`) não é um backend/watcher real — é a File System Access API do próprio navegador, rodando só quando o app está aberto (ao carregar a página, ou no clique de "Verificar agora"). Não existe polling em segundo plano nem processo externo; isso quebraria a promessa de "100% no navegador, sem servidor".
