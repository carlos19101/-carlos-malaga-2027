import { describe, expect, it } from 'vitest';
import { buildEpaAnalysis, EPA_ATHLETES, EPA_COACHES } from './epa';

describe('EPA', () => {
  it('contains the approved full academy', () => {
    expect(EPA_COACHES).toHaveLength(10);
    expect(EPA_ATHLETES).toHaveLength(8);
    expect(new Set([...EPA_COACHES, ...EPA_ATHLETES].map(({ id }) => id)).size).toBe(18);
  });

  it('keeps missing Strava and execution data explicit', () => {
    const result = buildEpaAnalysis({ activity: { distanceMeters: null }, session: { rpe: null } });
    expect(result.sources.state).toBe('missing');
    expect(result.sources.missing).toContain('aktywność Stravy');
    expect(result.sources.missing).toContain('pełna analiza TCX / Execution');
    expect(result.brief.distanceKm).toBeNull();
    expect(result.brief.rpe).toBeNull();
    expect(result.brief.targetPct).toBeNull();
  });

  it('uses exact supplied facts without changing missing HR into zero', () => {
    const result = buildEpaAnalysis({
      activity: { distanceMeters: 6800, movingSeconds: 3099, averageHeartRate: null, maxHeartRate: null },
      session: { name: 'Easy base', rpe: 1, pain: 0, legFatigue: 2 },
      execution: { status: 'ok', hrTargetPct: 90.1, aboveTargetPct: 4.5 },
    });
    expect(result.brief.distanceKm).toBe(6.8);
    expect(result.sources.stravaFacts).toEqual(['dystans', 'czas ruchu']);
    expect(result.sources.stravaFacts).not.toContain('HR średnie');
    expect(result.brief.copy).toContain('90,1%');
  });

  it('does not turn athletes into evaluators', () => {
    const result = buildEpaAnalysis({ activity: { distanceMeters: 5000 } });
    expect(result.athletes.every(({ state }) => state === 'CASE STUDY · BRAK PARY')).toBe(true);
    expect(result.athletes.every(({ verdict }) => verdict.includes('nie zmienia decyzji'))).toBe(true);
  });

  it('does not apply the Norwegian threshold lens to an easy run', () => {
    const result = buildEpaAnalysis({ session: { name: 'Easy base 5–6 km' } });
    expect(result.coaches.find(({ id }) => id === 'norwegian')?.state).toBe('NIE DOTYCZY TEJ SESJI');
  });

  it('never produces a competing Head Coach direction', () => {
    const result = buildEpaAnalysis({
      session: { name: 'Easy', rpe: 1, pain: 0, legFatigue: 2 },
      execution: { status: 'ok', hrTargetPct: 90.1, aboveTargetPct: 4.5 },
    });
    expect(result.synthesis.conclusion).toContain('nie nadpisuje werdyktu Głównego Trenera');
    expect(result).not.toHaveProperty('decision');
    expect(result).not.toHaveProperty('direction');
  });
});
