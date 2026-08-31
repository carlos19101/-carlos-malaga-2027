import { isNullish, parseNumber } from './parse.js';

export const FEEDBACK_QUEUE_KEY = 'carlos:training-feedback:v1';
export const TRAINING_FEEDBACK_SCHEMA_VERSION = 2;
export const RPE_SCALE = { min: 1, max: 10 };
export const SYMPTOM_SCALE = { min: 0, max: 10 };
const activeFlushes = new WeakMap();

function scaleValue(value, scale) {
  const numeric = parseNumber(value);
  if (numeric === null || numeric < scale.min || numeric > scale.max) return null;
  return numeric;
}

function isoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function validateTrainingFeedback(input = {}, options = {}) {
  const allowLegacyRpeZero = options.allowLegacyRpeZero === true && !input.schemaVersion;
  const sessionId = String(input.sessionId || '').trim();
  const feedbackId = String(input.feedbackId || '').trim();
  const submittedAt = isoTimestamp(input.submittedAt);
  const rpe = scaleValue(input.rpe, allowLegacyRpeZero ? SYMPTOM_SCALE : RPE_SCALE);
  const pain = scaleValue(input.pain, SYMPTOM_SCALE);
  const legFatigue = scaleValue(input.legFatigue, SYMPTOM_SCALE);
  const notes = isNullish(input.notes) ? '' : String(input.notes).trim();
  const errors = {};

  if (!/^[a-z0-9][a-z0-9._:-]{5,119}$/i.test(sessionId)) errors.sessionId = 'Nieprawidłowy Session_ID.';
  if (!/^[a-z0-9][a-z0-9-]{7,79}$/i.test(feedbackId)) errors.feedbackId = 'Nieprawidłowy identyfikator feedbacku.';
  if (!submittedAt) errors.submittedAt = 'Nieprawidłowy czas wysłania.';
  if (rpe === null) errors.rpe = 'RPE ukończonego biegu musi być liczbą 1–10.';
  if (pain === null) errors.pain = 'Ból musi być liczbą 0–10.';
  if (legFatigue === null) errors.legFatigue = 'Zmęczenie nóg musi być liczbą 0–10.';
  if (notes.length > 500) errors.notes = 'Notatka może mieć maksymalnie 500 znaków.';

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: Object.keys(errors).length ? null : {
      schemaVersion: input.schemaVersion || TRAINING_FEEDBACK_SCHEMA_VERSION,
      sessionId, feedbackId, submittedAt, rpe, pain, legFatigue, notes,
    },
  };
}

export function createTrainingFeedback(input = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const fallbackId = () => `feedback-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  const feedbackId = input.feedbackId || options.idFactory?.() || globalThis.crypto?.randomUUID?.() || fallbackId();
  const validated = validateTrainingFeedback({ ...input, feedbackId, submittedAt: input.submittedAt || now });
  if (!validated.ok) {
    const error = new Error('Nieprawidłowy feedback treningowy.');
    error.validation = validated.errors;
    throw error;
  }
  return validated.value;
}

export function readFeedbackQueue(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(FEEDBACK_QUEUE_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((item) => validateTrainingFeedback(item, { allowLegacyRpeZero: true }).ok)
      : [];
  } catch {
    return [];
  }
}

function writeFeedbackQueue(storage, queue) {
  storage?.setItem(FEEDBACK_QUEUE_KEY, JSON.stringify(queue));
  return queue;
}

export function enqueueTrainingFeedback(storage, feedback) {
  const validated = validateTrainingFeedback(feedback);
  if (!validated.ok) throw new Error('Nie można dodać nieprawidłowego feedbacku do kolejki.');
  const queue = readFeedbackQueue(storage);
  if (queue.some((item) => item.sessionId === validated.value.sessionId
    && Date.parse(item.submittedAt) > Date.parse(validated.value.submittedAt))) return queue;
  const withoutSession = queue.filter(({ sessionId }) => sessionId !== validated.value.sessionId);
  return writeFeedbackQueue(storage, [...withoutSession, validated.value].sort((a, b) => (
    a.submittedAt.localeCompare(b.submittedAt)
  )));
}

function feedbackIdentity(feedback) {
  return JSON.stringify([feedback.sessionId, feedback.feedbackId, feedback.submittedAt]);
}

async function drainTrainingFeedbackQueue(storage, send) {
  const synced = [];
  const rejected = [];
  const attempted = new Set();
  let blocked = null;

  while (!blocked) {
    // Read again after every request: a new or corrected assessment may have arrived.
    const feedback = readFeedbackQueue(storage).find((item) => !attempted.has(feedbackIdentity(item)));
    if (!feedback) break;
    const identity = feedbackIdentity(feedback);
    attempted.add(identity);
    try {
      const result = await send(feedback);
      const status = Number(result?.status || (result?.ok ? 200 : 0));
      if (result?.ok || (status >= 200 && status < 300)) synced.push(feedback);
      else if ([400, 422].includes(status)) rejected.push({ feedback, status });
      else {
        if ([401, 403].includes(status)) blocked = 'auth';
        else if (status === 404) blocked = 'session-not-ready';
        else blocked = 'retryable';
      }
    } catch {
      blocked = 'offline';
    }
    if (!blocked) {
      // Remove only the exact completed version, never the snapshot of the whole queue.
      writeFeedbackQueue(storage, readFeedbackQueue(storage).filter((item) => feedbackIdentity(item) !== identity));
    }
  }

  return { synced, rejected, remaining: readFeedbackQueue(storage), blocked };
}

export function flushTrainingFeedbackQueue(storage, send, options = {}) {
  const canTrack = storage !== null && typeof storage === 'object';
  if (canTrack && activeFlushes.has(storage)) return activeFlushes.get(storage);
  const locks = options.locks ?? globalThis.navigator?.locks;
  const run = () => drainTrainingFeedbackQueue(storage, send);
  const pending = Promise.resolve().then(() => (
    locks?.request ? locks.request(`${FEEDBACK_QUEUE_KEY}:flush`, run) : run()
  )).finally(() => {
    if (canTrack) activeFlushes.delete(storage);
  });
  if (canTrack) activeFlushes.set(storage, pending);
  return pending;
}
