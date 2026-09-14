import { datedRowsError, isNullish } from './parse.js';
import { A, sheetContractError } from './schema.js';

export const APPLICATION_SHEET_NAMES = {
  feed: 'APP_FEED',
  log: 'Training Log',
  plan: 'Plan',
  raw: 'Raw_Data',
};

export function parsePrivateApplicationSnapshot(raw) {
  try {
    const snapshot = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!snapshot?.data || snapshot.mode !== 'private') return null;
    validateApplicationData(snapshot.data);
    return snapshot;
  } catch {
    return null;
  }
}

export function rowsFromValuesTable(table = []) {
  if (!Array.isArray(table)) throw new Error('DATA ERROR — niepoprawny format tabeli');
  if (!table.length) return [];
  if (table.some((row) => !Array.isArray(row))) throw new Error('DATA ERROR — niepoprawny format wiersza');
  const headers = (Array.isArray(table[0]) ? table[0] : []).map((header, index) => (
    String(header ?? '').trim() || `column_${index + 1}`
  ));
  if (new Set(headers.map((header) => header.toLowerCase())).size !== headers.length) {
    throw new Error('DATA ERROR — powtórzone nagłówki kolumn');
  }
  if (table.slice(1).some((row) => row.slice(headers.length).some((value) => !isNullish(value)))) {
    throw new Error('DATA ERROR — dane poza nagłówkami tabeli');
  }
  return table.slice(1).filter((values) => (
    Array.isArray(values) && values.some((value) => !isNullish(value))
  )).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

export function applicationDataFromTables(tables = {}) {
  return validateApplicationData(Object.fromEntries(Object.entries(APPLICATION_SHEET_NAMES).map(([key, sheetName]) => {
    if (!tables || !Object.hasOwn(tables, key) || !Array.isArray(tables[key])) {
      throw new Error(`DATA ERROR — ${sheetName}: brak tabeli w odpowiedzi serwera`);
    }
    const rows = rowsFromValuesTable(tables[key]);
    const contractError = sheetContractError(rows, sheetName);
    if (contractError) throw new Error(`DATA ERROR — ${contractError}`);
    const dateError = datedRowsError(rows, A.date, sheetName);
    if (dateError) throw new Error(`DATA ERROR — ${dateError}`);
    return [key, rows];
  })));
}

export function validateApplicationData(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('DATA ERROR — niepoprawny format danych aplikacji');
  }
  for (const [key, sheetName] of Object.entries(APPLICATION_SHEET_NAMES)) {
    if (!Object.hasOwn(data, key) || !Array.isArray(data[key])) {
      throw new Error(`DATA ERROR — ${sheetName}: brak danych aplikacji`);
    }
    const contractError = sheetContractError(data[key], sheetName);
    if (contractError) throw new Error(`DATA ERROR — ${contractError}`);
    const dateError = datedRowsError(data[key], A.date, sheetName);
    if (dateError) throw new Error(`DATA ERROR — ${dateError}`);
  }
  return data;
}

export async function fetchPrivateApplicationData(signal, fetchImpl = fetch) {
  const startedAt = Date.now();
  let response;
  try {
    response = await fetchImpl('/api/data', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', signal,
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    const offline = new Error('private-data-offline');
    offline.status = 0;
    throw offline;
  }
  let body = {};
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok || body?.ok !== true) {
    const error = new Error(body?.error || `private-data-${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('DATA ERROR — niepoprawna odpowiedź serwera');
  }
  return {
    data: applicationDataFromTables(body.tables),
    meta: {
      transport: body.transport || 'private-endpoint',
      serverDurationMs: Number.isFinite(Number(body.meta?.serverDurationMs)) ? Number(body.meta.serverDurationMs) : null,
      clientDurationMs: Date.now() - startedAt,
    },
  };
}
