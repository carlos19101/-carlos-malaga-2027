export function retryAfterSeconds(headers) {
  const raw = typeof headers?.get === 'function'
    ? headers.get('Retry-After')
    : headers?.['retry-after'] ?? headers?.['Retry-After'];
  const seconds = Number(raw);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : null;
}

async function jsonRequest(url, options = {}, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers,
    });
    let body = {};
    try { body = await response.json(); } catch { body = {}; }
    return {
      ...body,
      ok: response.ok && body.ok !== false,
      status: response.status,
      retryAfterSeconds: retryAfterSeconds(response.headers),
    };
  } catch {
    return { ok: false, status: 0, error: 'offline' };
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
