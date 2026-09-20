// Persistência local (localStorage). O app é um visualizador da pasta de extratos:
// o estado aqui é um cache do que já foi lido dos arquivos, mais o ledger de quais
// arquivos já foram processados — nada é digitado à mão.
const STORAGE_KEY = "financas-pessoais:v1";

function defaultState() {
  return {
    transactions: [],
    accounts: [],
    investments: [],
    portfolioSnapshots: [],
    importedFiles: [],
    settings: { theme: "system" },
  };
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Investimentos antigos guardavam um único par {invested, date}; a forma atual é uma
// lista de aportes. Também garante a lista de proventos.
function migrateInvestment(inv) {
  let out = inv;
  if (!Array.isArray(inv.contributions) || inv.contributions.length === 0) {
    const amount = typeof inv.invested === "number" ? inv.invested : inv.currentValue || 0;
    const date = inv.date || new Date().toISOString().slice(0, 10);
    out = { ...out, contributions: [{ date, amount }] };
  }
  if (!Array.isArray(out.proceeds)) out = { ...out, proceeds: [] };
  return out;
}

// Versões antigas guardavam a conta como texto livre (campo `account`). Sem a lista
// `accounts`, criamos uma conta por nome distinto encontrado nas transações.
function migrateAccounts(parsed, transactions) {
  if (Array.isArray(parsed.accounts) && parsed.accounts.length > 0) {
    return { accounts: parsed.accounts, transactions };
  }
  const accounts = [];
  const byName = new Map();
  const migrated = transactions.map((t) => {
    if (t.accountId) return t;
    const name = (t.account || "").trim();
    if (!name) return t;
    const key = name.toLowerCase();
    let acc = byName.get(key);
    if (!acc) {
      acc = { id: genId(), name };
      byName.set(key, acc);
      accounts.push(acc);
    }
    return { ...t, accountId: acc.id };
  });
  return { accounts, transactions: migrated };
}

// ============================================================
// Snapshots da carteira
// ============================================================
// A posição consolidada em PDF é uma FOTO da carteira numa data — diferente do backup
// JSON, que é aditivo. Antes o valor de cada posição era sobrescrito a cada leitura,
// então o PDF novo apagava o anterior e a carteira não tinha história: sem duas datas
// não dá para medir progressão nenhuma. Agora cada leitura vira um snapshot, guardado
// pela data de referência, e a carteira "atual" é derivada do snapshot mais recente.

function normalizePosition(pos) {
  const name = (pos?.name || "").trim();
  const currentValue = Number(pos?.currentValue);
  if (!name || !Number.isFinite(currentValue) || currentValue <= 0) return null;
  const yearReturn = Number(pos.yearReturn);
  const share = Number(pos.share);
  return {
    name,
    class: pos.class || "outros",
    currentValue,
    yearReturn: Number.isFinite(yearReturn) ? yearReturn : null,
    share: Number.isFinite(share) ? share : null,
  };
}

function normalizeSnapshot(raw) {
  const date = (raw?.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const positions = (Array.isArray(raw.positions) ? raw.positions : []).map(normalizePosition).filter(Boolean);
  if (positions.length === 0) return null;
  return {
    date,
    source: raw.source || "",
    positions,
    total: positions.reduce((sum, p) => sum + p.currentValue, 0),
  };
}

function normalizeSnapshots(list) {
  return (Array.isArray(list) ? list : [])
    .map(normalizeSnapshot)
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// A carteira exibida é a do snapshot mais recente. Posições vindas de backup JSON
// (origin !== "snapshot") são preservadas, menos as que colidem de nome com o
// snapshot — senão a mesma classe apareceria duas vezes e o total dobraria.
function investmentsFromLatestSnapshot(snapshots, current) {
  const latest = snapshots[snapshots.length - 1];
  if (!latest) return current;
  const names = new Set(latest.positions.map((p) => p.name.trim().toLowerCase()));
  const fromOtherSources = current.filter(
    (inv) => inv.origin !== "snapshot" && !names.has((inv.name || "").trim().toLowerCase())
  );
  const fromSnapshot = latest.positions.map((p) => migrateInvestment({
    ...p,
    id: genId(),
    origin: "snapshot",
    date: latest.date,
  }));
  return [...fromSnapshot, ...fromOtherSources];
}

// Normaliza qualquer estado bruto (localStorage de uma versão anterior, que podia ter
// empréstimos/metas/orçamentos) para a forma atual, descartando o que não existe mais.
function normalizeState(parsed) {
  const base = defaultState();
  const rawTransactions = (parsed.transactions || base.transactions)
    .filter((t) => t && (t.type === "expense" || t.type === "income"))
    .map((t) => ({ category: "Outros", ...t }));
  const { accounts, transactions } = migrateAccounts(parsed, rawTransactions);
  const portfolioSnapshots = normalizeSnapshots(parsed.portfolioSnapshots);
  return {
    transactions,
    accounts,
    investments: (parsed.investments || base.investments).map(migrateInvestment),
    portfolioSnapshots,
    importedFiles: parsed.importedFiles || base.importedFiles,
    settings: { ...base.settings, ...(parsed.settings || {}) },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return normalizeState(JSON.parse(raw));
  } catch (err) {
    console.error("Falha ao carregar dados salvos, começando vazio.", err);
    return defaultState();
  }
}

let state = load();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error("Falha ao salvar no localStorage.", err);
  }
}

export const Store = {
  get() { return state; },

  addTransactions(list) {
    list.forEach((tx) => state.transactions.push({ id: genId(), ...tx }));
    save();
  },
  removeTransactions(ids) {
    const set = new Set(ids);
    state.transactions = state.transactions.filter((t) => !set.has(t.id));
    save();
  },

  // Chamado pelos importadores quando o arquivo traz um nome de conta em texto:
  // reaproveita a conta existente com o mesmo nome ou cria uma nova.
  findOrCreateAccount(name) {
    const clean = (name || "").trim();
    if (!clean) return "";
    const key = clean.toLowerCase();
    const existing = state.accounts.find((a) => a.name.trim().toLowerCase() === key);
    if (existing) return existing.id;
    const id = genId();
    state.accounts.push({ id, name: clean });
    save();
    return id;
  },
  accountName(accountId) {
    const acc = state.accounts.find((a) => a.id === accountId);
    return acc ? acc.name : "";
  },

  // Soma investimentos vindos de um backup JSON da pasta, casando por nome para não
  // duplicar a mesma posição a cada nova leitura do mesmo arquivo. Uma posição que já
  // existe tem o valor atualizado (o arquivo mais recente manda).
  mergeInvestments(list) {
    let added = 0;
    let updated = 0;
    (list || []).forEach((inv) => {
      const name = (inv.name || "").trim();
      if (!name) return;
      const key = name.toLowerCase();
      const existing = state.investments.find((i) => i.name.trim().toLowerCase() === key);
      if (existing) {
        if (typeof inv.currentValue === "number" && inv.currentValue !== existing.currentValue) {
          existing.currentValue = inv.currentValue;
          updated++;
        }
        return;
      }
      state.investments.push(migrateInvestment({ ...inv, id: inv.id || genId(), name }));
      added++;
    });
    if (added > 0 || updated > 0) save();
    return { added, updated };
  },

  // Guarda a posição consolidada lida de um PDF como um snapshot datado. Reler o PDF
  // do mesmo mês substitui o snapshot daquela data (o arquivo mais recente manda);
  // um PDF de outra data entra como um ponto novo na série.
  recordPortfolioSnapshot({ date, source, positions }) {
    const snapshot = normalizeSnapshot({ date, source, positions });
    if (!snapshot) return { added: 0, updated: 0 };

    const index = state.portfolioSnapshots.findIndex((s) => s.date === snapshot.date);
    const isUpdate = index >= 0;
    if (isUpdate) state.portfolioSnapshots[index] = snapshot;
    else state.portfolioSnapshots.push(snapshot);
    state.portfolioSnapshots.sort((a, b) => a.date.localeCompare(b.date));

    state.investments = investmentsFromLatestSnapshot(state.portfolioSnapshots, state.investments);
    save();
    return isUpdate
      ? { added: 0, updated: snapshot.positions.length }
      : { added: snapshot.positions.length, updated: 0 };
  },

  // Série da carteira, do mais antigo para o mais recente.
  portfolioHistory() {
    return state.portfolioSnapshots;
  },

  // Ledger dos arquivos já processados, para não reimportar o mesmo extrato a cada
  // varredura. A chave identifica o arquivo por nome+tamanho+data de modificação.
  isFileImported(key) {
    return state.importedFiles.some((f) => f.key === key);
  },
  markFileImported(key, meta = {}) {
    state.importedFiles.push({ key, importedAt: new Date().toISOString(), ...meta });
    save();
  },

  updateSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    save();
  },

  resetAll() {
    state = defaultState();
    save();
  },
};
