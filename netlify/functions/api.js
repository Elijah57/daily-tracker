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

export default async function handler(event) {
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
  // Netlify's runtime requires a web-standard Response (not {statusCode, body}).
  return new Response(JSON.stringify(json), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
