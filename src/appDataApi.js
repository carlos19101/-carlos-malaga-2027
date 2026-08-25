import { datedRowsError, isNullish } from './parse.js';
import { A, sheetContractError } from './schema.js';

export const APPLICATION_SHEET_NAMES = {
  feed: 'APP_FEED',
  log: 'Training Log',
  plan: 'Plan',
  raw: 'Raw_Data',
};

export function parseApplicationSnapshot(raw, mode) {
  try {
    const snapshot = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const snapshotMode = snapshot?.mode || 'public';
    return snapshot?.data && snapshotMode === mode ? snapshot : null;
  } catch {
    return null;
  }
}

export function rowsFromValuesTable(table = []) {
  if (!Array.isArray(table) || !table.length) return [];
  const headers = (Array.isArray(table[0]) ? table[0] : []).map((header, index) => (
    String(header ?? '').trim() || `column_${index + 1}`
  ));
  return table.slice(1).filter((values) => (
    Array.isArray(values) && values.some((value) => !isNullish(value))
  )).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

export function applicationDataFromTables(tables = {}) {
  return Object.fromEntries(Object.entries(APPLICATION_SHEET_NAMES).map(([key, sheetName]) => {
    const rows = rowsFromValuesTable(tables[key]);
    const contractError = sheetContractError(rows, sheetName);
    if (contractError) throw new Error(`DATA ERROR — ${contractError}`);
    const dateError = datedRowsError(rows, A.date, sheetName);
    if (dateError) throw new Error(`DATA ERROR — ${dateError}`);
    return [key, rows];
  }));
}

export async function fetchPrivateApplicationData(signal, fetchImpl = fetch) {
  try {
    const response = await fetchImpl('/api/data', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', signal,
      headers: { Accept: 'application/json' },
    });
    let body = {};
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok || body.ok === false) {
      const error = new Error(body.error || `private-data-${response.status}`);
      error.status = response.status;
      throw error;
    }
    return applicationDataFromTables(body.tables);
  } catch (error) {
    if (error?.name === 'AbortError' || error?.status) throw error;
    const offline = new Error('private-data-offline');
    offline.status = 0;
    throw offline;
  }
}
