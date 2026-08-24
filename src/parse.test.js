import { describe, expect, it } from 'vitest';
import {
  exactValue,
  formatMetricNumber,
  isRecoveryActivity,
  normalize,
  normalizeActivityStatus,
  parseCSV,
  parseClock,
  parseDate,
  parseNumber,
  resolveLogSession,
  validateDailyFeed,
} from './parse';

describe('normalize', () => {
  it('normalizuje polskie znaki, podkreślenia i spacje', () => {
    expect(normalize('  Typ_treningu  ')).toBe('typ treningu');
    expect(normalize('Aktywność')).toBe('aktywnosc');
  });
});

describe('parseNumber', () => {
  it('obsługuje przecinek dziesiętny i białe separatory', () => {
    expect(parseNumber('11,17')).toBe(11.17);
    expect(parseNumber('1\u00a0234,5 kg')).toBe(1234.5);
  });
  it('nie zamienia czasu na liczbę', () => {
    expect(parseNumber('7:45')).toBeNull();
  });
});

describe('formatMetricNumber', () => {
  it('centralnie zaokrągla metryki do dwóch miejsc', () => {
    const fixed2 = { maximumFractionDigits: 2, minimumFractionDigits: 2 };
    expect(formatMetricNumber('6,80067 km', fixed2)).toBe('6,80');
    expect(formatMetricNumber('17,97067', fixed2)).toBe('17,97');
  });
  it('usuwa zbędne części dziesiętne z HR', () => {
    expect(formatMetricNumber('162,45', { maximumFractionDigits: 0 })).toBe('162');
  });
});

describe('parseClock', () => {
  it('czyta minuty i h:mm:ss jako czas, nie liczbę dziesiętną', () => {
    expect(parseClock('45:08')).toBeCloseTo(45 + 8 / 60, 5);
    expect(parseClock('1:02:30')).toBeCloseTo(62.5, 5);
  });
});

describe('parseDate', () => {
  it('czyta ISO-like bez zależności od Date.parse Safari', () => {
    const d = parseDate('2026-08-21 22:34');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(21);
    expect(d.getHours()).toBe(22);
    expect(d.getMinutes()).toBe(34);
  });
  it('czyta format pl-PL', () => {
    const d = parseDate('23.08.2026');
    expect(d.getDate()).toBe(23);
    expect(d.getMonth()).toBe(7);
  });
  it('odrzuca błędną datę', () => {
    expect(parseDate('32.08.2026')).toBeNull();
  });
});

describe('parseCSV', () => {
  it('obsługuje przecinek wewnątrz cudzysłowu', () => {
    const rows = parseCSV('Date,Weight,Note\n2026-08-21,"89,0","easy, ok"\n');
    expect(rows[0].Weight).toBe('89,0');
    expect(rows[0].Note).toBe('easy, ok');
  });
});

describe('exactValue', () => {
  it('nie wykonuje fuzzy matching', () => {
    const row = { 'Sleep Score': '82', Sleepiness: '9' };
    expect(exactValue(row, ['sleep score'])).toBe('82');
    expect(exactValue(row, ['sleep'])).toBe('');
  });
});

describe('resolveLogSession', () => {
  it('czyta exact-match Type', () => {
    expect(resolveLogSession({ Date: '2026-08-20', Type: 'Bieg', Name: 'Baza' }, ['type', 'typ treningu'])).toBe('Bieg');
  });
  it('czyta exact-match Activity', () => {
    expect(resolveLogSession({ Date: 'x', Activity: 'Siła' }, ['activity'])).toBe('Siła');
  });
  it('używa trzeciej kolumny tylko jako bounded legacy fallback', () => {
    expect(resolveLogSession({ A: '2026-08-20', B: '07:50', C: 'Recovery' }, ['type'])).toBe('Recovery');
  });
});

describe('status DONE i kategoria RECOVERY', () => {
  it('nie używa RECOVERY jako statusu zamkniętej sesji', () => {
    expect(normalizeActivityStatus('RECOVERY')).toBe('DONE');
    expect(normalizeActivityStatus('DONE')).toBe('DONE');
  });
  it('rozpoznaje Recovery jako osobną kategorię', () => {
    expect(isRecoveryActivity('Recovery', 'DONE')).toBe(true);
    expect(isRecoveryActivity('OFF / recovery', 'DONE')).toBe(true);
    expect(isRecoveryActivity('Bieg', 'DONE')).toBe(false);
  });
});

describe('validateDailyFeed', () => {
  const required = { status: 'YELLOW', hrv: '57', rhr: '46', weight: '89,2', date: '2026-08-24' };

  it('nie zgłasza DATA ERROR dla brakujących pól optional', () => {
    expect(validateDailyFeed({
      ...required,
      readiness: '',
      recovery: '',
      bodyBattery: '',
    })).toEqual({ ok: true, missing: [], suspicious: [] });
  });

  it('wymaga Status, HRV, RHR, Weight i daty rekordu', () => {
    const result = validateDailyFeed({});
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['Status', 'HRV', 'RHR', 'Weight', 'data']);
    expect(validateDailyFeed({ ...required, status: '—' }).missing).toContain('Status');
  });

  it('utrzymuje walidację zakresów dla dostępnych pól', () => {
    const result = validateDailyFeed({ ...required, recovery: '101' });
    expect(result.ok).toBe(false);
    expect(result.suspicious).toContain('Recovery=101 poza 0–100');
  });
});
