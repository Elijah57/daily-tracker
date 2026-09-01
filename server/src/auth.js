import jwt from 'jsonwebtoken';
import db from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'daily-tracker-dev-secret-change-me';

export function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: '30d',
  });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Confirm the user still exists in the DB. A token vouched for by a user
  // that no longer exists (e.g. after the database was reset) is invalid.
  const user = db.prepare('SELECT id, username, display_name AS displayName FROM users WHERE id = ?').get(payload.id);
  if (!user) {
    return res.status(401).json({ error: 'Session no longer valid, please log in again' });
  }

  req.user = { id: user.id, username: user.username, displayName: user.displayName };
  next();
}
