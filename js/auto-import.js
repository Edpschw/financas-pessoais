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
import { parseWorkbook } from "./excel-import.js";
import { parseStatementPdf } from "./pdf-import.js";
import { parseBackupJsonText } from "./json-import.js";
import { tagInvestmentMovements } from "./investment-flow.js";
import { isDuplicateTransaction, isImportedPlaceholderAccount } from "./utils.js";
import { Store } from "./storage.js";

const DB_NAME = "financas-pessoais-fs";
const OBJECT_STORE = "handles";
const HANDLE_KEY = "auto-import-dir";
// Formatos com parser de verdade. Imagem (recibo/comprovante fotografado) exigiria OCR
// no navegador — biblioteca pesada e pouco confiável para esse tipo de foto — por isso
// só é reconhecida pra aparecer como "não suportado" no log, sem tentar processar.
const DATA_EXT = [".csv", ".ofx", ".qfx", ".xlsx", ".xls", ".pdf", ".json"];
const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".heic", ".heif"];
const IMPORTABLE_EXT = [...DATA_EXT, ...IMAGE_EXT];

function extOf(name) {
  const lower = name.toLowerCase();
  return IMPORTABLE_EXT.find((ext) => lower.endsWith(ext)) || null;
}

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

// Devolve sempre {transactions, warnings}, e opcionalmente {investments} (só backup
// JSON traz isso). csv/ofx/xlsx/json não geram avisos (formato estruturado), só o
// parser de PDF (js/pdf-import.js) pode devolver linhas ambíguas.
async function parseFile(file, ext) {
  if (ext === ".csv") {
    const { headers, rows } = parseCSV(await file.text());
    return { transactions: rowsToTransactions(rows, guessMapping(headers)), warnings: [] };
  }
  if (ext === ".ofx" || ext === ".qfx") {
    return { transactions: parseOFX(await file.text()), warnings: [] };
  }
  if (ext === ".xlsx" || ext === ".xls") {
    return { transactions: parseWorkbook(await file.arrayBuffer(), { fileName: file.name }), warnings: [] };
  }
  if (ext === ".pdf") {
    return parseStatementPdf(await file.arrayBuffer());
  }
  if (ext === ".json") {
    const { transactions, investments } = parseBackupJsonText(await file.text());
    return { transactions, investments, warnings: [] };
  }
  return { transactions: [], warnings: [] };
}

// Varre a pasta escolhida, ignora arquivos já processados (pelo ledger em
// Store.importedFiles) e lê o resto: resolve a conta, marca movimentação de
// investimento e descarta duplicatas contra o que já existe. Cada arquivo processado
// (inclusive os não suportados) vira uma entrada no ledger, que aparece na aba
// "Base de dados".
export async function scanAndImport(dirHandle) {
  const summary = {
    filesScanned: 0, filesImported: 0, filesUnsupported: 0,
    transactionsImported: 0, investmentsImported: 0, investmentsUpdated: 0,
    duplicatesSkipped: 0, warningsCount: 0, errors: [],
  };
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

    const ext = extOf(file.name);

    if (IMAGE_EXT.includes(ext)) {
      Store.markFileImported(key, {
        name: file.name, type: ext.slice(1), status: "unsupported",
        recordsFound: 0, recordsImported: 0, duplicatesSkipped: 0, warnings: [],
      });
      summary.filesUnsupported += 1;
      continue;
    }

    try {
      const { transactions: rawTxs, investments, warnings } = await parseFile(file, ext);
      const prepared = tagInvestmentMovements(withResolvedAccount(rawTxs))
        .map((tx) => ({ ...tx, source: file.name }));
      const { toImport, duplicates } = dedupeAgainstExisting(prepared);
      if (toImport.length > 0) Store.addTransactions(toImport);
      const invResult = investments && investments.length > 0
        ? Store.mergeInvestments(investments)
        : { added: 0, updated: 0 };

      Store.markFileImported(key, {
        name: file.name, type: ext ? ext.slice(1) : "?", status: warnings.length > 0 ? "partial" : "ok",
        recordsFound: rawTxs.length + (investments ? investments.length : 0),
        recordsImported: toImport.length + invResult.added,
        duplicatesSkipped: duplicates, warnings,
      });

      summary.filesImported += 1;
      summary.transactionsImported += toImport.length;
      summary.investmentsImported += invResult.added;
      summary.investmentsUpdated += invResult.updated;
      summary.duplicatesSkipped += duplicates;
      summary.warningsCount += warnings.length;
    } catch (err) {
      Store.markFileImported(key, {
        name: file.name, type: ext ? ext.slice(1) : "?", status: "error",
        recordsFound: 0, recordsImported: 0, duplicatesSkipped: 0, warnings: [err.message],
      });
      summary.errors.push({ file: file.name, message: err.message });
    }
  }
  return summary;
}
