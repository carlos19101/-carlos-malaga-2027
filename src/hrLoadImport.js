import { normalize, isNullish } from './parse.js';
import { plannerDay } from './jointPlanner.js';
import { loadFromEvidence, resolveHrRest, HR_LOAD_METHOD } from './hrLoad.js';

const column = index => { let s = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };

// Only extends a validated, authorized TCX reconciliation; never overwrites a
// legacy coach assessment. All writes join the existing atomic batch.
export function attachHrLoad(reconciliation, table, evidence, raw = [], importedDate = null) {
  if (!['update','noop'].includes(reconciliation.action) || !evidence) return reconciliation;
  const names = ['Coach_Load_AU','Coach_Load_Method','Coach_Load_Notes'];
  const indices = names.map(name => table.headers.findIndex(h => normalize(h) === normalize(name)));
  if (indices.some(index => index < 0)) return { action: 'contract-error', reason: 'Brak istniejących kolumn Coach_Load dla TRIMP.', missingHeaders: names.filter((_, i) => indices[i] < 0) };
  const row = table.rows.find(r => r.rowNumber === reconciliation.rowNumber);
  const dateIndex = table.headers.findIndex(h => normalize(h) === 'date');
  const date = plannerDay(row?.values?.[dateIndex]);
  if (!date) return { action: 'contract-error', reason: 'Brak daty sesji dla HRrest.' };
  if (importedDate !== null && importedDate !== date) return { action: 'conflict', reason: 'Data TCX nie zgadza się z datą sesji — nie można przypisać HRrest ani TRIMP.', sessionId: reconciliation.sessionId };
  const current = indices.map(index => row.values[index]);
  let previous;
  try { previous = JSON.parse(current[2]); } catch { /* old free text is protected */ }
  if (current[1] === HR_LOAD_METHOD && JSON.stringify(previous?.evidence) === JSON.stringify(evidence)) return reconciliation;
  if (current.some(v => !isNullish(v))) return { action: 'conflict', reason: 'Istniejący Coach_Load wymaga przeglądu przed zastąpieniem przez TRIMP.', sessionId: reconciliation.sessionId };
  const result = loadFromEvidence(evidence, resolveHrRest(raw, date));
  if (!result) return reconciliation; // No valid intervals: no invented zero.
  const values = [result.value, HR_LOAD_METHOD, JSON.stringify(result)];
  const updates = indices.map((index, i) => ({ kind: 'hr-load', range: `${column(index)}${row.rowNumber}`, startColumnIndex: index, values: [values[i]] }));
  return { ...reconciliation, action: 'update', updates: [...(reconciliation.updates || []), ...updates] };
}
