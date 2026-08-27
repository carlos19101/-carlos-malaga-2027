import { isNullish, normalize, parseDate, parseNumber } from './parse.js';
import { analyzeTcx, formatTcxActivityTiming } from './tcx.js';

export const TCX_IMPORT_SCHEMA = 'carlos.tcx-import.v1';
export const TCX_IMPORT_HEADERS = [
  'HR_Target_Min_bpm',
  'HR_Target_Max_bpm',
  'Time_In_Target_s',
  'Time_Above_Target_s',
  'Time_Below_Target_s',
  'HR_Analyzed_Duration_s',
];
export const SESSION_ID_HEADER = 'Session_ID';
export const TCX_TIMING_HEADER = 'Time';

const TCX_IMPORT_ID_PATTERN = /^tcx-v1-[0-9a-f]{8}$/;
const SESSION_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{5,119}$/i;
const SHA256_PATTERN = /^[A-F0-9]{64}$/;

function requiredText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} nie może być puste.`);
  return text;
}

function valueFingerprint(values) {
  let hash = 2166136261;
  for (const character of values.join('|')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function localDateKey(value) {
  const date = parseDate(value);
  if (!date) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function validateTiming(timing) {
  if (timing === undefined) return { valid: true, value: null };
  const source = timing && typeof timing === 'object' ? timing : null;
  const startedAt = String(source?.startedAt ?? '').trim();
  const timeZone = String(source?.timeZone ?? '').trim();
  const localDate = String(source?.localDate ?? '').trim();
  const localTime = String(source?.localTime ?? '').trim();
  if (!source || !Number.isFinite(Date.parse(startedAt)) || !timeZone
    || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)
    || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(localTime)) {
    return { valid: false };
  }
  return { valid: true, value: { startedAt, timeZone, localDate, localTime } };
}

export function createTcxImport(tcxText, options = {}) {
  const sessionId = requiredText(options.sessionId, 'sessionId');
  const sourceSha256 = String(options.sourceSha256 ?? '').trim().toUpperCase();
  const analysis = analyzeTcx(tcxText, {
    targetMin: options.targetMin,
    targetMax: options.targetMax,
    ...(options.maxGapSeconds === undefined ? {} : { maxGapSeconds: options.maxGapSeconds }),
  });
  const timing = formatTcxActivityTiming(analysis.startedAt, options.timeZone);
  const values = [
    analysis.targetMin,
    analysis.targetMax,
    analysis.timeInTarget,
    analysis.timeAboveTarget,
    analysis.timeBelowTarget,
    analysis.analyzedDuration,
  ];
  const idempotencyKey = `tcx-v1-${valueFingerprint([sessionId, sourceSha256 || 'NO_SHA256', timing.localDate, timing.localTime, ...values])}`;

  return {
    schema: TCX_IMPORT_SCHEMA,
    sessionId,
    sourceSha256: sourceSha256 || null,
    idempotencyKey,
    timing,
    methodology: {
      intervalOwner: 'previous-trackpoint',
      inclusiveTarget: true,
      maxGapSeconds: analysis.maxGapSeconds,
      lastTrackpointGetsDuration: false,
    },
    atomic: Object.fromEntries(TCX_IMPORT_HEADERS.map((header, index) => [header, values[index]])),
    diagnostics: {
      lapCount: analysis.lapCount,
      trackpointCount: analysis.trackpointCount,
      analyzedIntervals: analysis.analyzedIntervals,
      excludedGaps: analysis.excludedGaps,
      excludedDuration: analysis.excludedDuration,
      nonPositiveIntervals: analysis.nonPositiveIntervals,
    },
  };
}

export function validateTcxImportEnvelope(envelope = {}) {
  if (envelope.schema !== TCX_IMPORT_SCHEMA) {
    return result('contract-error', { reason: `Nieobsługiwany schemat importu: ${envelope.schema ?? 'brak'}` });
  }
  if (!SESSION_ID_PATTERN.test(String(envelope.sessionId ?? '').trim())) {
    return result('contract-error', { reason: 'Nieprawidłowy Session_ID.' });
  }
  if (!TCX_IMPORT_ID_PATTERN.test(String(envelope.idempotencyKey ?? ''))) {
    return result('contract-error', { reason: 'Nieprawidłowy klucz idempotencji TCX.' });
  }
  if (envelope.sourceSha256 !== null && !SHA256_PATTERN.test(String(envelope.sourceSha256 ?? ''))) {
    return result('contract-error', { reason: 'Nieprawidłowy SHA-256 pliku TCX.' });
  }
  const timing = validateTiming(envelope.timing);
  if (!timing.valid) return result('contract-error', { reason: 'Nieprawidłowy czas rozpoczęcia TCX.' });

  const proposed = TCX_IMPORT_HEADERS.map((header) => envelope.atomic?.[header]);
  const invalidAtomicHeaders = TCX_IMPORT_HEADERS.filter((_, index) => (
    !Number.isFinite(proposed[index]) || proposed[index] < 0
  ));
  if (invalidAtomicHeaders.length) return result('contract-error', { invalidAtomicHeaders });

  const [targetMin, targetMax, timeInTarget, timeAboveTarget, timeBelowTarget, analyzedDuration] = proposed;
  if (targetMin < 20 || targetMax > 250 || targetMin >= targetMax) {
    return result('contract-error', { reason: 'Nieprawidłowy zakres docelowego HR.' });
  }
  if (Math.abs(timeInTarget + timeAboveTarget + timeBelowTarget - analyzedDuration) > 1e-6) {
    return result('contract-error', { reason: 'Czasy atomowe nie sumują się do analizowanego czasu.' });
  }

  const methodology = envelope.methodology || {};
  if (methodology.intervalOwner !== 'previous-trackpoint'
    || methodology.inclusiveTarget !== true
    || methodology.lastTrackpointGetsDuration !== false
    || !Number.isFinite(methodology.maxGapSeconds)
    || methodology.maxGapSeconds <= 0) {
    return result('contract-error', { reason: 'Nieprawidłowa metodologia analizy TCX.' });
  }
  return result('valid', { envelope: timing.value ? { ...envelope, timing: timing.value } : envelope });
}

function parseCsvRecords(text) {
  const records = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < String(text ?? '').length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      records.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }

  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ''));
    records.push(row);
  }
  return records;
}

export function parseTrainingLogCsv(text) {
  const records = parseCsvRecords(text);
  const headerIndex = records.findIndex((row) => row.some((value) => String(value).trim() !== ''));
  if (headerIndex === -1) return { headers: [], rows: [] };

  const headers = records[headerIndex].map((value, index) => (
    String(value).replace(/^\uFEFF/, '').trim() || `column_${index + 1}`
  ));
  const rows = records.slice(headerIndex + 1).map((values, index) => ({
    rowNumber: headerIndex + index + 2,
    values: headers.map((_, columnIndex) => values[columnIndex] ?? ''),
  }));
  return { headers, rows };
}

function headerIndex(headers, wanted) {
  const normalizedWanted = normalize(wanted);
  const indexes = headers.reduce((matches, header, index) => (
    normalize(header) === normalizedWanted ? [...matches, index] : matches
  ), []);
  return indexes.length === 1 ? indexes[0] : -1;
}

function columnLetter(zeroBasedIndex) {
  let value = zeroBasedIndex + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function result(action, details = {}) {
  return { action, ...details };
}

function resolveTimingUpdate(headers, row, timing) {
  if (!timing) return { action: 'not-provided' };
  const dateIndex = headerIndex(headers, 'Date');
  const timeIndex = headerIndex(headers, TCX_TIMING_HEADER);
  if (dateIndex === -1 || timeIndex === -1) return { action: 'missing-column' };
  const rowDate = localDateKey(row.values?.[dateIndex]);
  if (!rowDate) return { action: 'invalid-row-date' };
  if (rowDate !== timing.localDate) return { action: 'date-mismatch', rowDate, tcxDate: timing.localDate };
  const current = String(row.values?.[timeIndex] ?? '').trim();
  if (!isNullish(current)) return {
    action: current === timing.localTime ? 'already-recorded' : 'preserved',
    current,
  };
  return {
    action: 'update',
    startColumnIndex: timeIndex,
    range: `${columnLetter(timeIndex)}${row.rowNumber}`,
    values: [timing.localTime],
  };
}

export function resolveTcxTarget(table = {}, sessionIdValue = '') {
  const sessionId = String(sessionIdValue ?? '').trim();
  const headers = Array.isArray(table.headers) ? table.headers : [];
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const sessionIndex = headerIndex(headers, SESSION_ID_HEADER);
  const minIndex = headerIndex(headers, TCX_IMPORT_HEADERS[0]);
  const maxIndex = headerIndex(headers, TCX_IMPORT_HEADERS[1]);
  const missingHeaders = [
    ...(sessionIndex === -1 ? [SESSION_ID_HEADER] : []),
    ...(minIndex === -1 ? [TCX_IMPORT_HEADERS[0]] : []),
    ...(maxIndex === -1 ? [TCX_IMPORT_HEADERS[1]] : []),
  ];
  if (missingHeaders.length) return result('contract-error', { missingHeaders });

  const matches = rows.filter(({ values = [] }) => String(values[sessionIndex] ?? '').trim() === sessionId);
  if (!matches.length) return result('missing-session', { sessionId });
  if (matches.length > 1) {
    return result('duplicate-session', { sessionId, rowNumbers: matches.map(({ rowNumber }) => rowNumber) });
  }

  const row = matches[0];
  const targetMin = parseNumber(row.values?.[minIndex]);
  const targetMax = parseNumber(row.values?.[maxIndex]);
  if (targetMin === null || targetMax === null) {
    return result('missing-target', { sessionId, rowNumber: row.rowNumber, targetMin, targetMax });
  }
  if (targetMin >= targetMax) {
    return result('invalid-target', { sessionId, rowNumber: row.rowNumber, targetMin, targetMax });
  }
  return result('resolved', { sessionId, rowNumber: row.rowNumber, targetMin, targetMax });
}

export function reconcileTcxImport(table = {}, envelope = {}) {
  const validation = validateTcxImportEnvelope(envelope);
  if (validation.action !== 'valid') return validation;

  const headers = Array.isArray(table.headers) ? table.headers : [];
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const sessionIndex = headerIndex(headers, SESSION_ID_HEADER);
  const atomicIndexes = TCX_IMPORT_HEADERS.map((header) => headerIndex(headers, header));
  const missingHeaders = [
    ...(sessionIndex === -1 ? [SESSION_ID_HEADER] : []),
    ...TCX_IMPORT_HEADERS.filter((_, index) => atomicIndexes[index] === -1),
  ];
  if (missingHeaders.length) return result('contract-error', { missingHeaders });

  const expectedAtomicStart = atomicIndexes[0];
  if (!atomicIndexes.every((index, offset) => index === expectedAtomicStart + offset)) {
    return result('contract-error', { reason: 'Kolumny atomowe nie tworzą ciągłego bloku w ustalonej kolejności.' });
  }

  const matches = rows.filter(({ values = [] }) => String(values[sessionIndex] ?? '').trim() === envelope.sessionId);
  if (!matches.length) return result('missing-session', { sessionId: envelope.sessionId });
  if (matches.length > 1) {
    return result('duplicate-session', {
      sessionId: envelope.sessionId,
      rowNumbers: matches.map(({ rowNumber }) => rowNumber),
    });
  }

  const row = matches[0];
  const proposed = TCX_IMPORT_HEADERS.map((header) => envelope.atomic[header]);
  const currentRaw = atomicIndexes.map((index) => row.values?.[index] ?? '');
  const conflicts = [];
  let blanks = 0;

  currentRaw.forEach((raw, index) => {
    if (isNullish(raw)) {
      blanks += 1;
      return;
    }
    const parsed = parseNumber(raw);
    if (parsed === null || Math.abs(parsed - proposed[index]) > 1e-9) {
      conflicts.push({
        header: TCX_IMPORT_HEADERS[index],
        current: raw,
        proposed: proposed[index],
      });
    }
  });

  const timing = resolveTimingUpdate(headers, row, validation.envelope.timing);
  const atomicUpdate = blanks > 0;
  const atomicRange = `${columnLetter(expectedAtomicStart)}${row.rowNumber}:${columnLetter(expectedAtomicStart + proposed.length - 1)}${row.rowNumber}`;
  const updates = [
    ...(atomicUpdate ? [{
      kind: 'atomic', range: atomicRange, startColumnIndex: expectedAtomicStart, values: proposed,
    }] : []),
    ...(timing.action === 'update' ? [{
      kind: 'timing', range: timing.range, startColumnIndex: timing.startColumnIndex, values: timing.values,
    }] : []),
  ];
  const base = {
    sessionId: envelope.sessionId,
    idempotencyKey: envelope.idempotencyKey,
    rowNumber: row.rowNumber,
    range: updates[0]?.range || atomicRange,
    startColumnIndex: expectedAtomicStart,
    values: proposed,
    current: Object.fromEntries(TCX_IMPORT_HEADERS.map((header, index) => [header, currentRaw[index]])),
    proposed: envelope.atomic,
    timing,
    updates,
  };

  if (conflicts.length) return result('conflict', { ...base, conflicts });
  if (!updates.length) return result('noop', base);
  return result('update', base);
}

export function buildSheetsBatchUpdate(reconciliation, sheetId) {
  if (reconciliation?.action === 'noop') return [];
  if (reconciliation?.action !== 'update') {
    throw new Error(`Nie można zbudować zapisu dla akcji: ${reconciliation?.action ?? 'brak'}`);
  }
  const numericSheetId = Number(sheetId);
  if (!Number.isInteger(numericSheetId) || numericSheetId < 0) throw new TypeError('sheetId musi być nieujemną liczbą całkowitą.');

  const updates = reconciliation.updates || [{
    startColumnIndex: reconciliation.startColumnIndex,
    values: reconciliation.values,
  }];
  return updates.map((update) => ({
    updateCells: {
      range: {
        sheetId: numericSheetId,
        startRowIndex: reconciliation.rowNumber - 1,
        endRowIndex: reconciliation.rowNumber,
        startColumnIndex: update.startColumnIndex,
        endColumnIndex: update.startColumnIndex + update.values.length,
      },
      rows: [{
        values: update.values.map((value) => (
          typeof value === 'number'
            ? { userEnteredValue: { numberValue: value } }
            : { userEnteredValue: { stringValue: String(value) } }
        )),
      }],
      fields: 'userEnteredValue',
    },
  }));
}
