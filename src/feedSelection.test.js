import { expect, it } from 'vitest';
import { latestFeedRow } from './feedSelection.js';

it('wybiera dzień danych przed czasem późniejszej korekty starszego dnia', () => {
  const today = { Date: '2026-09-10', 'Last Synced': '2026-09-10 08:00' };
  expect(latestFeedRow([today, { Date: '2026-09-09', 'Last Synced': '2026-09-10 12:00' }])).toBe(today);
});
it('rozstrzyga ten sam dzień z dokładnością do sekund niezależnie od kolejności', () => {
  const newer = { Date: '2026-09-10', 'Last Synced': '10.09.2026 08:00:59' };
  const older = { Date: '2026-09-10', 'Last Synced': '2026-09-10 08:00:01' };
  expect(latestFeedRow([newer, older])).toBe(newer);
  expect(latestFeedRow([older, newer])).toBe(newer);
});
it('preferuje prawidłowy timestamp nad brakującym lub błędnym', () => {
  const valid = { Date: '2026-09-10', 'Last Synced': '2026-09-10 08:00:01' };
  for (const stamp of ['', '#N/A', '2026-09-10 08:00:99']) {
    expect(latestFeedRow([valid, { Date: valid.Date, 'Last Synced': stamp }])).toBe(valid);
  }
});
it('przy remisie wybiera ostatni wiersz i nie mutuje źródła', () => {
  const rows = [{ Date: '2026-09-10' }, { Date: '2026-09-10' }];
  const original = [...rows];
  expect(latestFeedRow(rows)).toBe(rows[1]);
  expect(rows).toEqual(original);
  expect(latestFeedRow()).toEqual({});
});
it('nie pozwala niedatowanemu wierszowi zastąpić datowanego', () => {
  const valid = { Date: '2026-09-10' };
  expect(latestFeedRow([valid, { Date: '#N/A', 'Last Synced': '2026-09-11 12:00' }])).toBe(valid);
});
