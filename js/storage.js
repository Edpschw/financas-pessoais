const STORAGE_KEY = "financas-pessoais:v1";

const DEFAULT_EXPENSE_CATEGORIES = [
  "Moradia", "Alimentação", "Transporte", "Saúde", "Educação",
  "Lazer", "Compras", "Assinaturas", "Impostos", "Outros"
];

const DEFAULT_INCOME_CATEGORIES = ["Salário", "Freelance", "Rendimentos", "Outros"];

const ACCOUNT_TYPES = ["corrente", "poupanca", "carteira", "cartao_credito"];

function defaultState() {
  return {
    transactions: [],
    accounts: [],
    investments: [],
    loans: [],
    budgets: [],
    goals: [],
    bills: [],
    categoryRules: [],
    netWorthHistory: [],
    settings: {
      riskProfile: "moderado",
      emergencyMonths: 6,
      expenseCategories: DEFAULT_EXPENSE_CATEGORIES.slice(),
      incomeCategories: DEFAULT_INCOME_CATEGORIES.slice(),
      fireWithdrawalRate: 4,
      fireExpectedReturn: 6,
      theme: "system",
      pinHash: null,
    },
  };
}

// Investimentos antigos guardavam um único par {invested, date}. A partir da versão
// com XIRR, cada investimento tem uma lista de aportes (contributions), o que permite
// calcular rentabilidade anualizada real (Portfolio Performance / Paisa usam a mesma ideia).
function migrateInvestment(inv) {
  let out = inv;
  if (!Array.isArray(inv.contributions) || inv.contributions.length === 0) {
    const amount = typeof inv.invested === "number" ? inv.invested : 0;
    const date = inv.date || new Date().toISOString().slice(0, 10);
    out = { ...out, contributions: [{ date, amount }] };
  }
  if (!Array.isArray(out.proceeds)) out = { ...out, proceeds: [] };
  return out;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Versões antigas guardavam a conta como texto livre (campo `account`). Ao detectar
// uma versão sem a lista `accounts`, criamos uma conta por nome distinto encontrado
// nas transações, preservando o texto original como fallback de exibição.
function migrateAccounts(parsed, transactions) {
  if (Array.isArray(parsed.accounts)) {
    return { accounts: parsed.accounts, transactions };
  }
  const accounts = [];
  const byName = new Map();
  const migratedTx = transactions.map((t) => {
    if (t.accountId) return t;
    const name = (t.account || "").trim();
    if (!name) return t;
    const key = name.toLowerCase();
    let acc = byName.get(key);
    if (!acc) {
      acc = { id: genId(), name, type: "corrente", initialBalance: 0 };
      byName.set(key, acc);
      accounts.push(acc);
    }
    return { ...t, accountId: acc.id };
  });
  return { accounts, transactions: migratedTx };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const base = defaultState();
    const rawTransactions = (parsed.transactions || base.transactions).map((t) => ({ type: "expense", ...t }));
    const { accounts, transactions } = migrateAccounts(parsed, rawTransactions);
    return {
      transactions,
      accounts,
      investments: (parsed.investments || base.investments).map(migrateInvestment),
      loans: parsed.loans || base.loans,
      budgets: parsed.budgets || base.budgets,
      goals: parsed.goals || base.goals,
      bills: parsed.bills || base.bills,
      categoryRules: parsed.categoryRules || base.categoryRules,
      netWorthHistory: parsed.netWorthHistory || base.netWorthHistory,
      settings: { ...base.settings, ...(parsed.settings || {}) },
    };
  } catch (err) {
    console.error("Falha ao carregar dados, usando estado padrão.", err);
    return defaultState();
  }
}

let state = load();
const listeners = new Set();

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

function snapshotNetWorth() {
  const investedNetWorth = state.investments.reduce((s, i) => s + (i.currentValue || 0), 0);
  const month = currentMonthKey();
  const i = state.netWorthHistory.findIndex((h) => h.month === month);
  if (i >= 0) state.netWorthHistory[i].netWorth = investedNetWorth;
  else state.netWorthHistory.push({ month, netWorth: investedNetWorth });
}

function save() {
  snapshotNetWorth();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  listeners.forEach((fn) => fn(state));
}

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function investedTotal(inv) {
  return (inv.contributions || []).reduce((s, c) => s + c.amount, 0);
}

export function proceedsTotal(inv) {
  return (inv.proceeds || []).reduce((s, p) => s + p.amount, 0);
}

export { ACCOUNT_TYPES };

export const Store = {
  get() { return state; },
  onChange,

  addTransaction(tx) {
    const id = genId();
    state.transactions.push({ id, ...tx });
    save();
    return id;
  },
  updateTransaction(id, patch) {
    const i = state.transactions.findIndex((t) => t.id === id);
    if (i >= 0) { state.transactions[i] = { ...state.transactions[i], ...patch }; save(); }
  },
  removeTransaction(id) {
    state.transactions = state.transactions.filter((t) => t.id !== id);
    save();
  },
  removeTransactions(ids) {
    const set = new Set(ids);
    state.transactions = state.transactions.filter((t) => !set.has(t.id));
    save();
  },
  addTransactions(list) {
    list.forEach((tx) => state.transactions.push({ id: genId(), ...tx }));
    save();
  },

  // Transferência entre contas: uma única transação com accountId (origem) e
  // toAccountId (destino), não entra nas somas de receita/despesa do dashboard.
  addTransfer({ date, description, fromAccountId, toAccountId, amount }) {
    state.transactions.push({
      id: genId(), type: "transfer", date, description: description || "Transferência",
      category: "Transferência", accountId: fromAccountId, toAccountId, amount,
    });
    save();
  },

  // Parcelamento: divide o valor total em N transações mensais ligadas por installmentGroup.
  addInstallmentTransactions(base, installments) {
    const total = Math.round(base.amount * 100);
    const per = Math.floor(total / installments);
    const remainder = total - per * installments;
    const group = genId();
    const [y, m, d] = base.date.split("-").map(Number);
    for (let i = 0; i < installments; i++) {
      const dt = new Date(y, m - 1 + i, d);
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      const cents = per + (i === installments - 1 ? remainder : 0);
      state.transactions.push({
        id: genId(), ...base, date: dateStr, amount: cents / 100,
        installmentGroup: group, installmentIndex: i + 1, installmentTotal: installments,
      });
    }
    save();
  },

  addAccount(acc) {
    const id = genId();
    state.accounts.push({ id, initialBalance: 0, ...acc });
    save();
    return id;
  },
  updateAccount(id, patch) {
    const i = state.accounts.findIndex((a) => a.id === id);
    if (i >= 0) { state.accounts[i] = { ...state.accounts[i], ...patch }; save(); }
  },
  removeAccount(id) {
    state.accounts = state.accounts.filter((a) => a.id !== id);
    save();
  },

  addLoan(loan) {
    const id = genId();
    state.loans.push({ id, paidInstallments: 0, ...loan });
    save();
    return id;
  },
  updateLoan(id, patch) {
    const i = state.loans.findIndex((l) => l.id === id);
    if (i >= 0) { state.loans[i] = { ...state.loans[i], ...patch }; save(); }
  },
  removeLoan(id) {
    state.loans = state.loans.filter((l) => l.id !== id);
    save();
  },
  registerLoanPayment(id) {
    const loan = state.loans.find((l) => l.id === id);
    if (!loan) return;
    loan.paidInstallments = Math.min(loan.installmentsTotal, (loan.paidInstallments || 0) + 1);
    save();
  },

  addInvestment(inv) {
    state.investments.push({ id: genId(), proceeds: [], ...inv });
    save();
  },
  updateInvestment(id, patch) {
    const i = state.investments.findIndex((t) => t.id === id);
    if (i >= 0) { state.investments[i] = { ...state.investments[i], ...patch }; save(); }
  },
  removeInvestment(id) {
    state.investments = state.investments.filter((t) => t.id !== id);
    save();
  },
  addContribution(investmentId, contribution) {
    const inv = state.investments.find((i) => i.id === investmentId);
    if (!inv) return;
    inv.contributions = inv.contributions || [];
    inv.contributions.push(contribution);
    inv.contributions.sort((a, b) => a.date.localeCompare(b.date));
    save();
  },
  addProceed(investmentId, proceed) {
    const inv = state.investments.find((i) => i.id === investmentId);
    if (!inv) return;
    inv.proceeds = inv.proceeds || [];
    inv.proceeds.push({ id: genId(), ...proceed });
    save();
  },
  removeProceed(investmentId, proceedId) {
    const inv = state.investments.find((i) => i.id === investmentId);
    if (!inv) return;
    inv.proceeds = (inv.proceeds || []).filter((p) => p.id !== proceedId);
    save();
  },

  setBudget(category, monthlyLimit, rollover) {
    const i = state.budgets.findIndex((b) => b.category === category);
    if (i >= 0) state.budgets[i] = { ...state.budgets[i], monthlyLimit, rollover: Boolean(rollover) };
    else state.budgets.push({ category, monthlyLimit, rollover: Boolean(rollover) });
    save();
  },
  removeBudget(category) {
    state.budgets = state.budgets.filter((b) => b.category !== category);
    save();
  },

  addGoal(goal) {
    state.goals.push({ id: genId(), savedAmount: 0, ...goal });
    save();
  },
  updateGoal(id, patch) {
    const i = state.goals.findIndex((g) => g.id === id);
    if (i >= 0) { state.goals[i] = { ...state.goals[i], ...patch }; save(); }
  },
  removeGoal(id) {
    state.goals = state.goals.filter((g) => g.id !== id);
    save();
  },

  addBill(bill) {
    state.bills.push({ id: genId(), active: true, autoGenerate: false, lastGeneratedMonth: null, ...bill });
    save();
  },
  updateBill(id, patch) {
    const i = state.bills.findIndex((b) => b.id === id);
    if (i >= 0) { state.bills[i] = { ...state.bills[i], ...patch }; save(); }
  },
  removeBill(id) {
    state.bills = state.bills.filter((b) => b.id !== id);
    save();
  },

  addCategoryRule(rule) {
    state.categoryRules.push({ id: genId(), ...rule });
    save();
  },
  updateCategoryRule(id, patch) {
    const i = state.categoryRules.findIndex((r) => r.id === id);
    if (i >= 0) { state.categoryRules[i] = { ...state.categoryRules[i], ...patch }; save(); }
  },
  removeCategoryRule(id) {
    state.categoryRules = state.categoryRules.filter((r) => r.id !== id);
    save();
  },

  updateSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    save();
  },

  // Chamado na inicialização: gera transações de contas fixas marcadas como
  // recorrentes automáticas para os meses já decorridos, evitando duplicatas.
  applyGeneratedTransactions(newTransactions, billUpdates) {
    if (newTransactions.length === 0) return 0;
    newTransactions.forEach((tx) => state.transactions.push({ id: genId(), ...tx }));
    billUpdates.forEach(({ id, lastGeneratedMonth }) => {
      const b = state.bills.find((x) => x.id === id);
      if (b) b.lastGeneratedMonth = lastGeneratedMonth;
    });
    save();
    return newTransactions.length;
  },

  replaceAll(newState) {
    state = {
      ...defaultState(),
      ...newState,
      investments: (newState.investments || []).map(migrateInvestment),
      accounts: newState.accounts || [],
    };
    save();
  },
  resetAll() {
    state = defaultState();
    save();
  },
};

export { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES };
