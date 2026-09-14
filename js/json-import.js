// Leitura de um backup JSON (o mesmo formato de Configurações → Exportar backup) a
// partir da pasta automática. Diferente do botão manual "Importar backup" — que usa
// Store.replaceAll e SUBSTITUI tudo — aqui a leitura é aditiva: soma transações e
// investimentos novos ao que já existe, sem apagar nada. Um replaceAll automático a
// cada varredura da pasta apagaria dados mais recentes toda vez que o mesmo JSON
// antigo fosse relido, o que seria destrutivo demais pra rodar sem confirmação.
export function transactionsFromBackupJson(data) {
  const list = Array.isArray(data?.transactions) ? data.transactions : [];
  return list
    .filter((t) => t.type === "expense" || t.type === "income")
    .filter((t) => t.date && typeof t.amount === "number" && t.amount !== 0)
    .map((t) => ({
      date: t.date,
      description: t.description || "Transação importada",
      amount: Math.abs(t.amount),
      type: t.type,
      category: t.category || "Outros",
      account: t.account || "Importado (JSON)",
    }));
}

export function investmentsFromBackupJson(data) {
  return Array.isArray(data?.investments) ? data.investments : [];
}

export function parseBackupJsonText(text) {
  const data = JSON.parse(text);
  return {
    transactions: transactionsFromBackupJson(data),
    investments: investmentsFromBackupJson(data),
  };
}
