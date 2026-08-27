import { describe, expect, it } from 'vitest';
import { auditTrainingLogTimes, parseTrainingLogTimestamp } from './trainingLogTiming.js';

describe('parseTrainingLogTimestamp', () => {
  it('łączy lokalną datę z godziną i sekundami', () => {
    const result = parseTrainingLogTimestamp('2026-08-25', '18:05:30');
    expect([result.getFullYear(), result.getMonth() + 1, result.getDate(), result.getHours(), result.getMinutes(), result.getSeconds()]).toEqual([2026, 8, 25, 18, 5, 30]);
  });

  it('odrzuca czas trwania i nieczytelną godzinę jako godzinę startu', () => {
    expect(parseTrainingLogTimestamp('2026-08-25', '51:39')).toBeNull();
    expect(parseTrainingLogTimestamp('2026-08-25', '')).toBeNull();
  });
});

describe('auditTrainingLogTimes', () => {
  it('raportuje tylko wpisy bez czytelnej godziny startu', () => {
    const issues = auditTrainingLogTimes([
      { date: '2026-08-25', time: '18:55', name: 'Easy' },
      { date: '2026-08-24', time: '', name: 'Recovery' },
      { date: '2026-08-23', time: '51:39', name: 'Bieg' },
    ]);
    expect(issues).toHaveLength(2);
    expect(issues.map(({ detail }) => detail)).toEqual(expect.arrayContaining([
      expect.stringContaining('brak godziny Time'),
      expect.stringContaining('nieczytelna godzina Time'),
    ]));
  });
});
