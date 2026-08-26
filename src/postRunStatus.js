import { parseNumber } from './parse.js';

function numeric(value) {
  return parseNumber(value);
}

export function trainingFeedbackStatus(input = {}) {
  const values = {
    rpe: numeric(input.rpe),
    pain: numeric(input.pain),
    legFatigue: numeric(input.legFatigue),
  };
  const missing = Object.entries(values).filter(([, value]) => value === null).map(([field]) => field);
  return { complete: missing.length === 0, missing, values };
}

export function tcxDataStatus(input = {}) {
  const values = {
    targetMin: numeric(input.targetMin),
    targetMax: numeric(input.targetMax),
    timeInTarget: numeric(input.timeInTarget),
    timeAboveTarget: numeric(input.timeAboveTarget),
    timeBelowTarget: numeric(input.timeBelowTarget),
    analyzedDuration: numeric(input.analyzedDuration),
  };
  const missing = Object.entries(values).filter(([, value]) => value === null).map(([field]) => field);
  const durationSum = values.timeInTarget === null || values.timeAboveTarget === null || values.timeBelowTarget === null
    ? null
    : values.timeInTarget + values.timeAboveTarget + values.timeBelowTarget;
  const validTarget = values.targetMin !== null && values.targetMax !== null && values.targetMin < values.targetMax;
  const validDuration = values.analyzedDuration !== null && values.analyzedDuration > 0
    && durationSum !== null && Math.abs(durationSum - values.analyzedDuration) <= 1e-6;
  return {
    complete: missing.length === 0 && validTarget && validDuration,
    missing,
    values,
    validTarget,
    validDuration,
  };
}
