import { describe, it, expect } from 'vitest';
import { parseNumber, parseClock, parseDate, parseCSV } from './parse';

describe('parseNumber — locale pl-PL', () => {
  it('przecinek dziesiętny', () => expect(parseNumber('11,17')).toBe(11.17));
  it('zero po przecinku', () => expect(parseNumber('89,0')).toBe(89));
  it('NBSP jako tysiące', () => expect(parseNumber('1\u00A0234,5')).toBe(1234.5));
  it('spacja jako tysiące', () => expect(parseNumber('1 234,5')).toBe(1234.5));
  it('jednostka w komórce', () => expect(parseNumber('48 bpm')).toBe(48));
  it('pusta komórka to null, NIE zero', () => expect(parseNumber('')).toBeNull());
  it('myślnik', () => expect(parseNumber('—')).toBeNull());
  it('błąd Sheets', () => expect(parseNumber('#N/A')).toBeNull());
  it('czas NIE jest liczbą', () => expect(parseNumber('7:45')).toBeNull());
  it('czas długi', () => expect(parseNumber('1:25:19')).toBeNull());
});

describe('parseClock', () => {
  it('godziny:minuty', () => expect(parseClock('7:45')).toBe(465));
  it('odrzuca liczbę', () => expect(parseClock('745')).toBeNull());
});

describe('parseDate', () => {
  it('ISO', () => expect(parseDate('2026-08-22').getMonth()).toBe(7));
  it('pl', () => expect(parseDate('22.08.2026').getDate()).toBe(22));
  it('z godziną', () => expect(parseDate('22.08.2026 14:30').getHours()).toBe(14));
  it('odrzuca miesiąc > 12', () => expect(parseDate('8-22-2026')).toBeNull());
  it('odrzuca 32 dzień', () => expect(parseDate('32.01.2026')).toBeNull());
  it('śmieci', () => expect(parseDate('brak')).toBeNull());
});

describe('parseCSV', () => {
  it('obsługuje przecinek wewnątrz cudzysłowu', () => {
    expect(parseCSV('A,B\n"11,17",x\n')[0]).toEqual({ A: '11,17', B: 'x' });
  });
});
