import { jsonRequest } from './feedbackApi.js';

export function stravaStatus(fetchImpl) {
  return jsonRequest('/api/strava/status', { method: 'GET' }, fetchImpl);
}

export function stravaActivities(limit, page = 1, fetchImpl) {
  const bounded = Math.min(Math.max(Number(limit) || 10, 1), 200);
  const boundedPage = Math.min(Math.max(Number(page) || 1, 1), 1000);
  return jsonRequest(`/api/strava/activities?limit=${bounded}&page=${boundedPage}`, { method: 'GET' }, fetchImpl);
}

export function disconnectStrava(fetchImpl) {
  return jsonRequest('/api/strava/disconnect', { method: 'POST', body: JSON.stringify({}) }, fetchImpl);
}

export function connectStrava() {
  window.location.assign('/api/strava/connect');
}
