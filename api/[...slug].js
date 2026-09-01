import { route } from '../server/src/lib/router.js';

// Vercel function: single catch-all matching /api/* (see vercel.json).
export default async function handler(req, res) {
  let body = {};
  if (req.body) {
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      body = {};
    }
  }
  const result = await route({
    method: req.method || 'GET',
    path: req.url ? req.url.split('?')[0] : '/',
    query: req.query || {},
    body,
    headers: req.headers || {},
  });
  res.status(result.status).json(result.json);
}
