export const STRAVA_RECONCILIATION_CONTRACT = {
  runDistanceToleranceMeters: 100,
  runDistanceTolerancePercent: 2,
  durationToleranceSeconds: 120,
};

function text(value) {
  return String(value || '').trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function category(value) {
  const normalized = text(value).toLowerCase().replace(/[\s_-]/g, '');
  if (/(run|bieg)/.test(normalized)) return 'run';
  if (/(weighttraining|strength|siła|sila)/.test(normalized)) return 'strength';
  return 'other';
}

function localDate(value) {
  const match = text(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function nearDistance(activity, session) {
  const actual = number(activity.distanceMeters);
  const expected = number(session.distanceMeters);
  if (actual === null || expected === null || expected <= 0) return { comparable: false, diffMeters: null, withinTolerance: false };
  const diffMeters = Math.abs(actual - expected);
  return {
    comparable: true,
    diffMeters,
    withinTolerance: diffMeters <= STRAVA_RECONCILIATION_CONTRACT.runDistanceToleranceMeters
      || (diffMeters / expected) * 100 <= STRAVA_RECONCILIATION_CONTRACT.runDistanceTolerancePercent,
  };
}

function nearDuration(activity, session) {
  const actual = number(activity.movingSeconds);
  const expected = number(session.durationSeconds);
  if (actual === null || expected === null || expected <= 0) return { comparable: false, diffSeconds: null, withinTolerance: false };
  const diffSeconds = Math.abs(actual - expected);
  return {
    comparable: true,
    diffSeconds,
    withinTolerance: diffSeconds <= STRAVA_RECONCILIATION_CONTRACT.durationToleranceSeconds,
  };
}

function comparison(activity, session) {
  const type = category(activity.sportType || activity.type);
  const distance = type === 'run' ? nearDistance(activity, session) : { comparable: false, diffMeters: null, withinTolerance: false };
  const duration = nearDuration(activity, session);
  const primary = type === 'run' && distance.comparable ? distance : duration;
  return { distance, duration, withinTolerance: primary.comparable && primary.withinTolerance };
}

export function reconcileStravaActivities(activities = [], sessions = [], options = {}) {
  const coverageStartDate = localDate(options.coverageStartDate);
  const normalizedSessions = (sessions || []).map((session) => ({
    ...session,
    date: localDate(session.date),
    category: category(session.type),
  })).filter((session) => session.date);

  const entries = (activities || []).map((activity) => {
    const activityCategory = category(activity.sportType || activity.type);
    const date = localDate(activity.startLocal || activity.startAt);
    if (!date || activityCategory === 'other') {
      return { activity, state: 'outside-contract', session: null, comparison: null };
    }
    const direct = normalizedSessions.filter((session) => String(session.id || '').trim() === `strava-${activity.id}`);
    if (direct.length === 1) return { activity, state: 'matched', session: direct[0], comparison: null, match: 'source-id' };
    if (direct.length > 1) return { activity, state: 'ambiguous', session: null, comparison: null };
    const candidates = normalizedSessions.filter((session) => session.date === date && session.category === activityCategory);
    if (!candidates.length) {
      return {
        activity,
        state: coverageStartDate && date < coverageStartDate ? 'historical' : 'unmatched',
        session: null,
        comparison: null,
      };
    }

    const scored = candidates.map((session) => ({ session, comparison: comparison(activity, session) }));
    const compatible = scored.filter((candidate) => candidate.comparison.withinTolerance);
    if (compatible.length === 1) return { activity, state: 'matched', ...compatible[0] };
    if (compatible.length > 1) return { activity, state: 'ambiguous', session: null, comparison: null };
    if (scored.length === 1) return { activity, state: 'review', ...scored[0] };
    return { activity, state: 'ambiguous', session: null, comparison: null };
  });

  return {
    contract: STRAVA_RECONCILIATION_CONTRACT,
    entries,
    summary: {
      matched: entries.filter((entry) => entry.state === 'matched').length,
      review: entries.filter((entry) => entry.state === 'review').length,
      unmatched: entries.filter((entry) => entry.state === 'unmatched').length,
      historical: entries.filter((entry) => entry.state === 'historical').length,
      ambiguous: entries.filter((entry) => entry.state === 'ambiguous').length,
      outsideContract: entries.filter((entry) => entry.state === 'outside-contract').length,
    },
  };
}
