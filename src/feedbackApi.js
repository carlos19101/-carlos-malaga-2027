export function retryAfterSeconds(headers, now = Date.now()) {
  const raw = typeof headers?.get === 'function'
    ? headers.get('Retry-After')
    : headers?.['retry-after'] ?? headers?.['Retry-After'];
  const seconds = Number(raw);
  if (Number.isInteger(seconds) && seconds > 0) return seconds;
  if (typeof raw !== 'string' || !/[a-z]/i.test(raw)) return null;
  const date = Date.parse(raw);
  return Number.isFinite(date) && date > now ? Math.ceil((date - now) / 1000) : null;
}

export const REQUEST_TIMEOUT_MS = 15000;

export async function jsonRequest(url, options = {}, fetchImpl = fetch) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('timeout'));
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    const request = (async () => {
    const response = await fetchImpl(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      signal: controller.signal,
      headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers,
    });
    let body;
    try { body = await response.json(); } catch { body = null; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { ok: false, status: response.status, error: 'invalid-response', retryAfterSeconds: retryAfterSeconds(response.headers) };
    }
    return {
      ...body,
      ok: response.ok && body.ok === true,
      ...(response.ok && body.ok !== true && body.ok !== false ? { error: 'invalid-response' } : {}),
      status: response.status,
      retryAfterSeconds: retryAfterSeconds(response.headers),
    };
    })();
    return await Promise.race([request, timeout]);
  } catch {
    return { ok: false, status: 0, error: controller.signal.aborted ? 'timeout' : 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

export function feedbackSessionStatus(fetchImpl) {
  return jsonRequest('/api/session', { method: 'GET' }, fetchImpl);
}

export function feedbackLogin(passcode, fetchImpl) {
  return jsonRequest('/api/session', { method: 'POST', body: JSON.stringify({ passcode }) }, fetchImpl);
}

export function feedbackLogout(fetchImpl) {
  return jsonRequest('/api/session', { method: 'DELETE' }, fetchImpl);
}

export function sendTrainingFeedback(feedback, fetchImpl) {
  return jsonRequest('/api/training-feedback', { method: 'POST', body: JSON.stringify(feedback) }, fetchImpl);
}

export function sendTcxImport(envelope, fetchImpl) {
  return jsonRequest('/api/tcx-import', { method: 'POST', body: JSON.stringify(envelope) }, fetchImpl);
}

export function sendStravaImport(input, fetchImpl) {
  return jsonRequest('/api/strava/import', { method: 'POST', body: JSON.stringify(input) }, fetchImpl);
}
