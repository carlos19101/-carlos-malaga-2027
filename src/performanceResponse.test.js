import { describe, expect, it } from 'vitest';
import { computePerformanceResponse, PERFORMANCE_RESPONSE_CONTRACT } from './performanceResponse.js';

function entry(id, options = {}) {
  return {
    id,
    date: options.date || '2026-08-25',
    timestamp: options.timestamp || `${options.date || '2026-08-25'} 08:00`,
    status: options.status || 'GREEN',
    recommendation: options.recommendation || 'Easy bieg',
    outcome: {
      state: options.outcomeState || 'observed',
      sessions: options.sessions ?? [{ executionStatus: 'ok' }],
      reaction: options.reaction === undefined ? {
        date: '2026-08-26', hrv: 60, rhr: 48, hrvDelta: 2, rhrDelta: -1,
      } : options.reaction,
    },
  };
}

describe('computePerformanceResponse', () => {
  it('nie tworzy obserwacji bez decyzji z wykonaną później sesją', () => {
    const result = computePerformanceResponse({ entries: [entry('before', { outcomeState: 'session-before-decision' })] });
    expect(result).toMatchObject({ state: 'missing', observedSessions: 0, completePairs: 0, calibration: { sample: '0/6' } });
  });

  it('pozostaje w kalibracji, gdy brakuje kompletnej reakcji następnego dnia', () => {
    const result = computePerformanceResponse({ entries: [
      entry('complete'),
      entry('partial', { reaction: { date: '2026-08-27', hrv: 61, rhr: null, hrvDelta: 1, rhrDelta: null } }),
      entry('missing', { reaction: null }),
    ] });

    expect(result).toMatchObject({
      state: 'calibrating', observedSessions: 3, completePairs: 1, partialReaction: 1, missingReaction: 1,
      calibration: { sample: '1/6' },
    });
  });

  it('liczy wyłącznie jawne statusy Execution i nie wymyśla brakujących', () => {
    const result = computePerformanceResponse({ entries: [
      entry('one', { sessions: [{ executionStatus: 'over' }, { executionStatus: 'no-data' }] }),
      entry('two', { sessions: [{ executionStatus: 'under' }] }),
    ] });

    expect(result.execution).toEqual({ observed: 2, ok: 0, over: 1, under: 1 });
  });

  it('przechodzi do obserwacji dopiero po wymaganej liczbie kompletnych par', () => {
    const entries = Array.from({ length: 6 }, (_, index) => entry(`pair-${index}`, {
      date: `2026-08-${String(20 + index).padStart(2, '0')}`,
      timestamp: `2026-08-${String(20 + index).padStart(2, '0')} 08:00`,
    }));
    const result = computePerformanceResponse({ entries });
    expect(result).toMatchObject({ state: 'observed', completePairs: 6, calibration: { sample: '6/6' } });
    expect(result.pairs[0].id).toBe('pair-5');
  });

  it('publikuje granicę metodologiczną zamiast automatycznej rekomendacji', () => {
    expect(PERFORMANCE_RESPONSE_CONTRACT.purpose).toContain('nie zmienia automatycznie planu');
    expect(computePerformanceResponse({ entries: [] }).methodology).toContain('nie oznacza przyczynowości');
  });
});
