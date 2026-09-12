const STORAGE_KEY = "financas-pessoais:v1";

const DEFAULT_EXPENSE_CATEGORIES = [
  "Moradia", "Alimentação", "Transporte", "Saúde", "Educação",
  "Lazer", "Compras", "Assinaturas", "Impostos", "Outros"
];

const DEFAULT_INCOME_CATEGORIES = ["Salário", "Freelance", "Rendimentos", "Outros"];

function defaultState() {
  return {
    transactions: [],
    investments: [],
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
    },
  };
}

// Investimentos antigos guardavam um único par {invested, date}. A partir da versão
// com XIRR, cada investimento tem uma lista de aportes (contributions), o que permite
// calcular rentabilidade anualizada real (Portfolio Performance / Paisa usam a mesma ideia).
function migrateInvestment(inv) {
  if (Array.isArray(inv.contributions) && inv.contributions.length > 0) return inv;
  const amount = typeof inv.invested === "number" ? inv.invested : 0;
  const date = inv.date || new Date().toISOString().slice(0, 10);
  return { ...inv, contributions: [{ date, amount }] };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const base = defaultState();
    return {
      transactions: parsed.transactions || base.transactions,
      investments: (parsed.investments || base.investments).map(migrateInvestment),
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
  const netWorth = state.investments.reduce((s, i) => s + (i.currentValue || 0), 0);
  const month = currentMonthKey();
  const i = state.netWorthHistory.findIndex((h) => h.month === month);
  if (i >= 0) state.netWorthHistory[i].netWorth = netWorth;
  else state.netWorthHistory.push({ month, netWorth });
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

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function investedTotal(inv) {
  return (inv.contributions || []).reduce((s, c) => s + c.amount, 0);
}

export const Store = {
  get() { return state; },
  onChange,

  addTransaction(tx) {
    state.transactions.push({ id: genId(), ...tx });
    save();
  },
  updateTransaction(id, patch) {
    const i = state.transactions.findIndex((t) => t.id === id);
    if (i >= 0) { state.transactions[i] = { ...state.transactions[i], ...patch }; save(); }
  },
  removeTransaction(id) {
    state.transactions = state.transactions.filter((t) => t.id !== id);
    save();
  },
  addTransactions(list) {
    list.forEach((tx) => state.transactions.push({ id: genId(), ...tx }));
    save();
  },

  addInvestment(inv) {
    state.investments.push({ id: genId(), ...inv });
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

  setBudget(category, monthlyLimit) {
    const i = state.budgets.findIndex((b) => b.category === category);
    if (i >= 0) state.budgets[i].monthlyLimit = monthlyLimit;
    else state.budgets.push({ category, monthlyLimit });
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
    state.bills.push({ id: genId(), active: true, ...bill });
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
  removeCategoryRule(id) {
    state.categoryRules = state.categoryRules.filter((r) => r.id !== id);
    save();
  },

  updateSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    save();
  },

  replaceAll(newState) {
    state = { ...defaultState(), ...newState, investments: (newState.investments || []).map(migrateInvestment) };
    save();
  },
  resetAll() {
    state = defaultState();
    save();
  },
};

export { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES };
