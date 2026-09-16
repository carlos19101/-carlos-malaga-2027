import { parseNumber } from './parse.js';
import { tryParseHrTargetStages, HR_TARGET_OBSERVATION_SCHEMA } from './hrTargetStages.js';
import { savedStageAnalysis } from './stageAnalysis.js';

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
  let validStageAnalysis = true;
  if (staged?.schema === HR_TARGET_OBSERVATION_SCHEMA) {
    try {
      validStageAnalysis = Boolean(savedStageAnalysis(input.targetStages, {
        Time_In_Target_s: values.timeInTarget, Time_Above_Target_s: values.timeAboveTarget,
        Time_Below_Target_s: values.timeBelowTarget, HR_Analyzed_Duration_s: values.analyzedDuration,
      }));
    } catch { validStageAnalysis = false; }
    if (!validStageAnalysis) missing.push('stageAnalysis');
  }
  return {
    complete: missing.length === 0 && validTarget && validDuration && validStageAnalysis,
    missing,
    values,
    targetMode: staged ? 'staged' : validTarget ? 'single' : 'none',
    targetStages: staged?.stages || [],
    validTarget,
    validDuration,
  };
}
