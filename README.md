# Finanças Pessoais

Visualizador de finanças pessoais que lê uma pasta do seu computador — os extratos que você já baixa do banco — e mostra para onde o dinheiro foi. Sem backend, sem conta, sem digitar lançamento: tudo fica no seu navegador.

Toda vez que o app abre, ele relê a pasta e incorpora os arquivos novos.

## Como usar

```bash
python3 dev-server.py 8000
# depois acesse http://localhost:8000
```

Na primeira vez, clique em **Escolher pasta** e aponte para onde você salva os extratos. O navegador pede permissão de leitura uma vez; depois disso o app lê sozinho a cada abertura.

> Use o `dev-server.py` (e não `python3 -m http.server`): ele manda `Cache-Control: no-store`. Sem isso o navegador guarda uma versão antiga do app e você pode acabar vendo uma tela em branco depois de uma atualização.

Precisa de um navegador baseado em Chromium (Chrome, Edge, Brave) — a API que lê pastas locais só existe neles. Nenhuma dependência é baixada de CDN: Chart.js, SheetJS e pdf.js vêm embutidos em `js/vendor/`, e as fontes em `fonts/`, então o app funciona offline desde a primeira visita e não faz uma única requisição para fora.

## O que ele lê

| Formato | O que é |
|---|---|
| `.csv` | Extrato exportado do banco. Detecta sozinho as colunas de data, descrição, valor, tipo, categoria e conta. |
| `.pdf` | Extrato do banco **ou** a posição consolidada da carteira (layout do Itaú validado). Linhas que não dá para interpretar viram aviso, sem travar o arquivo. |
| `.xlsx` / `.xls` | Planilha de extrato ou **fatura de cartão** (acha a tabela mesmo quando há um bloco com nome/agência/conta antes). |
| `.ofx` / `.qfx` | Extrato no padrão OFX. |
| `.json` | Backup exportado pelo próprio app — soma transações e investimentos ao que já existe. |
| `.jpg` / `.png` | Reconhecido, mas não processado (precisaria de OCR). |

O mesmo lançamento vindo de dois arquivos (por exemplo o CSV e o PDF do mesmo mês) é importado uma vez só.

## As três telas

- **Receita e gastos** — dividido em Extrato e Cartão de crédito. Quanto entra e quanto sai por mês, receita/despesa por tipo com percentual (no cartão, categoria aproximada pelo nome do comerciante), os maiores gastos do período, a tabela mês a mês e uma avaliação crítica (meses no vermelho, gasto recorrente concentrado, categorização fraca, tendência de poupança/gasto, receita irregular).
- **Investimentos** — carteira, alocação por classe, o rendimento do ano informado no PDF e os proventos que caíram na conta. As posições vêm do PDF de posição consolidada ou de um backup JSON. Cada posição consolidada lida vira um ponto no **histórico da carteira**, com a variação do patrimônio entre as datas (variação, não rentabilidade: aportes e resgates entram nela). Clique numa posição para ver rentabilidade por período, previsão de valor futuro e uma avaliação de atratividade comparada à Selic/CDI atuais.
- **Base de dados** — o que foi lido de cada arquivo, possíveis duplicatas e todos os lançamentos, com busca e filtros.

## Sobre a avaliação de atratividade

Pra comparar um investimento com "o mercado", o app busca a Selic e o CDI atuais na API pública do Banco Central — a única informação que sai do seu navegador, e só isso: nenhum dado seu é enviado. Sem internet, a avaliação cai para comparar o investimento com a própria carteira, e o app deixa isso visível em vez de fingir que é a mesma coisa.

## Duas contas que o app não soma (de propósito)

- **Compra e resgate de investimento**: é dinheiro mudando de lugar, não gasto nem renda. Uma aplicação de R$ 60 mil não deve aparecer como "despesa do mês".
- **Itens da fatura do cartão**: o extrato já cobra a fatura como um pagamento único. Contar os itens junto somaria o mesmo gasto duas vezes — o detalhe fica disponível na Base de dados.

## Privacidade

Não há backend, telemetria nem integração com bancos. Os dados ficam no `localStorage` do seu navegador e os arquivos nunca saem da sua máquina — a única exceção é uma consulta pública e opcional à Selic/CDI (Banco Central) para avaliar investimentos, que não envia nenhum dado seu, só busca a taxa do dia.

## Rodando os testes

```bash
npm test
```

## Inspiração

Ideias adaptadas de projetos open-source de referência: [Firefly III](https://github.com/firefly-iii/firefly-iii), [Ghostfolio](https://github.com/ghostfolio/ghostfolio) e [Portfolio Performance](https://github.com/portfolio-performance/portfolio).
