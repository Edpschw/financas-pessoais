# Finanças Pessoais

App de finanças pessoais 100% client-side: controle de gastos e renda, contas e cartões, empréstimos, investimentos e sugestões de oportunidades — sem backend, sem conta, sem enviar seus dados a lugar nenhum. Tudo fica salvo no `localStorage` do seu navegador.

## Como usar

Como o app usa ES Modules, é preciso servir os arquivos por HTTP (não abrir o `index.html` direto com `file://`):

```bash
python3 -m http.server 8000
# depois acesse http://localhost:8000
```

Ou publique a pasta em qualquer hospedagem estática (GitHub Pages, Netlify, Vercel, etc). É instalável como PWA (manifest + service worker) e funciona offline depois da primeira visita.

## Funcionalidades

- **Dashboard**: receita x despesa (período customizável), patrimônio líquido total (contas + investimentos − dívidas), alocação de carteira, despesas por categoria, saldo por conta e evolução do patrimônio ao longo do tempo.
- **Transações**: lançamento manual, divisão de uma transação em várias categorias, parcelamento (gera N lançamentos mensais automaticamente), importação de extratos **CSV** (com mapeamento de colunas e detecção de duplicatas) e **OFX**, regras de categorização automática por palavra-chave (editáveis), busca/filtros avançados (texto, conta, categoria, faixa de valor), ordenação, paginação, seleção em massa e exportação para CSV.
- **Contas**: contas correntes, poupança, carteira e cartão de crédito, com saldo calculado a partir das transações; transferências entre contas; fatura de cartão de crédito agrupada por ciclo de fechamento.
- **Investimentos**: cadastro por classe de ativo (renda fixa, ações, FIIs, internacional, cripto), múltiplos aportes por ativo, registro de proventos/dividendos, cálculo de rentabilidade anualizada via **XIRR** (mesmo método usado por rastreadores de carteira como Portfolio Performance) e cotação automática opcional (ticker + quantidade) via API pública de mercado.
- **Dívidas**: empréstimos e financiamentos com amortização pelo sistema Price (parcela fixa), saldo devedor projetado e registro de pagamentos.
- **Metas de economia** (piggy banks): valor alvo, data alvo, progresso e sugestão automática de quanto guardar por mês para chegar à meta na data escolhida.
- **Orçamento por categoria** (com rollover opcional do saldo não usado para o mês seguinte) e histórico orçado x realizado; **contas fixas** com alerta de vencimento e geração automática opcional da transação todo mês.
- **Oportunidades**: motor de regras que aponta reserva de emergência baixa/excessiva, concentração de risco, desvio do seu perfil de investidor, contas a vencer, orçamento estourado, sobra mensal disponível para investir, fatura de cartão alta em relação à renda, comprometimento de renda com parcelas de empréstimos e proventos recebidos no mês.
- **Calculadora de independência financeira (FIRE)**: número-alvo de patrimônio, progresso e tempo estimado, com taxa de retirada e retorno esperado configuráveis.
- **Segurança/UX**: bloqueio opcional por PIN (hash local, não é criptografia dos dados), tema claro/escuro/automático, exclusões com "desfazer", app instalável e utilizável offline (PWA).

## Rodando os testes

```bash
npm test
```

Cobre a lógica pura (sem DOM): XIRR, parsing de CSV/detecção de duplicatas, amortização de empréstimos, saldo de contas/fatura de cartão e geração de transações recorrentes.

## O que foi deliberadamente deixado de fora

Alguns pedidos comuns de app de finanças exigem um backend ou trocam a promessa central do projeto (rodar 100% no seu navegador, sem enviar dados a lugar nenhum) — por isso não foram implementados:

- **Open Finance / integração com banco ou corretora**: exigiria credenciais OAuth e um servidor para intermediar a conexão. A "cotação automática" de investimentos é diferente: é uma consulta pública de preço de mercado, sem vincular nenhuma conta.
- **Notificações por e-mail/push de contas a vencer**: push real exige um servidor de notificações; o que existe é o alerta dentro do app (aba Oportunidades/Dashboard) quando ele está aberto.
- **Sincronização entre dispositivos/múltiplos usuários**: sem servidor não há como sincronizar. O caminho continua sendo exportar/importar o backup JSON manualmente.
- **Cálculo completo de imposto de renda (DARF, custo médio para IR)**: as regras variam e são complexas demais para uma estimativa confiável; o app mostra rentabilidade e ganho, mas não gera nada para declaração.
- **Criptografia forte dos dados salvos**: o PIN é só uma trava de acesso simples (hash local comparado no login); os dados continuam em texto plano no `localStorage`, como antes.

## Inspiração

Ideias e boas práticas adaptadas de projetos open-source de referência:
[Firefly III](https://github.com/firefly-iii/firefly-iii) (regras de categorização, contas fixas, metas de poupança, contas e cartões),
[Ghostfolio](https://github.com/ghostfolio/ghostfolio) (calculadora FIRE, alertas de carteira) e
[Portfolio Performance](https://github.com/portfolio-performance/portfolio) / [Paisa](https://github.com/ananthakumaran/paisa) (rentabilidade via XIRR).

## Privacidade

Não há backend, não há telemetria e não há integração com bancos/corretoras (a cotação automática, quando usada, é uma consulta pública de preço, opcional). Todos os dados ficam no `localStorage` do navegador — use **Configurações → Exportar backup (JSON)** regularmente para não perder seus dados.
