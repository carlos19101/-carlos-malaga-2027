import { describe, expect, it } from 'vitest';
import {
  classifyCoachStatus,
  daysUntilRace,
  metricDeltaPercent,
  raceGoalMatrix,
  resolveCoachDecision,
  sourceFreshness,
  summarizeLoad,
} from './performance';

describe('coach decision', () => {
  it('Head Coach z arkusza ma pierwszeństwo przed automatem', () => {
    const d = resolveCoachDecision({
      sheetStatus: 'YELLOW',
      sheetDecision: 'Bieg odpuszczony — DOMS.',
      fallbackInput: { recovery: 90, sleep: 90, dataOk: true },
    });
    expect(d.status).toBe('YELLOW');
    expect(d.recommendation).toContain('DOMS');
    expect(d.source).toBe('head-coach');
  });

  it('fallback daje YELLOW dla Recovery 57', () => {
    const d = classifyCoachStatus({ recovery: 57, sleep: 82, hrv: 54, hrv7d: 62, pain: 0, dataOk: true });
    expect(d.status).toBe('YELLOW');
  });

  it('ból >=4 daje RED w fallbacku', () => {
    expect(classifyCoachStatus({ recovery: 90, sleep: 90, pain: 4, dataOk: true }).status).toBe('RED');
  });
});

describe('metricDeltaPercent', () => {
  it('porównuje HRV do indywidualnego 7d baseline', () => {
    expect(metricDeltaPercent(54, 62)).toBeCloseTo(-12.9032, 3);
  });
});

describe('summarizeLoad', () => {
  it('sumuje 7 i 28 dni bez wymuszania ratio przy małej próbce', () => {
    const now = new Date('2026-08-22T12:00:00');
    const r = summarizeLoad([
      { date: '2026-08-20', srpe: 215 },
      { date: '2026-08-18', srpe: 85 },
    ], now);
    expect(r.sum7).toBe(300);
    expect(r.sum28).toBe(300);
    expect(r.ratio).toBeNull();
  });
});

describe('sourceFreshness', () => {
  it('oznacza stary pomiar jako stale na podstawie czasu źródłowego, nie czasu kliknięcia refresh', () => {
    const f = sourceFreshness(new Date('2026-08-20T20:00:00'), new Date('2026-08-22T20:30:00'));
    expect(f.state).toBe('stale');
  });
  it('oznacza świeży pomiar jako fresh', () => {
    expect(sourceFreshness(new Date('2026-08-22T07:00:00'), new Date('2026-08-22T20:30:00')).state).toBe('fresh');
  });
});

describe('Málaga race matrix', () => {
  it('trzyma oficjalny dystans 21.0975 km i stabilne splity', () => {
    const [a, b, c] = raceGoalMatrix();
    expect(a).toMatchObject({ finish: '1:45:00', pace: '4:59/km', km5: '24:53', km10: '49:46', km15: '1:14:39' });
    expect(b).toMatchObject({ finish: '1:50:00', pace: '5:13/km', km5: '26:04', km10: '52:08', km15: '1:18:12' });
    expect(c).toMatchObject({ finish: '2:00:00', pace: '5:41/km', km5: '28:26', km10: '56:53', km15: '1:25:19' });
  });
  it('liczy dni kalendarzowe do 7 marca 2027', () => {
    expect(daysUntilRace(new Date('2026-08-22T20:30:00'))).toBe(197);
  });
  it('liczy lokalne dni kalendarzowe przez jesienne przejście DST', () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'Europe/Warsaw';
    try {
      expect(daysUntilRace(new Date('2026-10-24T20:30:00'), '2026-10-26')).toBe(2);
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });
});
