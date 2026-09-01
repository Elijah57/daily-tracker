import { route } from '../../server/src/lib/router.js';

// Netlify function (single catch-all). Map /api/* to this via netlify.toml.
// Netlify passes the full request path in event.path & event.rawUrl's query.
export default async function handler(event) {
  const url = new URL(event.rawUrl || event.path, 'http://localhost');
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
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    body,
    headers: event.headers || {},
  });
  return {
    statusCode: result.status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result.json),
  };
}
