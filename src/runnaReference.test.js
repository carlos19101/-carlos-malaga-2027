import { describe, it, expect } from 'vitest';
import { loadRunnaReference, parseRunnaReference, referenceDays, referencePlanContext, referenceWeekIndex, serializeRunnaReference, RUNNA_REFERENCE_VERSION } from './runnaReference.js';

const fixture = () => ({ version: RUNNA_REFERENCE_VERSION, title: 'Plan testowy', sourceLabel: 'Dane syntetyczne', capturedOn: '2026-09-23', weeks: [
  { number: 3, start: '2026-09-21', totalKm: 12, sessions: [{ day: 0, type: 'easy', km: 5 }, { day: 4, type: 'tempo', km: 7 }] },
  { number: 4, start: '2026-09-28', totalKm: 8.5, sessions: [{ day: 6, type: 'long', km: 8.5 }] },
] });
const parse = (v) => parseRunnaReference(JSON.stringify(v));

describe('Runna reference boundary', () => {
  const sourceSession = { date: '2026-09-23', source: 'reference', type: 'intervals', km: 8.1 };
  it('does not silently replace an amended easy plan with reference intervals', () => {
    const rows = [{Data:'2026-09-23', Rano:'Easy 9 km', Status:'PLANNED', 'Cel HR':'145–158'}];
    const result = referencePlanContext(sourceSession, rows, true);
    expect(result.state).toBe('unlinked'); expect(result.entries[0]).toMatchObject({titles:['Easy 9 km'],hr:'145–158'});
    expect(sourceSession.type).toBe('intervals'); expect(rows[0].Rano).toBe('Easy 9 km');
  });
  it('keeps duplicate source rows visible instead of choosing a target', () => {
    const result = referencePlanContext(sourceSession, [{Data:'2026-09-23',Rano:'Easy A'},{Data:'2026-09-23',Rano:'Easy B'}], true);
    expect(result.state).toBe('ambiguous'); expect(result.entries).toHaveLength(2);
  });
  it('does not treat matching date and title as proof of linkage', () => {
    expect(referencePlanContext(sourceSession, [{Data:'2026-09-23',Rano:'Interwały 8,1 km'}], true).state).toBe('unlinked');
  });
  it('does not declare cached source current', () => {
    expect(referencePlanContext(sourceSession, [{Data:'2026-09-23',Rano:'Easy'}], false)).toEqual({state:'unavailable',entries:[],undated:0});
  });
  it('distinguishes missing date from a genuinely absent date match', () => {
    expect(referencePlanContext(sourceSession, [{Data:'25–30.09',Rano:'Easy'}], true).state).toBe('unknown');
    expect(referencePlanContext(sourceSession, [], true).state).toBe('missing');
  });
  it('does not attach running targets to recurring club appointments', () => {
    expect(referencePlanContext({date:'2026-09-23',source:'appointment'}, [], true)).toBe(null);
    expect(referencePlanContext(null)).toBe(null);
  });
  it('normalizes dates, identifiers and reference provenance without performance assumptions', () => {
    const p = parse(fixture());
    expect(p.weeks[0].sessions[0]).toEqual({ day: 0, date: '2026-09-21', type: 'easy', km: 5, id: 'runna:2026-09-21:easy', source: 'reference' });
    expect(p.weeks[0].end).toBe('2026-09-27');
    expect(p.weeks[0].sessions[0]).not.toHaveProperty('done');
  });
  it('round trips a normalized snapshot', () => { const p = parse(fixture()); expect(parseRunnaReference(serializeRunnaReference(p))).toEqual(p); });
  it('discards unknown source fields and inferred HR targets', () => {
    const f = fixture(); f.secret = 'not retained'; f.weeks[0].sessions[0].hrMax = 190;
    expect(parse(f)).not.toHaveProperty('secret'); expect(parse(f).weeks[0].sessions[0]).not.toHaveProperty('hrMax');
  });
  it.each([
    ['version', f => { f.version = 'v2'; }],
    ['empty weeks', f => { f.weeks = []; }],
    ['bad date', f => { f.capturedOn = '2026-02-30'; }],
    ['missing source', f => { delete f.sourceLabel; }],
    ['non Monday', f => { f.weeks[0].start = '2026-09-22'; }],
    ['duplicate week', f => { f.weeks[1].number = 3; }],
    ['duplicate start', f => { f.weeks[1].start = f.weeks[0].start; }],
    ['wrong numbering', f => { f.weeks[1].number = 7; }],
    ['empty sessions', f => { f.weeks[0].sessions = []; }],
    ['duplicate day', f => { f.weeks[0].sessions[1].day = 0; }],
    ['invalid day', f => { f.weeks[0].sessions[0].day = 7; }],
    ['unknown type', f => { f.weeks[0].sessions[0].type = 'unrecognized'; }],
    ['zero km', f => { f.weeks[0].sessions[0].km = 0; }],
    ['null km', f => { f.weeks[0].sessions[0].km = null; }],
    ['string km', f => { f.weeks[0].sessions[0].km = '5'; }],
    ['incorrect sum', f => { f.weeks[0].totalKm = 14; }],
    ['missing sum', f => { delete f.weeks[0].totalKm; }],
  ])('rejects %s rather than silently fabricating a plan', (_, mutate) => { const f = fixture(); mutate(f); expect(() => parse(f)).toThrow(); });
  it.each(['not JSON', 'null', '{}', 'x'.repeat(100001)])('rejects malformed or oversized input', (input) => { expect(() => parseRunnaReference(input)).toThrow(); });
  it('leaves missing weeks absent and chooses the nearest available week', () => {
    const f = fixture(); f.weeks[1].number = 5; f.weeks[1].start = '2026-10-05'; const p = parse(f);
    expect(p.weeks).toHaveLength(2); expect(referenceWeekIndex(p, '2026-09-29')).toBe(1);
  });
  it.each([['2026-09-01',0],['2026-09-27',0],['2026-09-28',1],['2027-04-01',1]])('selects the week for %s', (day, index) => expect(referenceWeekIndex(parse(fixture()), day)).toBe(index));
  it('uses the Warsaw calendar date at midnight', () => expect(referenceWeekIndex(parse(fixture()), new Date('2026-09-27T22:01:00Z'))).toBe(1));
  it('adds two appointments without changing the imported running plan', () => {
    const p = parse(fixture()); const before = JSON.stringify(p); const days = referenceDays(p.weeks[0]);
    expect(days).toHaveLength(7); expect(days.flatMap(d => d.sessions).filter(s => s.source === 'appointment')).toHaveLength(2);
    expect(days[1].sessions[0]).toMatchObject({ type: 'boxing', start: '20:00', end: '22:00' });
    expect(JSON.stringify(p)).toBe(before);
    expect(referenceDays(p.weeks[0], false).flatMap(d => d.sessions)).toHaveLength(2);
  });
  it('handles DST without shifting the week', () => {
    const f = fixture(); f.weeks = [{ ...f.weeks[0], start: '2026-10-19' }]; const days = referenceDays(parse(f).weeks[0]);
    expect(days.map(d => d.date)).toEqual(['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25']);
  });
  it('fails closed on corrupted or inaccessible local data', () => {
    expect(loadRunnaReference({ getItem: () => null })).toEqual({ reference: null, error: '' });
    expect(loadRunnaReference({ getItem: () => '{bad' }).reference).toBe(null);
    expect(loadRunnaReference({ getItem: () => { throw new Error(); } }).error).toBeTruthy();
  });
});
