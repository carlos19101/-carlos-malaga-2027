import { describe, it, expect } from 'vitest';
import { feedbackCandidates, selectFeedbackCandidate } from './feedbackSelection.js';

describe('feedback session selection', () => {
  const run = id => ({ id, running: true });
  it('includes older sessions beyond the history display limit', () => {
    const rows = Array.from({length: 40}, (_, i) => run(`strava-${100 + i}`));
    expect(feedbackCandidates(rows)).toHaveLength(40);
    expect(selectFeedbackCandidate(rows, 'strava-139')).toBe(rows[39]);
  });
  it('excludes duplicate IDs even when the conflicting row is not running', () => {
    expect(feedbackCandidates([run('strava-123'), {id:'strava-123', running:false}, run('strava-456')])).toEqual([run('strava-456')]);
  });
  it('rejects missing/invalid IDs and non-runs', () => {
    expect(feedbackCandidates([run(''),run('bad'),run('<invalid>'),{id:'boxing-123',running:false}])).toEqual([]);
  });
  it('keeps explicit selection through refresh and safely falls back when absent', () => {
    const rows = [run('strava-123'),run('strava-456')];
    expect(selectFeedbackCandidate(rows,'strava-456')).toBe(rows[1]);
    expect(selectFeedbackCandidate(rows,'deleted')).toBe(rows[0]);
    expect(selectFeedbackCandidate([], 'deleted')).toBeNull();
  });
});
