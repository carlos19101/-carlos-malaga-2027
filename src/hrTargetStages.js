import { parseNumber } from './parse.js';

export const HR_TARGET_STAGES_SCHEMA = 'carlos.hr-target-stages.v1';
export const HR_TARGET_DISTANCE_STAGES_SCHEMA = 'carlos.hr-target-stages.v2';
export const HR_TARGET_OBSERVATION_SCHEMA = 'carlos.hr-target-stages.v3';

function stageError(message) {
  throw new TypeError(`Nieprawidłowe etapy celu HR: ${message}`);
}

function optionalNumber(value, label) {
  if (value === undefined || value === null || String(value).trim?.() === '') return null;
  const parsed = parseNumber(value);
  if (parsed === null) stageError(`${label} musi być liczbą.`);
  return parsed;
}

function inputObject(value) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      stageError('tekst musi być prawidłowym JSON-em.');
    }
  }
  return value;
}

export function parseHrTargetStages(value) {
  const input = inputObject(value);
  const envelope = Array.isArray(input) ? { stages: input } : input;
  if (!envelope || typeof envelope !== 'object') stageError('brak obiektu etapów.');
  const schema = envelope.schema ?? HR_TARGET_STAGES_SCHEMA;
  if (![HR_TARGET_STAGES_SCHEMA, HR_TARGET_DISTANCE_STAGES_SCHEMA, HR_TARGET_OBSERVATION_SCHEMA].includes(schema)) {
    stageError(`nieobsługiwany schema: ${schema}.`);
  }
  if (!Array.isArray(envelope.stages) || !envelope.stages.length) stageError('brak etapów.');

  const basis = schema === HR_TARGET_DISTANCE_STAGES_SCHEMA ? 'distance' : 'time';
  if (envelope.basis !== undefined && envelope.basis !== basis) stageError(`schema ${schema} wymaga podstawy ${basis}.`);
  const stages = envelope.stages.map((stage, index) => {
    if (!stage || typeof stage !== 'object') stageError(`etap ${index + 1} nie jest obiektem.`);
    const span = basis === 'time'
      ? optionalNumber(stage.durationSeconds ?? stage.duration_s, `czas etapu ${index + 1}`)
      : optionalNumber(stage.distanceMeters ?? stage.distance_m, `dystans etapu ${index + 1}`);
    const spanLabel = basis === 'time' ? 'czas' : 'dystans';
    if (span === null || span <= 0) stageError(`${spanLabel} etapu ${index + 1} musi być dodatni.`);
    const min = optionalNumber(stage.min ?? stage.min_bpm, `dolna granica etapu ${index + 1}`);
    const max = optionalNumber(stage.max ?? stage.max_bpm, `górna granica etapu ${index + 1}`);
    const mixed = schema === HR_TARGET_OBSERVATION_SCHEMA;
    if (!mixed && (stage.mode !== undefined || stage.maxExclusive !== undefined)) stageError('tryb obserwacji i granice otwarte wymagają v3.');
    const mode = stage.mode ?? 'target';
    if (!['target', 'observe'].includes(mode)) stageError(`nieznany tryb etapu ${index + 1}.`);
    if (stage.maxExclusive !== undefined && typeof stage.maxExclusive !== 'boolean') stageError('maxExclusive musi być boolean.');
    if (mode === 'observe' && (min !== null || max !== null || stage.maxExclusive)) stageError('obserwacja nie może mieć celu HR.');
    if (mode === 'target' && min === null && max === null) stageError(`etap ${index + 1} musi mieć co najmniej jedną granicę HR.`);
    if (stage.maxExclusive && max === null) stageError('granica otwarta wymaga max.');
    if ((min !== null && (min < 20 || min > 250)) || (max !== null && (max < 20 || max > 250))) {
      stageError(`granice HR etapu ${index + 1} muszą mieścić się w 20–250 bpm.`);
    }
    if (min !== null && max !== null && min >= max) stageError(`dolna granica etapu ${index + 1} musi być niższa od górnej.`);
    const name = String(stage.name ?? stage.label ?? `Etap ${index + 1}`).trim() || `Etap ${index + 1}`;
    return basis === 'time'
      ? { name, durationSeconds: span, min, max, ...(mixed ? { mode, maxExclusive: Boolean(stage.maxExclusive) } : {}) }
      : { name, distanceMeters: span, min, max };
  });
  if (!stages.some((stage) => stage.mode !== 'observe')) stageError('potrzebny jest przynajmniej jeden etap z celem HR.');

  return { schema, basis, stages };
}

export function tryParseHrTargetStages(value) {
  try {
    if (value === undefined || value === null || String(value).trim?.() === '') return null;
    return parseHrTargetStages(value);
  } catch {
    return null;
  }
}

export function stringifyHrTargetStages(value) {
  const { schema, basis, stages } = parseHrTargetStages(value);
  return JSON.stringify({ schema, basis, stages });
}
