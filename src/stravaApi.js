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
    return { ...body, ok: response.ok && body.ok !== false, status: response.status };
  } catch {
    return { ok: false, status: 0, error: 'offline' };
  }
}

export function stravaStatus(fetchImpl) {
  return jsonRequest('/api/strava/status', { method: 'GET' }, fetchImpl);
}

export function stravaActivities(fetchImpl) {
  return jsonRequest('/api/strava/activities', { method: 'GET' }, fetchImpl);
}

export function disconnectStrava(fetchImpl) {
  return jsonRequest('/api/strava/disconnect', { method: 'POST', body: JSON.stringify({}) }, fetchImpl);
}

export function connectStrava() {
  window.location.assign('/api/strava/connect');
}
