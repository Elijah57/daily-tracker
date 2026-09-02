import { route } from '../../server/src/lib/router.js';

// Normalize whatever path Netlify hands us back to /api/...
function apiPath(pathname) {
  let p = (pathname || '').replace(/^\/+/, '');
  // Strip the Netlify function-internal prefix entirely, e.g. ".netlify/functions/api/..."
  p = p.replace(/^\.netlify\/functions\/[^/]*\/?/, '');
  // Drop "undefined" placeholder segments Netlify can insert.
  const parts = p.split('/').filter((s) => s && s !== 'undefined');
  if (parts[0] === 'api') return '/' + parts.join('/');
  const i = p.indexOf('api/');
  if (i >= 0) return '/' + p.slice(i);
  return '/api/' + parts.join('/');
}

// Netlify's modern runtime passes a web-standard Request as the first argument.
// Detect it by the presence of .url/.method; fall back to the legacy AWS-style
// event ({ path, httpMethod, body, headers }) for older runtimes / local CLI.
function isRequestLike(x) {
  return x && typeof x.url === 'string' && typeof x.method === 'string';
}

export default async function handler(event) {
  if (isRequestLike(event)) return await handleRequest(event);
  return await handleLegacyEvent(event);
}

async function handleRequest(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  const path = apiPath(url.pathname);
  console.log('api fn request=', JSON.stringify(req.method), 'url=', String(req.url));
  let body = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    body = {};
  }
  const headers = {};
  req.headers?.forEach?.((value, key) => { headers[key] = value; });
  const result = await route({ method: req.method || 'GET', path, query: Object.fromEntries(url.searchParams.entries()), body, headers });
  const json = result.status === 404 ? { ...result.json, received: url.pathname, cleaned: path } : result.json;
  return new Response(JSON.stringify(json), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleLegacyEvent(event) {
  const qUrl = new URL(event.rawUrl || event.path, 'http://localhost');
  const path = apiPath(event.path) || apiPath(qUrl.pathname) || '/api/';
  console.log('api fn path=', JSON.stringify(event.path), 'path=', path, 'rawUrl=', String(event.rawUrl));
  let body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body);
    } catch {
      body = {};
    }
  }
  const result = await route({
    method: event.httpMethod || 'GET',
    path,
    query: Object.fromEntries(qUrl.searchParams.entries()),
    body,
    headers: event.headers || {},
  });
  const json = result.status === 404 ? { ...result.json, received: event.path || qUrl.pathname, cleaned: path } : result.json;
  return new Response(JSON.stringify(json), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
}