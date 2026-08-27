import { describe, expect, it } from 'vitest';
import { buildStaffPanel } from './staffPanel.js';

function input(overrides = {}) {
  return {
    decision: { status: 'GREEN' },
    plan: { session: 'Easy 6 km', targetHr: '150–162', rpeMax: '4' },
    execution: { status: 'ok' },
    daily: {
      state: 'calibrating', calibrationDays: '5/28',
      metrics: { hrv: { current: 68 }, rhr: { current: 47 } },
      bridgeSignal: { active: false }, issues: [],
    },
    recovery: { pain: 0, doms: 2, fatigue: 2, sleep: 80 },
    load: { km7: 17.97, srpe7: 450, srpe28: 700, loadRatio: null, calibrationDays: '8/28' },
    integrity: {
      validation: { ok: true, missing: [], suspicious: [] },
      verifierMismatches: [], dailyIssues: [], freshnessState: 'fresh',
    },
    ...overrides,
  };
}

describe('buildStaffPanel', () => {
  it('zawsze zwraca cztery role CORE w ustalonej kolejności', () => {
    const panel = buildStaffPanel(input());
    expect(panel.core.map(({ id }) => id)).toEqual(['running', 'physiology', 'recovery', 'load']);
    expect(panel.specialists).toEqual([]);
    expect(panel.dispute).toBeNull();
  });

  it('nie udaje gotowego baseline przed 28 dniami', () => {
    const panel = buildStaffPanel(input());
    const physiology = panel.core.find(({ id }) => id === 'physiology');
    expect(physiology.status).toBe('CALIBRATION');
    expect(physiology.direction).toBeNull();
    expect(physiology.evidence).toContainEqual(expect.objectContaining({ label: 'Baseline', value: 'KALIBRACJA 5/28' }));
  });

  it('aktywny sygnał pomostowy tworzy MODIFY oraz jawny SPÓR z zielonym Head Coachem', () => {
    const base = input();
    const panel = buildStaffPanel(input({
      daily: { ...base.daily, bridgeSignal: { active: true } },
    }));
    expect(panel.core.find(({ id }) => id === 'physiology')).toMatchObject({ status: 'YELLOW', direction: 'MODIFY' });
    expect(panel.dispute.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'GŁÓWNY TRENER', value: 'TRENUJ ZGODNIE Z PLANEM' }),
      expect.objectContaining({ label: 'FIZJOLOG', value: 'KONTROLUJ OBCIĄŻENIE' }),
    ]));
  });

  it('czerwony sygnał bólowy nie jest diagnozą, ale nie pozwala ukryć rozbieżności z GO', () => {
    const panel = buildStaffPanel(input({ recovery: { pain: 4, doms: 2, fatigue: 2, sleep: 80 } }));
    const recovery = panel.core.find(({ id }) => id === 'recovery');
    expect(recovery).toMatchObject({ status: 'RED', direction: 'STOP' });
    expect(recovery.interpretation).toContain('nie jest diagnoza medyczna');
    expect(panel.dispute).not.toBeNull();
  });

  it('brak deklaracji zawodnika pozostaje brakiem, a nie zielonym sygnałem', () => {
    const panel = buildStaffPanel(input({ recovery: { sleep: 80 } }));
    const recovery = panel.core.find(({ id }) => id === 'recovery');
    expect(recovery.status).toBe('INCOMPLETE');
    expect(recovery.direction).toBeNull();
    expect(recovery.evidence[0].value).toBe('brak deklaracji');
  });

  it('uruchamia DATA STEWARD tylko przy rzeczywistym problemie danych', () => {
    const panel = buildStaffPanel(input({
      integrity: {
        validation: { ok: false, missing: ['HRV'], suspicious: [] },
        verifierMismatches: [{ severity: 'error' }],
        dailyIssues: [{ severity: 'warning' }],
        freshnessState: 'stale',
      },
    }));
    expect(panel.specialists).toHaveLength(1);
    expect(panel.specialists[0]).toMatchObject({ id: 'data', status: 'RED' });
  });

  it('DATA ERROR w Execution aktywuje specjalistę danych', () => {
    const panel = buildStaffPanel(input({ execution: { status: 'data-error' } }));
    expect(panel.specialists[0].evidence).toContainEqual(expect.objectContaining({ label: 'Execution', value: 'DATA ERROR' }));
  });

  it('zgodne MODIFY Head Coacha i domeny nie jest oznaczane jako spór', () => {
    const panel = buildStaffPanel(input({
      decision: { status: 'YELLOW' },
      recovery: { pain: 1, doms: 2, fatigue: 2, sleep: 80 },
    }));
    expect(panel.core.find(({ id }) => id === 'recovery').direction).toBe('MODIFY');
    expect(panel.dispute).toBeNull();
  });

  it('nie interpretuje braku dzisiejszej sesji jako dnia wolnego', () => {
    const panel = buildStaffPanel(input({ plan: null }));
    const running = panel.core.find(({ id }) => id === 'running');
    expect(running.status).toBe('INFO');
    expect(running.interpretation).toContain('nie jest automatycznie dzień wolny');
  });

  it('odróżnia niewiarygodne RPE od zwykłej kalibracji historii', () => {
    const panel = buildStaffPanel(input({
      load: { km7: 13.6, srpe7: 0, srpe28: 0, loadRatio: null, ratioStatus: 'unreliable-internal-load', calibrationDays: '28/28' },
    }));
    const load = panel.core.find(({ id }) => id === 'load');
    expect(load).toMatchObject({ status: 'INCOMPLETE' });
    expect(load.evidence).toContainEqual(expect.objectContaining({ label: 'Load ratio', value: 'WYŁĄCZONE — RPE/sRPE niepełne' }));
  });
});
