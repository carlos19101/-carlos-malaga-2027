import { isNullish, normalize, parseDate, parseNumber } from './parse.js';
import { stringifyHrTargetStages, tryParseHrTargetStages } from './hrTargetStages.js';
import { analyzeTcx, analyzeTcxStages, formatTcxActivityTiming } from './tcx.js';

export const TCX_IMPORT_SCHEMA = 'carlos.tcx-import.v1';
export const TCX_STAGED_IMPORT_SCHEMA = 'carlos.tcx-import.v2';
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
export const TCX_STAGE_HEADER = 'HR_Target_Stages_JSON';
export const TCX_STAGED_ATOMIC_HEADERS = TCX_IMPORT_HEADERS.slice(2);
const PLAN_DATE_HEADER = 'Data';

const TCX_IMPORT_ID_PATTERN = /^tcx-v[12]-[0-9a-f]{8}$/;
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
  const stagedTarget = tryParseHrTargetStages(options.targetStages);
  const analysis = stagedTarget
    ? analyzeTcxStages(tcxText, stagedTarget, {
      ...(options.maxGapSeconds === undefined ? {} : { maxGapSeconds: options.maxGapSeconds }),
    })
    : analyzeTcx(tcxText, {
      targetMin: options.targetMin,
      targetMax: options.targetMax,
      ...(options.maxGapSeconds === undefined ? {} : { maxGapSeconds: options.maxGapSeconds }),
    });
  const timing = formatTcxActivityTiming(analysis.startedAt, options.timeZone);
  const atomicHeaders = stagedTarget ? TCX_STAGED_ATOMIC_HEADERS : TCX_IMPORT_HEADERS;
  const values = [
    ...(stagedTarget ? [] : [analysis.targetMin, analysis.targetMax]),
    analysis.timeInTarget,
    analysis.timeAboveTarget,
    analysis.timeBelowTarget,
    analysis.analyzedDuration,
  ];
  const schema = stagedTarget ? TCX_STAGED_IMPORT_SCHEMA : TCX_IMPORT_SCHEMA;
  const idempotencyKey = `tcx-v${stagedTarget ? 2 : 1}-${valueFingerprint([
    sessionId, sourceSha256 || 'NO_SHA256', timing.localDate, timing.localTime,
    ...(stagedTarget ? [stringifyHrTargetStages(stagedTarget)] : []), ...values,
  ])}`;

  return {
    schema,
    sessionId,
    sourceSha256: sourceSha256 || null,
    idempotencyKey,
    timing,
    methodology: {
      intervalOwner: 'previous-trackpoint',
      inclusiveTarget: true,
      maxGapSeconds: analysis.maxGapSeconds,
      lastTrackpointGetsDuration: false,
      ...(stagedTarget ? { targetMode: 'staged', stageClock: 'elapsed-from-first-trackpoint' } : {}),
    },
    ...(stagedTarget ? { targetStages: stringifyHrTargetStages(stagedTarget) } : {}),
    atomic: Object.fromEntries(atomicHeaders.map((header, index) => [header, values[index]])),
    diagnostics: {
      lapCount: analysis.lapCount,
      trackpointCount: analysis.trackpointCount,
      analyzedIntervals: analysis.analyzedIntervals,
      excludedGaps: analysis.excludedGaps,
      excludedDuration: analysis.excludedDuration,
      nonPositiveIntervals: analysis.nonPositiveIntervals,
      ...(stagedTarget ? { unmappedDuration: analysis.unmappedDuration, plannedDuration: analysis.plannedDuration } : {}),
    },
  };
}

export function validateTcxImportEnvelope(envelope = {}) {
  const staged = envelope.schema === TCX_STAGED_IMPORT_SCHEMA;
  if (envelope.schema !== TCX_IMPORT_SCHEMA && !staged) {
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

  const atomicHeaders = staged ? TCX_STAGED_ATOMIC_HEADERS : TCX_IMPORT_HEADERS;
  const proposed = atomicHeaders.map((header) => envelope.atomic?.[header]);
  const invalidAtomicHeaders = atomicHeaders.filter((_, index) => (
    !Number.isFinite(proposed[index]) || proposed[index] < 0
  ));
  if (invalidAtomicHeaders.length) return result('contract-error', { invalidAtomicHeaders });

  const [targetMin, targetMax, timeInTarget, timeAboveTarget, timeBelowTarget, analyzedDuration] = staged
    ? [null, null, ...proposed]
    : proposed;
  if (!staged && (targetMin < 20 || targetMax > 250 || targetMin >= targetMax)) {
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
  if (staged && (!tryParseHrTargetStages(envelope.targetStages)
    || methodology.targetMode !== 'staged'
    || methodology.stageClock !== 'elapsed-from-first-trackpoint')) {
    return result('contract-error', { reason: 'Nieprawidłowy etapowy cel HR TCX.' });
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

export function resolvePlanStagedTarget(logTable = {}, planTable = {}, sessionIdValue = '') {
  const sessionId = String(sessionIdValue ?? '').trim();
  const logHeaders = Array.isArray(logTable.headers) ? logTable.headers : [];
  const logRows = Array.isArray(logTable.rows) ? logTable.rows : [];
  const planHeaders = Array.isArray(planTable.headers) ? planTable.headers : [];
  const planRows = Array.isArray(planTable.rows) ? planTable.rows : [];
  const sessionIndex = headerIndex(logHeaders, SESSION_ID_HEADER);
  const logDateIndex = headerIndex(logHeaders, 'Date');
  const planDateIndex = headerIndex(planHeaders, PLAN_DATE_HEADER);
  const stageIndex = headerIndex(planHeaders, TCX_STAGE_HEADER);
  const missingHeaders = [
    ...(sessionIndex === -1 ? [SESSION_ID_HEADER] : []),
    ...(logDateIndex === -1 ? ['Date'] : []),
    ...(planDateIndex === -1 ? [PLAN_DATE_HEADER] : []),
    ...(stageIndex === -1 ? [TCX_STAGE_HEADER] : []),
  ];
  if (missingHeaders.length) return result('contract-error', { missingHeaders });

  const logMatches = logRows.filter(({ values = [] }) => String(values[sessionIndex] ?? '').trim() === sessionId);
  if (!logMatches.length) return result('missing-session', { sessionId });
  if (logMatches.length > 1) return result('duplicate-session', { sessionId, rowNumbers: logMatches.map(({ rowNumber }) => rowNumber) });
  const logRow = logMatches[0];
  const date = localDateKey(logRow.values?.[logDateIndex]);
  if (!date) return result('contract-error', { reason: 'Sesja Training Log nie ma czytelnej daty.' });

  const planMatches = planRows.filter(({ values = [] }) => localDateKey(values[planDateIndex]) === date);
  if (!planMatches.length) return result('contract-error', { reason: `Plan nie zawiera wpisu z datą ${date}.` });
  const stagedMatches = planMatches.map((row) => ({
    row,
    stages: tryParseHrTargetStages(row.values?.[stageIndex]),
  })).filter(({ stages }) => stages);
  if (!stagedMatches.length) return result('contract-error', { reason: `Plan ${date} nie zawiera etapu HR do importu TCX.` });
  if (stagedMatches.length > 1) {
    return result('contract-error', {
      reason: `Plan ${date} zawiera więcej niż jeden etapowy cel HR; import został zablokowany.`,
      rowNumbers: stagedMatches.map(({ row }) => row.rowNumber),
    });
  }
  const match = stagedMatches[0];
  return result('resolved', {
    sessionId,
    logRowNumber: logRow.rowNumber,
    planRowNumber: match.row.rowNumber,
    targetStages: stringifyHrTargetStages(match.stages),
  });
}

export function reconcileTcxImport(table = {}, envelope = {}, options = {}) {
  const validation = validateTcxImportEnvelope(envelope);
  if (validation.action !== 'valid') return validation;
  const staged = validation.envelope.schema === TCX_STAGED_IMPORT_SCHEMA;
  const atomicHeaders = staged ? TCX_STAGED_ATOMIC_HEADERS : TCX_IMPORT_HEADERS;

  const headers = Array.isArray(table.headers) ? table.headers : [];
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const sessionIndex = headerIndex(headers, SESSION_ID_HEADER);
  const atomicIndexes = atomicHeaders.map((header) => headerIndex(headers, header));
  const stageIndex = headerIndex(headers, TCX_STAGE_HEADER);
  const missingHeaders = [
    ...(sessionIndex === -1 ? [SESSION_ID_HEADER] : []),
    ...atomicHeaders.filter((_, index) => atomicIndexes[index] === -1),
    ...(staged && stageIndex === -1 ? [TCX_STAGE_HEADER] : []),
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
  const proposed = atomicHeaders.map((header) => envelope.atomic[header]);
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
        header: atomicHeaders[index],
        current: raw,
        proposed: proposed[index],
      });
    }
  });

  let stageUpdate = null;
  if (staged) {
    const currentStages = tryParseHrTargetStages(row.values?.[stageIndex]);
    const proposedStages = stringifyHrTargetStages(validation.envelope.targetStages);
    const currentStageText = currentStages ? stringifyHrTargetStages(currentStages) : null;
    if (currentStageText !== proposedStages) {
      if (!currentStageText && options.allowStageBootstrap === true) {
        stageUpdate = {
          kind: 'target-stage',
          range: `${columnLetter(stageIndex)}${row.rowNumber}`,
          startColumnIndex: stageIndex,
          values: [proposedStages],
        };
      } else {
        conflicts.push({
          header: TCX_STAGE_HEADER,
          current: row.values?.[stageIndex] ?? '',
          proposed: proposedStages,
        });
      }
    }
  }

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
    ...(stageUpdate ? [stageUpdate] : []),
  ];
  const base = {
    sessionId: envelope.sessionId,
    idempotencyKey: envelope.idempotencyKey,
    rowNumber: row.rowNumber,
    range: updates[0]?.range || atomicRange,
    startColumnIndex: expectedAtomicStart,
    values: proposed,
    current: Object.fromEntries(atomicHeaders.map((header, index) => [header, currentRaw[index]])),
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
