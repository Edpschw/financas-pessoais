// Importação automática de extratos a partir de uma pasta local, usando a File System
// Access API (showDirectoryPicker). Só existe em navegadores baseados em Chromium —
// não é possível "vigiar" uma pasta do disco sem essa API e sem um backend, e este
// projeto é deliberadamente 100% client-side.
//
// O handle da pasta é salvo no IndexedDB (é clonável) para não precisar pedir de novo
// a cada visita — mas o navegador pode "esquecer" a permissão, daí verifyPermission()
// separar checagem silenciosa (queryPermission) de pedido explícito (requestPermission,
// que exige um gesto do usuário).
import { parseCSV, guessMapping, rowsToTransactions } from "./csv-import.js";
import { parseOFX } from "./ofx-import.js";
import { applyCategoryRules } from "./categorize.js";
import { isDuplicateTransaction, isImportedPlaceholderAccount } from "./utils.js";
import { Store } from "./storage.js";

const DB_NAME = "financas-pessoais-fs";
const OBJECT_STORE = "handles";
const HANDLE_KEY = "auto-import-dir";
const IMPORTABLE_EXT = [".csv", ".ofx", ".qfx"];

export function isSupported() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

function openHandleDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(OBJECT_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDirectoryHandle(handle) {
  const db = await openHandleDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(OBJECT_STORE, "readwrite");
    tx.objectStore(OBJECT_STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadDirectoryHandle() {
  const db = await openHandleDB();
  const handle = await new Promise((resolve, reject) => {
    const tx = db.transaction(OBJECT_STORE, "readonly");
    const req = tx.objectStore(OBJECT_STORE).get(HANDLE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return handle;
}

export async function forgetDirectoryHandle() {
  const db = await openHandleDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(OBJECT_STORE, "readwrite");
    tx.objectStore(OBJECT_STORE).delete(HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

// mode "read": true se já concedido; requestIfNeeded=true também tenta pedir (precisa
// ser chamado a partir de um clique do usuário, senão o navegador rejeita silenciosamente).
export async function verifyPermission(handle, requestIfNeeded) {
  const opts = { mode: "read" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  if (!requestIfNeeded) return false;
  return (await handle.requestPermission(opts)) === "granted";
}

function fileKey(dirHandle, file) {
  return `${dirHandle.name}/${file.name}:${file.size}:${file.lastModified}`;
}

async function collectImportableFiles(dirHandle) {
  const files = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind !== "file") continue;
    const lower = entry.name.toLowerCase();
    if (IMPORTABLE_EXT.some((ext) => lower.endsWith(ext))) files.push(entry);
  }
  return files;
}

function withAutoCategory(txs) {
  const { categoryRules } = Store.get();
  return txs.map((tx) => {
    const suggested = applyCategoryRules(tx.description, tx.type, categoryRules);
    return suggested ? { ...tx, category: suggested } : tx;
  });
}

function withResolvedAccount(txs) {
  return txs.map((tx) => ({
    ...tx,
    accountId: !isImportedPlaceholderAccount(tx.account) ? Store.findOrCreateAccount(tx.account) : "",
  }));
}

function dedupeAgainstExisting(candidates) {
  const { transactions: existing } = Store.get();
  const toImport = [];
  let duplicates = 0;
  candidates.forEach((tx) => {
    if (isDuplicateTransaction(tx, existing.concat(toImport))) duplicates++;
    else toImport.push(tx);
  });
  return { toImport, duplicates };
}

function parseFile(name, text) {
  if (name.toLowerCase().endsWith(".csv")) {
    const { headers, rows } = parseCSV(text);
    return rowsToTransactions(rows, guessMapping(headers));
  }
  return parseOFX(text);
}

// Varre a pasta escolhida, ignora arquivos já processados (pelo ledger em
// Store.importedFiles) e importa o resto com o mesmo pipeline do botão manual
// (categorização automática + dedupe contra o que já existe).
export async function scanAndImport(dirHandle) {
  const summary = { filesScanned: 0, filesImported: 0, transactionsImported: 0, duplicatesSkipped: 0, errors: [] };
  const fileHandles = await collectImportableFiles(dirHandle);
  summary.filesScanned = fileHandles.length;

  for (const fh of fileHandles) {
    let file;
    try {
      file = await fh.getFile();
    } catch (err) {
      summary.errors.push({ file: fh.name, message: err.message });
      continue;
    }
    const key = fileKey(dirHandle, file);
    if (Store.isFileImported(key)) continue;

    try {
      const text = await file.text();
      const rawTxs = parseFile(file.name, text);
      const { toImport, duplicates } = dedupeAgainstExisting(withAutoCategory(withResolvedAccount(rawTxs)));
      if (toImport.length > 0) Store.addTransactions(toImport);
      Store.markFileImported(key, { name: file.name, transactionsImported: toImport.length });

      summary.filesImported += 1;
      summary.transactionsImported += toImport.length;
      summary.duplicatesSkipped += duplicates;
    } catch (err) {
      summary.errors.push({ file: file.name, message: err.message });
    }
  }
  return summary;
}
