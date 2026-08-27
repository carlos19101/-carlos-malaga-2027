import { parseDate, parseNumber } from './parse.js';

export const PERFORMANCE_RESPONSE_CONTRACT = Object.freeze({
  label: 'Odpowiedź organizmu po decyzji',
  requiredPairs: 6,
  requires: ['decision timestamp', 'session after decision', 'next-day HRV', 'next-day RHR'],
  purpose: 'Gromadzi obserwacje decyzja → wykonanie → reakcja; nie dowodzi związku przyczynowego i nie zmienia automatycznie planu.',
  missing: 'KALIBRACJA',
});

function timeValue(value) {
  const parsed = value instanceof Date ? new Date(value) : parseDate(value);
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : Number.NEGATIVE_INFINITY;
}

function isCompleteReaction(reaction) {
  return parseNumber(reaction?.hrv) !== null
    && parseNumber(reaction?.rhr) !== null
    && parseNumber(reaction?.hrvDelta) !== null
    && parseNumber(reaction?.rhrDelta) !== null;
}

function sessionExecution(outcome) {
  return (outcome?.sessions || []).map((session) => String(session?.executionStatus || '').toLowerCase())
    .filter((status) => ['ok', 'over', 'under'].includes(status));
}

export function computePerformanceResponse(journal = {}, options = {}) {
  const required = Number.isInteger(options.required) && options.required > 0
    ? options.required : PERFORMANCE_RESPONSE_CONTRACT.requiredPairs;
  const entries = Array.isArray(journal?.entries) ? journal.entries : [];
  const observed = entries.filter(({ outcome }) => outcome?.state === 'observed');
  const pairs = observed.map((entry) => {
    const reaction = entry.outcome?.reaction || null;
    const complete = isCompleteReaction(reaction);
    return {
      id: entry.id,
      date: entry.date,
      timestamp: entry.timestamp,
      decisionStatus: String(entry.status || '').toUpperCase(),
      recommendation: String(entry.recommendation || '').trim(),
      sessionCount: entry.outcome?.sessions?.length || 0,
      execution: sessionExecution(entry.outcome),
      reaction: complete ? {
        date: reaction.date,
        hrvDelta: parseNumber(reaction.hrvDelta),
        rhrDelta: parseNumber(reaction.rhrDelta),
      } : null,
      reactionState: complete ? 'complete' : reaction ? 'partial' : 'missing',
    };
  }).sort((a, b) => timeValue(b.timestamp) - timeValue(a.timestamp));

  const completePairs = pairs.filter(({ reactionState }) => reactionState === 'complete');
  const partialReaction = pairs.filter(({ reactionState }) => reactionState === 'partial').length;
  const missingReaction = pairs.filter(({ reactionState }) => reactionState === 'missing').length;
  const execution = pairs.flatMap(({ execution: statuses }) => statuses);
  const state = completePairs.length >= required ? 'observed'
    : observed.length ? 'calibrating' : 'missing';

  return {
    state,
    contract: PERFORMANCE_RESPONSE_CONTRACT,
    observedSessions: observed.length,
    completePairs: completePairs.length,
    partialReaction,
    missingReaction,
    calibration: {
      required,
      sample: `${Math.min(completePairs.length, required)}/${required}`,
    },
    execution: {
      observed: execution.length,
      ok: execution.filter((status) => status === 'ok').length,
      over: execution.filter((status) => status === 'over').length,
      under: execution.filter((status) => status === 'under').length,
    },
    pairs,
    methodology: 'Porównujemy wyłącznie wykonanie po czasie decyzji z odczytem HRV/RHR następnego dnia. Wynik nie oznacza przyczynowości ani nie zmienia samodzielnie decyzji treningowej.',
  };
}
