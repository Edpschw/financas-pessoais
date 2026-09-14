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

Precisa de um navegador baseado em Chromium (Chrome, Edge, Brave) — a API que lê pastas locais só existe neles. Nenhuma dependência é baixada de CDN: Chart.js, SheetJS e pdf.js vêm embutidos em `js/vendor/`, então o app funciona offline desde a primeira visita.

## O que ele lê

| Formato | O que é |
|---|---|
| `.csv` | Extrato exportado do banco. Detecta sozinho as colunas de data, descrição, valor, tipo, categoria e conta. |
| `.pdf` | Extrato do banco (layout do Itaú validado). Linhas que não dá para interpretar viram aviso, sem travar o arquivo. |
| `.xlsx` / `.xls` | Planilha de extrato ou **fatura de cartão** (acha a tabela mesmo quando há um bloco com nome/agência/conta antes). |
| `.ofx` / `.qfx` | Extrato no padrão OFX. |
| `.json` | Backup exportado pelo próprio app — soma transações e investimentos ao que já existe. |
| `.jpg` / `.png` | Reconhecido, mas não processado (precisaria de OCR). |

O mesmo lançamento vindo de dois arquivos (por exemplo o CSV e o PDF do mesmo mês) é importado uma vez só.

## As três telas

- **Receita e gastos** — quanto entra e quanto sai por mês, gastos por categoria, os maiores gastos do período e a tabela mês a mês.
- **Investimentos** — carteira, alocação por classe e os proventos que caíram na conta.
- **Base de dados** — o que foi lido de cada arquivo, possíveis duplicatas e todos os lançamentos, com busca e filtros.

## Duas contas que o app não soma (de propósito)

- **Compra e resgate de investimento**: é dinheiro mudando de lugar, não gasto nem renda. Uma aplicação de R$ 60 mil não deve aparecer como "despesa do mês".
- **Itens da fatura do cartão**: o extrato já cobra a fatura como um pagamento único. Contar os itens junto somaria o mesmo gasto duas vezes — o detalhe fica disponível na Base de dados.

## Privacidade

Não há backend, telemetria nem integração com bancos. Os dados ficam no `localStorage` do seu navegador e os arquivos nunca saem da sua máquina.

## Rodando os testes

```bash
npm test
```

## Inspiração

Ideias adaptadas de projetos open-source de referência: [Firefly III](https://github.com/firefly-iii/firefly-iii), [Ghostfolio](https://github.com/ghostfolio/ghostfolio) e [Portfolio Performance](https://github.com/portfolio-performance/portfolio).
