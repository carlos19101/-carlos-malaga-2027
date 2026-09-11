import { parseNumber } from './parse.js';
import { tryParseHrTargetStages } from './hrTargetStages.js';

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
  const invalid = Object.entries(values).filter(([, value]) => value !== null && (!Number.isFinite(value) || value < 0 || value > 10)).map(([field]) => field);
  return { complete: missing.length === 0 && invalid.length === 0, missing, invalid, values };
}

export function tcxDataStatus(input = {}) {
  const staged = tryParseHrTargetStages(input.targetStages);
  const values = {
    targetMin: numeric(input.targetMin),
    targetMax: numeric(input.targetMax),
    timeInTarget: numeric(input.timeInTarget),
    timeAboveTarget: numeric(input.timeAboveTarget),
    timeBelowTarget: numeric(input.timeBelowTarget),
    analyzedDuration: numeric(input.analyzedDuration),
  };
  const missing = Object.entries(values)
    .filter(([field, value]) => value === null && !(staged && (field === 'targetMin' || field === 'targetMax')))
    .map(([field]) => field);
  const durationSum = values.timeInTarget === null || values.timeAboveTarget === null || values.timeBelowTarget === null
    ? null
    : values.timeInTarget + values.timeAboveTarget + values.timeBelowTarget;
  const validTarget = Boolean(staged) || (values.targetMin !== null && values.targetMax !== null && values.targetMin < values.targetMax);
  const validDuration = values.analyzedDuration !== null && values.analyzedDuration > 0
    && [values.timeInTarget, values.timeAboveTarget, values.timeBelowTarget, values.analyzedDuration].every((value) => Number.isFinite(value) && value >= 0)
    && durationSum !== null && Math.abs(durationSum - values.analyzedDuration) <= 1e-6;
  return {
    complete: missing.length === 0 && validTarget && validDuration,
    missing,
    values,
    targetMode: staged ? 'staged' : validTarget ? 'single' : 'none',
    targetStages: staged?.stages || [],
    validTarget,
    validDuration,
  };
}
