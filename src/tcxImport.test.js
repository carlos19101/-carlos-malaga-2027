import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildSheetsBatchUpdate,
  createTcxImport,
  parseTrainingLogCsv,
  reconcileTcxImport,
  resolveTcxTarget,
  TCX_IMPORT_HEADERS,
} from './tcxImport.js';

const fixture = readFileSync(new URL('../test/fixtures/2026-08-23-run-01.sanitized.tcx', import.meta.url), 'utf8');

function table(atomicValues = ['', '', '', '', '', ''], options = {}) {
  const headers = ['Date', 'Session_ID', ...TCX_IMPORT_HEADERS];
  const rowNumber = options.rowNumber ?? 2;
  const rows = [
    { rowNumber, values: ['2026-08-23', '2026-08-23-run-01', ...atomicValues] },
  ];
  if (options.duplicate) rows.push({ rowNumber: rowNumber + 1, values: [...rows[0].values] });
  return { headers, rows };
}

function liveTable(atomicValues = ['', '', '', '', '', ''], rowNumber = 7) {
  const headers = [
    'Date', 'Time', 'Type', 'Name', 'Distance_km', 'Duration_min', 'Duration_text', 'Pace',
    'HR_avg', 'HR_max', 'Power_avg', 'Power_max', 'RPE', 'sRPE', 'Pain', 'Garmin_Load',
    'TE_Aerobic', 'TE_Anaerobic', 'Cadence', 'GCT_ms', 'Notes', 'Source', 'Status', 'Session_ID',
    ...TCX_IMPORT_HEADERS,
  ];
  const values = Array(headers.length).fill('');
  values[23] = '2026-08-23-run-01';
  atomicValues.forEach((value, index) => { values[24 + index] = value; });
  return { headers, rows: [{ rowNumber, values }] };
}

const envelope = createTcxImport(fixture, {
  sessionId: '2026-08-23-run-01',
  targetMin: 150,
  targetMax: 162,
  sourceSha256: 'AB860110AA046542ECC9FABAC31DB380C561F466B55C42FE3F9B9B0C40A148D1',
});

describe('createTcxImport', () => {
  it('buduje wersjonowaną kopertę z odtwarzalnymi atomami', () => {
    expect(envelope).toMatchObject({
      schema: 'carlos.tcx-import.v1',
      sessionId: '2026-08-23-run-01',
      sourceSha256: 'AB860110AA046542ECC9FABAC31DB380C561F466B55C42FE3F9B9B0C40A148D1',
      idempotencyKey: expect.stringMatching(/^tcx-v1-[0-9a-f]{8}$/),
      atomic: {
        HR_Target_Min_bpm: 150,
        HR_Target_Max_bpm: 162,
        Time_In_Target_s: 1169,
        Time_Above_Target_s: 1376,
        Time_Below_Target_s: 87,
        HR_Analyzed_Duration_s: 2632,
      },
    });
  });
});

describe('reconcileTcxImport', () => {
  it('zwraca update dla pustych pól atomowych', () => {
    expect(reconcileTcxImport(table(), envelope)).toMatchObject({
      action: 'update',
      rowNumber: 2,
      range: 'C2:H2',
      values: [150, 162, 1169, 1376, 87, 2632],
    });
  });

  it('uzupełnia puste czasy przy zgodnym celu zapisanym już w wierszu', () => {
    expect(reconcileTcxImport(table([150, 162, '', '', '', '']), envelope)).toMatchObject({
      action: 'update', values: [150, 162, 1169, 1376, 87, 2632],
    });
  });

  it('ponowny import identycznych danych jest no-op', () => {
    expect(reconcileTcxImport(table([150, 162, 1169, 1376, 87, 2632]), envelope))
      .toMatchObject({ action: 'noop', rowNumber: 2 });
  });

  it('nie nadpisuje istniejącej innej metodologii ani celu', () => {
    const result = reconcileTcxImport(table([149, 162, 1171, 1380, 82, 2633]), envelope);
    expect(result).toMatchObject({
      action: 'conflict',
      conflicts: expect.arrayContaining([
        expect.objectContaining({ header: 'HR_Target_Min_bpm', current: 149, proposed: 150 }),
        expect.objectContaining({ header: 'Time_In_Target_s', current: 1171, proposed: 1169 }),
      ]),
    });
  });

  it('blokuje brak i duplikat Session_ID', () => {
    expect(reconcileTcxImport(table(), { ...envelope, sessionId: 'missing' }))
      .toEqual({ action: 'missing-session', sessionId: 'missing' });
    expect(reconcileTcxImport(table([], { duplicate: true }), envelope))
      .toMatchObject({ action: 'duplicate-session', rowNumbers: [2, 3] });
  });

  it('blokuje brak wymaganej kolumny', () => {
    const current = table();
    current.headers = current.headers.filter((header) => header !== 'Session_ID');
    expect(reconcileTcxImport(current, envelope)).toMatchObject({
      action: 'contract-error', missingHeaders: ['Session_ID'],
    });
  });

  it('blokuje niepełną kopertę zamiast generować zapis undefined', () => {
    const broken = { ...envelope, atomic: { ...envelope.atomic, Time_In_Target_s: undefined } };
    expect(reconcileTcxImport(table(), broken)).toEqual({
      action: 'contract-error', invalidAtomicHeaders: ['Time_In_Target_s'],
    });
  });
});

describe('resolveTcxTarget', () => {
  it('pobiera cel HR z jednego wiersza Session_ID', () => {
    expect(resolveTcxTarget(table([150, 162, '', '', '', '']), '2026-08-23-run-01')).toEqual({
      action: 'resolved',
      sessionId: '2026-08-23-run-01',
      rowNumber: 2,
      targetMin: 150,
      targetMax: 162,
    });
  });

  it('blokuje brak i nieprawidłowy cel', () => {
    expect(resolveTcxTarget(table(), '2026-08-23-run-01')).toMatchObject({ action: 'missing-target' });
    expect(resolveTcxTarget(table([162, 150, '', '', '', '']), '2026-08-23-run-01'))
      .toMatchObject({ action: 'invalid-target', targetMin: 162, targetMax: 150 });
  });
});

describe('parseTrainingLogCsv', () => {
  it('zachowuje rzeczywisty numer wiersza mimo pustego rekordu', () => {
    const csv = [
      `Date,Session_ID,${TCX_IMPORT_HEADERS.join(',')}`,
      '2026-08-20,other,,,,,,',
      ',,,,,,,',
      '2026-08-23,2026-08-23-run-01,,,,,,',
    ].join('\n');
    const parsed = parseTrainingLogCsv(csv);
    expect(parsed.rows[2]).toMatchObject({ rowNumber: 4 });
    expect(reconcileTcxImport(parsed, envelope)).toMatchObject({ action: 'update', rowNumber: 4, range: 'C4:H4' });
  });
});

describe('buildSheetsBatchUpdate', () => {
  it('ogranicza zapis do jednego bloku atomowego w dopasowanym wierszu', () => {
    const reconciliation = reconcileTcxImport(liveTable([], 7), envelope);
    expect(reconciliation).toMatchObject({ action: 'update', range: 'Y7:AD7' });
    expect(buildSheetsBatchUpdate(reconciliation, 684258501)).toEqual([{
      updateCells: {
        range: {
          sheetId: 684258501,
          startRowIndex: 6,
          endRowIndex: 7,
          startColumnIndex: 24,
          endColumnIndex: 30,
        },
        rows: [{ values: [150, 162, 1169, 1376, 87, 2632]
          .map((numberValue) => ({ userEnteredValue: { numberValue } })) }],
        fields: 'userEnteredValue',
      },
    }]);
  });

  it('no-op nie generuje żadnego zapisu', () => {
    const reconciliation = reconcileTcxImport(table([150, 162, 1169, 1376, 87, 2632]), envelope);
    expect(buildSheetsBatchUpdate(reconciliation, 684258501)).toEqual([]);
  });
});
