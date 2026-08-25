import { isNullish, parseNumber } from './parse.js';

export const FEEDBACK_QUEUE_KEY = 'carlos:training-feedback:v1';
export const FEEDBACK_SCALE = { min: 0, max: 10 };

function scaleValue(value) {
  const numeric = parseNumber(value);
  if (numeric === null || numeric < FEEDBACK_SCALE.min || numeric > FEEDBACK_SCALE.max) return null;
  return numeric;
}

function isoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function validateTrainingFeedback(input = {}) {
  const sessionId = String(input.sessionId || '').trim();
  const feedbackId = String(input.feedbackId || '').trim();
  const submittedAt = isoTimestamp(input.submittedAt);
  const rpe = scaleValue(input.rpe);
  const pain = scaleValue(input.pain);
  const legFatigue = scaleValue(input.legFatigue);
  const notes = isNullish(input.notes) ? '' : String(input.notes).trim();
  const errors = {};

  if (!/^[a-z0-9][a-z0-9._:-]{5,119}$/i.test(sessionId)) errors.sessionId = 'Nieprawidłowy Session_ID.';
  if (!/^[a-z0-9][a-z0-9-]{7,79}$/i.test(feedbackId)) errors.feedbackId = 'Nieprawidłowy identyfikator feedbacku.';
  if (!submittedAt) errors.submittedAt = 'Nieprawidłowy czas wysłania.';
  if (rpe === null) errors.rpe = 'RPE musi być liczbą 0–10.';
  if (pain === null) errors.pain = 'Ból musi być liczbą 0–10.';
  if (legFatigue === null) errors.legFatigue = 'Zmęczenie nóg musi być liczbą 0–10.';
  if (notes.length > 500) errors.notes = 'Notatka może mieć maksymalnie 500 znaków.';

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: Object.keys(errors).length ? null : {
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
      ? parsed.filter((item) => validateTrainingFeedback(item).ok)
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
  const withoutSession = queue.filter(({ sessionId }) => sessionId !== validated.value.sessionId);
  return writeFeedbackQueue(storage, [...withoutSession, validated.value].sort((a, b) => (
    a.submittedAt.localeCompare(b.submittedAt)
  )));
}

export async function flushTrainingFeedbackQueue(storage, send) {
  const queue = readFeedbackQueue(storage);
  const synced = [];
  const rejected = [];
  const remaining = [];
  let blocked = null;

  for (let index = 0; index < queue.length; index += 1) {
    const feedback = queue[index];
    if (blocked) {
      remaining.push(feedback);
      continue;
    }
    try {
      const result = await send(feedback);
      const status = Number(result?.status || (result?.ok ? 200 : 0));
      if (result?.ok || (status >= 200 && status < 300)) synced.push(feedback);
      else if ([400, 422].includes(status)) rejected.push({ feedback, status });
      else {
        remaining.push(feedback);
        if ([401, 403].includes(status)) blocked = 'auth';
        else if (status === 404) blocked = 'session-not-ready';
        else blocked = 'retryable';
      }
    } catch {
      remaining.push(feedback);
      blocked = 'offline';
    }
  }

  writeFeedbackQueue(storage, remaining);
  return { synced, rejected, remaining, blocked };
}
