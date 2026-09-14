import { describe, expect, it } from 'vitest';
import { buildProgressReport } from './progressReport.js';

const run = (date, km, minutes, extra = {}) => ({ date, distanceKm: km, durationMinutes: minutes, type: 'Bieg', name: 'Easy', ...extra });

describe('raport progresu EPA', () => {
  it('zachowuje cel 1:30 bez blokady, gdy nie ma testu', () => {
    const report = buildProgressReport({ sessions: [run('2026-08-20', 5, 35), run('2026-08-22', 6, 42)] });
    expect(report.target).toMatchObject({ id: '1h30', label: '1:30', pace: '4:16/km' });
    expect(report.estimate.state).toBe('missing');
    expect(report.priorities.some(({ title }) => title.includes('Brak podstaw do automatycznej prognozy'))).toBe(true);
  });

  it('liczy prognozę wyłącznie z oznaczonego testu lub startu', () => {
    const report = buildProgressReport({ sessions: [
      run('2026-08-20', 10, 50, { name: 'Easy 10 km' }),
      run('2026-09-10', 10, 45, { name: 'Test 10 km' }),
    ] });
    expect(report.estimate).toMatchObject({ state: 'provisional', source: { name: 'Test 10 km', km: 10, durationSeconds: 2700 } });
    expect(report.estimate.predictedSeconds).toBeGreaterThan(5400);
    expect(report.estimate.targetGapSeconds).toBeGreaterThan(0);
  });

  it('porównuje dwa pełne okna 14 dni zamiast mieszać je z całą historią', () => {
    const report = buildProgressReport({ sessions: [
      run('2026-08-01', 5, 35), run('2026-08-03', 5, 35),
      run('2026-08-17', 6, 42), run('2026-08-20', 6, 42),
    ] });
    expect(report.history).toMatchObject({ recentKm: 12, previousKm: 10, volumeDeltaPct: 20 });
  });

  it('nie nazywa szybkiego easy dowodem formy i wykrywa wzorzec przekroczeń', () => {
    const sessions = ['2026-08-01', '2026-08-05', '2026-08-09', '2026-08-13', '2026-08-17', '2026-08-21']
      .map((date) => run(date, 6, 42));
    const execution = sessions.map(() => ({ isEasy: true, status: 'over', aboveTargetPct: 42 }));
    const report = buildProgressReport({ sessions, execution });
    expect(report.priorities.some(({ title }) => title === 'Dopilnuj easy')).toBe(true);
  });

  it('pokazuje historię tygodni i ocenia easy tylko przy porównywalnym HR', () => {
    const sessions = [
      run('2026-08-03', 5, 35, { hrAvg: 150 }), run('2026-08-05', 5, 35, { hrAvg: 150 }), run('2026-08-07', 5, 35, { hrAvg: 151 }),
      run('2026-08-24', 5, 33, { hrAvg: 151 }), run('2026-08-26', 5, 33, { hrAvg: 152 }), run('2026-08-28', 5, 33, { hrAvg: 150 }),
    ];
    const report = buildProgressReport({ sessions });
    expect(report.weekly.values).toHaveLength(2);
    expect(report.weekly.values[0]).toMatchObject({ km: 15, sessions: 3 });
    expect(report.easyTrend).toMatchObject({ state: 'potential-improvement', paceDeltaSeconds: -24, hrDelta: 1 });
  });

  it('nie udaje trendu easy przy zbyt małej próbce', () => {
    const report = buildProgressReport({ sessions: [run('2026-08-03', 5, 35, { hrAvg: 150 })] });
    expect(report.easyTrend).toMatchObject({ state: 'missing', sample: '1/6' });
  });

  it('nie porównuje easy o wyraźnie różnych dystansach', () => {
    const sessions = [
      run('2026-08-01', 4, 28, { hrAvg: 150 }), run('2026-08-03', 4, 28, { hrAvg: 150 }), run('2026-08-05', 4, 28, { hrAvg: 150 }),
      run('2026-08-20', 8, 56, { hrAvg: 150 }), run('2026-08-22', 8, 56, { hrAvg: 150 }), run('2026-08-24', 8, 56, { hrAvg: 150 }),
    ];
    expect(buildProgressReport({ sessions }).easyTrend).toMatchObject({ state: 'missing', sample: '3/6', referenceKm: 8 });
  });
});

