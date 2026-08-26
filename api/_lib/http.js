export function sendJson(response, status, payload, headers = {}) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  Object.entries(headers).forEach(([name, value]) => response.setHeader(name, value));
  response.end(JSON.stringify(payload));
}

export async function readJson(request, maxBytes = 4096) {
  if (request.body && typeof request.body === 'object') {
    if (Buffer.byteLength(JSON.stringify(request.body)) > maxBytes) throw new Error('payload-too-large');
    return request.body;
  }
  if (typeof request.body === 'string') {
    if (Buffer.byteLength(request.body) > maxBytes) throw new Error('payload-too-large');
    return JSON.parse(request.body);
  }
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) throw new Error('payload-too-large');
  }
  return body ? JSON.parse(body) : {};
}

export function methodNotAllowed(response, allowed) {
  response.setHeader('Allow', allowed.join(', '));
  sendJson(response, 405, { ok: false, error: 'method-not-allowed' });
}
