// Categorização automática por palavra-chave, no estilo das "regras" do Firefly III:
// cada regra associa um trecho do texto da transação a uma categoria.
export function applyCategoryRules(description, type, rules) {
  const text = (description || "").toLowerCase();
  const match = rules.find((r) => (!r.type || r.type === type) && text.includes(r.keyword.toLowerCase()));
  return match ? match.category : null;
}
