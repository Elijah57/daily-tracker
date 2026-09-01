import { route } from '../../server/src/lib/router.js';

// Normalize whatever path Netlify hands us back to /api/...
function apiPath(pathname) {
  // Strip a function-internal prefix if present.
  let p = pathname.replace(/\/?\.netlify\/functions\/\w+/, '');
  if (!p.startsWith('/api')) {
    // Last resort: extract the segment that follows /api, or prepend it.
    const idx = p.indexOf('/api');
    if (idx >= 0) p = p.slice(idx);
    else p = '/api' + p;
  }
  return p || '/api';
}

export default async function handler(event) {
  const url = new URL(event.rawUrl || event.path, 'http://localhost');
  const clean = apiPath(url.pathname);
  console.log('api fn path=', JSON.stringify(url.pathname), 'clean=', clean);
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
    path: clean,
    query: Object.fromEntries(url.searchParams.entries()),
    body,
    headers: event.headers || {},
  });
  // Netlify's runtime requires a web-standard Response (not {statusCode, body}).
  return new Response(JSON.stringify(result.json), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
