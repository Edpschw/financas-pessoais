# Finanças Pessoais

App de finanças pessoais 100% client-side: controle de gastos e renda, acompanhamento de investimentos e sugestões de oportunidades — sem backend, sem conta, sem enviar seus dados a lugar nenhum. Tudo fica salvo no `localStorage` do seu navegador.

## Como usar

Como o app usa ES Modules, é preciso servir os arquivos por HTTP (não abrir o `index.html` direto com `file://`):

```bash
python3 -m http.server 8000
# depois acesse http://localhost:8000
```

Ou publique a pasta em qualquer hospedagem estática (GitHub Pages, Netlify, Vercel, etc).

## Funcionalidades

- **Dashboard**: receita x despesa por mês, patrimônio investido, alocação de carteira, despesas por categoria e evolução do patrimônio ao longo do tempo.
- **Transações**: lançamento manual, importação de extratos **CSV** (com mapeamento de colunas) e **OFX**, e **regras de categorização automática** por palavra-chave.
- **Investimentos**: cadastro por classe de ativo (renda fixa, ações, FIIs, internacional, cripto), múltiplos aportes por ativo e cálculo de rentabilidade anualizada via **XIRR** (mesmo método usado por rastreadores de carteira como Portfolio Performance).
- **Metas de economia** (piggy banks): valor alvo, data alvo e progresso.
- **Orçamento por categoria** e **contas fixas** com alerta de vencimento.
- **Oportunidades**: motor de regras que aponta reserva de emergência baixa/excessiva, concentração de risco, desvio do seu perfil de investidor, contas a vencer, orçamento estourado e sobra mensal disponível para investir.
- **Calculadora de independência financeira (FIRE)**: número-alvo de patrimônio, progresso e tempo estimado, com taxa de retirada e retorno esperado configuráveis.

## Inspiração

Ideias e boas práticas adaptadas de projetos open-source de referência:
[Firefly III](https://github.com/firefly-iii/firefly-iii) (regras de categorização, contas fixas, metas de poupança),
[Ghostfolio](https://github.com/ghostfolio/ghostfolio) (calculadora FIRE, alertas de carteira) e
[Portfolio Performance](https://github.com/portfolio-performance/portfolio) / [Paisa](https://github.com/ananthakumaran/paisa) (rentabilidade via XIRR).

## Privacidade

Não há backend, não há telemetria e não há integração com bancos/corretoras. Todos os dados ficam no `localStorage` do navegador — use **Configurações → Exportar backup (JSON)** regularmente para não perder seus dados.
