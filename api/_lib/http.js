export function sendJson(response, status, payload, headers = {}) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  Object.entries(headers).forEach(([name, value]) => response.setHeader(name, value));
  response.end(JSON.stringify(payload));
}

function isJsonObject(value) {
  if (value === null || Array.isArray(value) || Object.prototype.toString.call(value) !== '[object Object]') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonObject(value) {
  if (!isJsonObject(value)) throw new Error('invalid-json-object');
  return value;
}

function declaredContentLength(request) {
  const raw = request?.headers?.['content-length'] ?? request?.headers?.['Content-Length'];
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function isInvalidRequestError(error) {
  return error instanceof SyntaxError || error?.message === 'invalid-json-object';
}

export async function readJson(request, maxBytes = 4096) {
  if (declaredContentLength(request) > maxBytes) throw new Error('payload-too-large');
  if (request.body && typeof request.body === 'object') {
    let serialized;
    try {
      serialized = JSON.stringify(request.body);
    } catch {
      throw new Error('invalid-json-object');
    }
    if (Buffer.byteLength(serialized) > maxBytes) throw new Error('payload-too-large');
    return assertJsonObject(request.body);
  }
  if (typeof request.body === 'string') {
    if (Buffer.byteLength(request.body) > maxBytes) throw new Error('payload-too-large');
    return assertJsonObject(JSON.parse(request.body));
  }
  if (!request || typeof request[Symbol.asyncIterator] !== 'function') return {};
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) throw new Error('payload-too-large');
  }
  return body ? assertJsonObject(JSON.parse(body)) : {};
}

export function methodNotAllowed(response, allowed) {
  response.setHeader('Allow', allowed.join(', '));
  sendJson(response, 405, { ok: false, error: 'method-not-allowed' });
}
