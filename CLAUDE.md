# Finanças Pessoais

Visualizador de finanças pessoais 100% client-side. **O app não tem formulários**: ele lê uma pasta do computador (extratos em CSV/OFX/Excel/PDF e backup JSON) e mostra três telas. Toda vez que abre, relê a pasta e incorpora o que for novo. Nada sai do navegador, além da cotação/benchmark pública opcional (Selic/CDI, ver `js/rates.js`).

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

1. **Receita e gastos** — dividido entre **Extrato** e **Cartão de crédito** (seletor "Fonte"), cada um com sua própria análise: médias por mês, receita/despesa **por tipo com percentual** (categoria real no extrato, inferida pelo nome do comerciante no cartão — `js/card-category.js`), maiores gastos agrupados por descrição, tabela mês a mês, e uma **avaliação crítica** (meses no vermelho, concentração de gasto recorrente, "Outros" dominante, tendência de poupança/gasto, volatilidade de receita — `js/cashflow-insight.js`).
2. **Investimentos** — total, proventos recebidos (identificados nos extratos), alocação por classe e a carteira. As posições vêm do PDF de posição consolidada (resumo por classe, e detalhe por produto quando a extração bate com o resumo) ou de um backup JSON na pasta; cada leitura do PDF também vira um ponto datado no **histórico da carteira** (`portfolioSnapshots`). Cada posição é expansível: rentabilidade por período, taxa/vencimento (renda fixa), **previsão de valor futuro** e **avaliação de atratividade** contra Selic/CDI atuais — `js/investment-insight.js` + `js/rates.js`.
3. **Base de dados** — o que foi lido: log por arquivo (encontrados/importados/duplicados/avisos), detector de duplicatas e a tabela bruta de lançamentos com busca e filtros.

## Estrutura

- `index.html` — shell das três telas (sem modais: não há edição).
- `js/app.js` — orquestração e render de tudo.
- `js/storage.js` — cache do que foi lido, no `localStorage`; ledger dos arquivos já processados; série de snapshots da carteira (`portfolioSnapshots`).
- `js/auto-import.js` — varre a pasta (File System Access API: `showDirectoryPicker`, só Chromium), guarda o handle no IndexedDB, despacha para o parser certo e descarta duplicatas.
- `js/csv-import.js` — parser de CSV + utilidades compartilhadas por todos os formatos (`guessMapping`, `rowsToTransactions`, `parseBrazilianAmount`, `normalizeDateToISO`). `parseBrazilianAmount` aceita 1.234,56 e 1,234.56 — planilha de banco mistura os dois.
- `js/excel-import.js` — planilhas. Procura a linha de cabeçalho de verdade (exportação de banco tem um bloco de nome/agência/conta antes da tabela) e reconhece fatura de cartão, onde valor positivo é gasto (inverso do extrato).
- `js/pdf-import.js` — PDF via pdf.js, com dois formatos: **extrato** (`DD/MM/YYYY DESCRIÇÃO VALOR`, pulando "SALDO DO DIA"; linha com data que não bate o padrão vira aviso) e **posição consolidada** (carteira). Na carteira sempre se lê o quadro-resumo por tipo de investimento (bem formado, soma conferida contra o total impresso no PDF); dele também saem o rendimento em R$ no ano, a distribuição por tipo, e a data de referência da posição (procurada em várias formas — "posição em", "data base", período — sobre a linha sem espaços; se não achar, vira aviso e quem chama usa a data de modificação do arquivo). Também se tenta o detalhe por produto individual — nome, rentabilidade por período, taxa/vencimento — reconstruído pela posição X dos tokens (colunas descobertas por seção, não pelo texto do cabeçalho) e pelo vão vertical entre linhas (um produto quebra em várias linhas visuais; o nome pode continuar em linhas *depois* do valor que fecha a posição, então o fim de um produto só é decidido por um vão bem maior que o espaçamento normal de linha, não pelo valor). O detalhe só é usado se a soma das posições bater com o quadro-resumo (rede de segurança); senão, cai de volta pro resumo, sem alarme. A reconstrução de linhas só insere espaço quando há vão horizontal de verdade: esse PDF devolve um item por glifo, e juntar tudo com espaço quebrava até os números.
- `js/ofx-import.js`, `js/json-import.js` — OFX e backup JSON (este é **aditivo**: soma transações e investimentos, não substitui nada).
- `js/investment-flow.js` — separa movimentação de principal (compra/resgate) de provento recebido.
- `js/rates.js` — busca Selic e CDI atuais na API pública do Banco Central (SGS), cacheado 1 dia no `localStorage`. Timeout curto e falha silenciosa (devolve `null`, nunca lança) — é a **única** chamada de rede do app, e só serve de benchmark para a atratividade; sem ela, cai no fallback offline.
- `js/investment-insight.js` — previsão de valor futuro (juros compostos pela taxa contratada, ou retorno de 12 meses projetado) e atratividade (compara com Selic/CDI quando há rede; senão, com a mediana da própria carteira). Sempre com o motivo explícito — nunca só um selo.
- `js/cashflow-insight.js` — avaliação crítica de receita/gastos, só a partir das transações já lidas (sem rede, sem dado novo).
- `js/card-category.js` — categoria aproximada de um item de fatura, inferida por palavra-chave no nome do comerciante (a fatura não traz categoria por item). Best-effort: o que não bate cai em "Outros".
- `js/charts.js` — gráficos; cores lidas dos tokens CSS, então seguem o tema.
- `js/utils.js` — formatadores, datas, dedupe e as categorias que ficam fora do fluxo.
- `css/fonts.css` + `fonts/` — as fontes da identidade visual (Sora, Public Sans, IBM Plex Mono) servidas do próprio projeto. Só os subsets latin e latin-ext; Public Sans e Sora são variáveis, então um arquivo atende todos os pesos. O cabeçalho de `css/fonts.css` explica como atualizar.
- `js/vendor/` — bibliotecas vendorizadas (não editar; rebaixar via `npm pack`): Chart.js, SheetJS (`XLSX` global, carregado por `<script>`) e pdf.js (ES module, importado dentro de `pdf-import.js`).

## Decisões que não são óbvias no código

- **Compra/resgate de investimento não é gasto nem renda** — é dinheiro mudando de lugar. Fica marcado na categoria "Investimentos" e fora das somas da tela 1 (`isCashFlow` em `utils.js`), mas continua visível na Base de dados.
- **Itens de fatura de cartão também ficam fora das somas** (categoria "Fatura cartão"). O extrato já contabiliza a fatura como um pagamento único ("ITAU BLACK ..."); somar os itens junto contaria o mesmo gasto duas vezes. O detalhe existe para consulta na tela 3.
- **Imagem (`.jpg`/`.png`) é reconhecida mas não processada** — OCR de foto de recibo é pesado e pouco confiável. Aparece como "não suportado" no log.
- **A leitura da pasta não é um watcher**: é a File System Access API do próprio navegador, rodando quando o app abre ou no botão "Atualizar". Não existe processo em segundo plano — isso exigiria um servidor, que o projeto não tem.
- **A posição consolidada é uma foto datada, não um valor que se sobrescreve** — cada leitura vira um snapshot em `portfolioSnapshots`, guardado pela data de referência, e a carteira exibida é derivada do snapshot mais recente. Reler o PDF da mesma data substitui aquela foto; outra data entra como ponto novo na série. Sem isso o PDF novo apagava o anterior e não havia como medir progressão. O backup JSON continua aditivo (casa por nome), e as posições que ele traz sobrevivem ao snapshot.
- **Nenhum percentual de rentabilidade é derivado do rendimento do PDF** — com aporte no meio do ano, rendimento dividido por valor atual não é retorno. O R$ aparece como veio; a variação do patrimônio entre snapshots é rotulada como variação, não rentabilidade.
- **Nenhum recurso vem de CDN, nem fonte** — o `<link>` para o Google Fonts entregava IP e referer a um terceiro a cada abertura e deixava a primeira visita sem rede com a fonte de fallback. Fonte nova entra em `fonts/`, nunca por URL externa.
- **Nada é digitado à mão.** Se faltou um dado, a resposta é colocar o arquivo na pasta, não criar um formulário.

## Restrições do projeto

- Sem backend, sem telemetria, sem enviar dados para lugar nenhum.
- Sem conta de usuário e sem sincronização entre dispositivos.
- Fora de escopo deliberado: Open Finance/integração bancária, notificações push, cálculo de IR.
