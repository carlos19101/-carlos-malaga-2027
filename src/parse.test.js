import { describe, expect, it } from 'vitest';
import { exactValue, normalize, parseCSV, parseClock, parseDate, parseNumber, resolveLogSession } from './parse';

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
