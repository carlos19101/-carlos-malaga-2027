const PREFIX = 'carlos:feedback-draft:v1:';
const fields = ['rpe', 'pain', 'legFatigue', 'notes'];

export function readFeedbackDraft(sessionId, storage) {
  if (!sessionId) return null;
  try {
    storage ??= globalThis.localStorage;
    const value = JSON.parse(storage.getItem(PREFIX + sessionId));
    if (!value || !fields.every((field) => typeof value[field] === 'string')) return null;
    return Object.fromEntries(fields.map((field) => [field, value[field]]));
  } catch { return null; }
}

export function saveFeedbackDraft(sessionId, values, storage) {
  if (!sessionId) return false;
  try {
    storage ??= globalThis.localStorage;
    storage.setItem(PREFIX + sessionId, JSON.stringify(Object.fromEntries(
      fields.map((field) => [field, String(values[field] ?? '')]),
    )));
    return true;
  } catch { return false; }
}

export function clearFeedbackDraft(sessionId, storage) {
  try { (storage ?? globalThis.localStorage).removeItem(PREFIX + sessionId); } catch { /* Keep the form usable without storage. */ }
}
