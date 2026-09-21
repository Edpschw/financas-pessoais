# Finanças Pessoais

Visualizador de finanças pessoais 100% client-side. **O app não tem formulários**: ele lê uma pasta do computador (extratos em CSV/OFX/Excel/PDF e backup JSON) e mostra três telas. Toda vez que abre, relê a pasta e incorpora o que for novo. Nada sai do navegador.

## Stack

- HTML + CSS + JavaScript puro, ES Modules. Sem framework, bundler ou build step.
- PWA: `manifest.json` + `sw.js` (funciona offline depois da 1ª visita).
- Testes: runner nativo do Node (`node --test`), só lógica pura (sem DOM).

## Rodando

```bash
python3 dev-server.py 8000
```
`dev-server.py` é `http.server` + `Cache-Control: no-store`. **Use ele, não o `http.server` direto**: sem esse cabeçalho o navegador aplica cache heurístico e continua servindo a versão antiga do app depois de uma alteração (sintoma: tela em branco ou erro de módulo que "não existe"). Precisa ser HTTP — ES Modules não funcionam com `file://`.

## Testes

```bash
npm test
```

## As três telas

1. **Receita e gastos** — médias por mês, receita × despesa (6/12/24 meses), gastos por categoria, maiores gastos agrupados por descrição, tabela mês a mês com acumulado.
2. **Investimentos** — total, proventos recebidos (identificados nos extratos), alocação por classe e a carteira. As posições vêm do PDF de posição consolidada ou de um backup JSON na pasta.
3. **Base de dados** — o que foi lido: log por arquivo (encontrados/importados/duplicados/avisos), detector de duplicatas e a tabela bruta de lançamentos com busca e filtros.

## Estrutura

- `index.html` — shell das três telas (sem modais: não há edição).
- `js/app.js` — orquestração e render de tudo.
- `js/storage.js` — cache do que foi lido, no `localStorage`; ledger dos arquivos já processados.
- `js/auto-import.js` — varre a pasta (File System Access API: `showDirectoryPicker`, só Chromium), guarda o handle no IndexedDB, despacha para o parser certo e descarta duplicatas.
- `js/csv-import.js` — parser de CSV + utilidades compartilhadas por todos os formatos (`guessMapping`, `rowsToTransactions`, `parseBrazilianAmount`, `normalizeDateToISO`). `parseBrazilianAmount` aceita 1.234,56 e 1,234.56 — planilha de banco mistura os dois.
- `js/excel-import.js` — planilhas. Procura a linha de cabeçalho de verdade (exportação de banco tem um bloco de nome/agência/conta antes da tabela) e reconhece fatura de cartão, onde valor positivo é gasto (inverso do extrato).
- `js/pdf-import.js` — PDF via pdf.js, com dois formatos: **extrato** (`DD/MM/YYYY DESCRIÇÃO VALOR`, pulando "SALDO DO DIA"; linha com data que não bate o padrão vira aviso) e **posição consolidada** (carteira). Na carteira, a tabela por produto não sobrevive à reconstrução de linhas — nome e colunas se misturam —, então é lido o quadro-resumo por tipo de investimento, que é bem formado, e a soma é conferida contra o total impresso no PDF (divergência vira aviso). A reconstrução de linhas só insere espaço quando há vão horizontal de verdade: esse PDF devolve um item por glifo, e juntar tudo com espaço quebrava até os números.
- `js/ofx-import.js`, `js/json-import.js` — OFX e backup JSON (este é **aditivo**: soma transações e investimentos, não substitui nada).
- `js/investment-flow.js` — separa movimentação de principal (compra/resgate) de provento recebido.
- `js/charts.js` — gráficos; cores lidas dos tokens CSS, então seguem o tema.
- `js/utils.js` — formatadores, datas, dedupe e as categorias que ficam fora do fluxo.
- `css/fonts.css` + `fonts/` — as fontes da identidade visual (Sora, Public Sans, IBM Plex Mono) servidas do próprio projeto. Só os subsets latin e latin-ext; Public Sans e Sora são variáveis, então um arquivo atende todos os pesos. O cabeçalho de `css/fonts.css` explica como atualizar.
- `js/vendor/` — bibliotecas vendorizadas (não editar; rebaixar via `npm pack`): Chart.js, SheetJS (`XLSX` global, carregado por `<script>`) e pdf.js (ES module, importado dentro de `pdf-import.js`).

## Decisões que não são óbvias no código

- **Compra/resgate de investimento não é gasto nem renda** — é dinheiro mudando de lugar. Fica marcado na categoria "Investimentos" e fora das somas da tela 1 (`isCashFlow` em `utils.js`), mas continua visível na Base de dados.
- **Itens de fatura de cartão também ficam fora das somas** (categoria "Fatura cartão"). O extrato já contabiliza a fatura como um pagamento único ("ITAU BLACK ..."); somar os itens junto contaria o mesmo gasto duas vezes. O detalhe existe para consulta na tela 3.
- **Imagem (`.jpg`/`.png`) é reconhecida mas não processada** — OCR de foto de recibo é pesado e pouco confiável. Aparece como "não suportado" no log.
- **A leitura da pasta não é um watcher**: é a File System Access API do próprio navegador, rodando quando o app abre ou no botão "Atualizar". Não existe processo em segundo plano — isso exigiria um servidor, que o projeto não tem.
- **Nenhum recurso vem de CDN, nem fonte** — o `<link>` para o Google Fonts entregava IP e referer a um terceiro a cada abertura e deixava a primeira visita sem rede com a fonte de fallback. Fonte nova entra em `fonts/`, nunca por URL externa.
- **Nada é digitado à mão.** Se faltou um dado, a resposta é colocar o arquivo na pasta, não criar um formulário.

## Restrições do projeto

- Sem backend, sem telemetria, sem enviar dados para lugar nenhum.
- Sem conta de usuário e sem sincronização entre dispositivos.
- Fora de escopo deliberado: Open Finance/integração bancária, notificações push, cálculo de IR.
