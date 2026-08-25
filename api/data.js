import { readApplicationTables } from './_lib/googleSheets.js';
import { methodNotAllowed, sendJson } from './_lib/http.js';
import { authenticated, serviceConfiguration } from './_lib/session.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    methodNotAllowed(response, ['GET']);
    return;
  }
  if (!serviceConfiguration().configured) {
    sendJson(response, 503, { ok: false, configured: false, error: 'private-data-not-configured' });
    return;
  }
  if (!authenticated(request)) {
    sendJson(response, 401, { ok: false, error: 'authentication-required' });
    return;
  }
  try {
    const tables = await readApplicationTables();
    sendJson(response, 200, { ok: true, transport: 'google-sheets-api', tables });
  } catch (error) {
    console.error('private-data', error.message);
    sendJson(response, 502, { ok: false, error: 'private-data-unavailable' });
  }
}
