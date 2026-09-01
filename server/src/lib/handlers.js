import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { isoDate, addDays, computeStreaks } from '../stats.js';

const JWT_SECRET = process.env.JWT_SECRET || 'daily-tracker-dev-secret-change-me';

// ---------------------------------------------------------------------------
// Auth helpers (shared with functions)
// ---------------------------------------------------------------------------
export function verifyAuth(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return { error: 'Authentication required' };
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return { error: 'Invalid or expired token' };
  }
  return { user: { id: payload.id, username: payload.username } };
}

export async function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function withGoal(tasks) {
  const ids = [...new Set(tasks.map((t) => t.goal_id).filter(Boolean))];
  const goals =
    ids.length > 0
      ? (await db.all(`SELECT * FROM goals WHERE id IN (${ids.map(() => '?').join(',')})`, ids)).map((g) => ({
          ...g,
        }))
      : [];
  const goalMap = new Map(goals.map((g) => [g.id, g]));
  return tasks.map((t) => ({ ...t, goal: t.goal_id ? goalMap.get(t.goal_id) || null : null }));
}

async function tasksForDate(userId, date) {
  const rows = await db.all(
    `SELECT t.* FROM tasks t
     LEFT JOIN goals g ON g.id = t.goal_id
     WHERE t.user_id = ? AND t.active = 1
       AND (t.goal_id IS NULL OR (g.active = 1 AND g.start_date <= ? AND g.end_date >= ?))
     ORDER BY t.position, t.id`,
    [userId, date, date]
  );
  return withGoal(rows);
}

const json = (status, body) => ({ status, json: body });
const ok = (body = {}) => ({ status: 200, json: body });

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
export async function register(req) {
  const { username, password, displayName } = req.body || {};
  if (!username || !password) return json(400, { error: 'Username and password are required' });
  if (password.length < 4) return json(400, { error: 'Password must be at least 4 characters' });
  const cleanUser = String(username).trim().toLowerCase();
  if (!/^[a-z0-9_]{2,20}$/.test(cleanUser)) {
    return json(400, { error: 'Username must be 2-20 chars (letters, numbers, underscore)' });
  }
  const exists = await db.get('SELECT id FROM users WHERE username = ?', [cleanUser]);
  if (exists) return json(409, { error: 'Username already taken' });

  const hash = bcrypt.hashSync(String(password), 10);
  const display = (displayName || '').trim() || cleanUser;
  const info = await db.run('INSERT INTO users (username, password, display_name) VALUES (?, ?, ?)', [
    cleanUser,
    hash,
    display,
  ]);
  const user = { id: info.lastInsertRowid, username: cleanUser, displayName: display };
  return json(201, { token: await signToken(user), user });
}

export async function login(req) {
  const { username, password } = req.body || {};
  const cleanUser = String(username || '').trim().toLowerCase();
  const row = await db.get('SELECT * FROM users WHERE username = ?', [cleanUser]);
  if (!row || !bcrypt.compareSync(String(password || ''), row.password)) {
    return json(401, { error: 'Invalid username or password' });
  }
  const user = { id: row.id, username: row.username, displayName: row.display_name };
  return ok({ token: await signToken(user), user });
}

export async function me(req) {
  const auth = verifyAuth(req);
  if (auth.error) return json(401, { error: auth.error });
  const row = await db.get('SELECT id, username, display_name FROM users WHERE id = ?', [auth.user.id]);
  if (!row) return json(404, { error: 'User not found' });
  return ok({ id: row.id, username: row.username, displayName: row.display_name });
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------
export async function listGoals(req) {
  const auth = verifyAuth(req);
  if (auth.error) return json(401, { error: auth.error });
  const rows = await db.all('SELECT * FROM goals WHERE user_id = ? AND active = 1 ORDER BY start_date, id', [
    auth.user.id,
  ]);
  const result = [];
  for (const g of rows) {
    const taskRows = await db.all('SELECT * FROM tasks WHERE user_id = ? AND goal_id = ? AND active = 1 ORDER BY position, id', [
      auth.user.id,
      g.id,
    ]);
    result.push({ ...g, tasks: await withGoal(taskRows) });
  }
  return ok(result);
}

export async function createGoal(req) {
  const auth = verifyAuth(req);
  if (auth.error) return json(401, { error: auth.error });
  const { title, color, startDate, endDate } = req.body || {};
  if (!title || !String(title).trim()) return json(400, { error: 'Goal title is required' });
  if (!startDate || !endDate || endDate < startDate) {
    return json(400, { error: 'A valid start and end date are required' });
  }
  const info = await db.run(
    'INSERT INTO goals (user_id, title, color, start_date, end_date) VALUES (?, ?, ?, ?, ?)',
    [auth.user.id, String(title).trim(), color || null, startDate, endDate]
  );
  const goal = await db.get('SELECT * FROM goals WHERE id = ?', [info.lastInsertRowid]);
  return json(201, { ...goal, tasks: [] });
}

export async function patchGoal(req, id) {
  const auth = verifyAuth(req);
  if (auth.error) return json(401, { error: auth.error });
  const goal = await db.get('SELECT * FROM goals WHERE id = ? AND user_id = ?', [id, auth.user.id]);
  if (!goal) return json(404, { error: 'Goal not found' });
  const { title, color, startDate, endDate, active } = req.body || {};
  const fields = [];
  const values = [];
  if (title !== undefined) { fields.push('title = ?'); values.push(String(title).trim()); }
  if (color !== undefined) { fields.push('color = ?'); values.push(color || null); }
  if (startDate !== undefined) { fields.push('start_date = ?'); values.push(startDate); }
  if (endDate !== undefined) { fields.push('end_date = ?'); values.push(endDate); }
  if (active !== undefined) { fields.push('active = ?'); values.push(active ? 1 : 0); }
  if (fields.length) {
    values.push(id, auth.user.id);
    await db.run(`UPDATE goals SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
  }
  const updated = await db.get('SELECT * FROM goals WHERE id = ?', [id]);
  const taskRows = await db.all('SELECT * FROM tasks WHERE goal_id = ? AND active = 1', [updated.id]);
  return ok({ ...updated, tasks: await withGoal(taskRows) });
}

export async function deleteGoal(req, id) {
  const auth = verifyAuth(req);
  if (auth.error) return json(401, { error: auth.error });
  const goal = await db.get('SELECT * FROM goals WHERE id = ? AND user_id = ?', [id, auth.user.id]);
  if (!goal) return json(404, { error: 'Goal not found' });
  await db.run('DELETE FROM tasks WHERE goal_id = ? AND user_id = ?', [id, auth.user.id]);
  await db.run('DELETE FROM goals WHERE id = ? AND user_id = ?', [id, auth.user.id]);
  return ok({ ok: true });
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
export async function listTasks(req) {
  const auth = verifyAuth(req);
  if (auth.error) return json(401, { error: auth.error });
  return ok(await tasksForDate(auth.user.id, isoDate()));
}

export async function createTask(req) {
  const auth = verifyAuth(req);
  if (auth.error) return json(401, { error: auth.error });
  const { title, color, description, time, goalId } = req.body || {};
  if (!title || !String(title).trim()) return json(400, { error: 'Task title is required' });
  if (goalId) {
    const goal = await db.get('SELECT * FROM goals WHERE id = ? AND user_id = ?', [goalId, auth.user.id]);
    if (!goal) return json(404, { error: 'Goal not found' });
  }
  const posRow = await db.get('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM tasks WHERE user_id = ?', [auth.user.id]);
  const info = await db.run(
    'INSERT INTO tasks (user_id, title, description, time, color, position, goal_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      auth.user.id,
      String(title).trim(),
      (description || '').trim() || null,
      time || null,
      color || null,
      posRow.p,
      goalId || null,
    ]
  );
  const task = await db.get('SELECT * FROM tasks WHERE id = ?', [info.lastInsertRowid]);
  return json(201, (await withGoal([task]))[0]);
}

export async function patchTask(req, id) {
  const auth = verifyAuth(req);
  if (auth.error) return json(401, { error: auth.error });
  const task = await db.get('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [id, auth.user.id]);
  if (!task) return json(404, { error: 'Task not found' });
  const { title, color, active, position, description, time } = req.body || {};
  const fields = [];
  const values = [];
  if (title !== undefined) { fields.push('title = ?'); values.push(String(title).trim()); }
  if (description !== undefined) { fields.push('description = ?'); values.push(String(description).trim() || null); }
  if (time !== undefined) { fields.push('time = ?'); values.push(time || null); }
  if (color !== undefined) { fields.push('color = ?'); values.push(color || null); }
  if (active !== undefined) { fields.push('active = ?'); values.push(active ? 1 : 0); }
  if (position !== undefined) { fields.push('position = ?'); values.push(position); }
  if (fields.length) {
    values.push(id, auth.user.id);
    await db.run(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
  }
  const updated = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);
  return ok((await withGoal([updated]))[0]);
}

export async function deleteTask(req, id) {
  const auth = verifyAuth(req);
  if (auth.error) return json(401, { error: auth.error });
  const info = await db.run('DELETE FROM tasks WHERE id = ? AND user_id = ?', [id, auth.user.id]);
  if (info.changes === 0) return json(404, { error: 'Task not found' });
  return ok({ ok: true });
}

// ---------------------------------------------------------------------------
// Completions
// ---------------------------------------------------------------------------
export async function listCompletions(req, query) {
  const auth = verifyAuth(req);
  if (auth.error) return json(401, { error: auth.error });
  const days = Math.min(parseInt((query && query.days) || '30', 10), 365);
  const from = addDays(isoDate(), -(days - 1));
  const rows = await db.all(
    'SELECT task_id, date FROM completions WHERE user_id = ? AND date >= ? ORDER BY date',
    [auth.user.id, from]
  );
  return ok(rows);
}

export async function addCompletion(req) {
  const auth = verifyAuth(req);
  if (auth.error) return json(401, { error: auth.error });
  const { taskId, date } = req.body || {};
  const d = date || isoDate();
  const task = await db.get('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, auth.user.id]);
  if (!task) return json(404, { error: 'Task not found' });
  await db.run('INSERT OR IGNORE INTO completions (task_id, user_id, date) VALUES (?, ?, ?)', [taskId, auth.user.id, d]);
  return json(201, { taskId, date: d });
}

export async function removeCompletion(req, taskId, date) {
  const auth = verifyAuth(req);
  if (auth.error) return json(401, { error: auth.error });
  await db.run('DELETE FROM completions WHERE task_id = ? AND user_id = ? AND date = ?', [taskId, auth.user.id, date]);
  return ok({ ok: true });
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------
export async function listNotes(req) {
  const auth = verifyAuth(req);
  if (auth.error) return json(401, { error: auth.error });
  const rows = await db.all('SELECT date, body FROM notes WHERE user_id = ? ORDER BY date DESC LIMIT 366', [auth.user.id]);
  return ok(rows);
}

export async function putNote(req, date) {
  const auth = verifyAuth(req);
  if (auth.error) return json(401, { error: auth.error });
  const { body } = req.body || {};
  const text = String(body || '').trim();
  await db.run(
    `INSERT INTO notes (user_id, date, body, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, date) DO UPDATE SET body = excluded.body, updated_at = datetime('now')`,
    [auth.user.id, date, text]
  );
  return ok({ date, body: text });
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
async function dueTaskIdsForDate(userId, date) {
  const rows = await db.all(
    `SELECT t.id FROM tasks t
     LEFT JOIN goals g ON g.id = t.goal_id
     WHERE t.user_id = ? AND t.active = 1
       AND (t.goal_id IS NULL OR (g.active = 1 AND g.start_date <= ? AND g.end_date >= ?))`,
    [userId, date, date]
  );
  return rows.map((r) => r.id);
}

async function userStats(userId) {
  const today = isoDate();

  // Bulk-load all active tasks + all completions once (avoids HTTP round-trips on Turso).
  const allTasks = await db.all('SELECT id, goal_id FROM tasks WHERE user_id = ? AND active = 1', [userId]);
  const allTaskIds = allTasks.map((t) => t.id);
  const goalIds = [...new Set(allTasks.map((t) => t.goal_id).filter(Boolean))];
  const goals =
    goalIds.length > 0
      ? await db.all(`SELECT id, start_date, end_date FROM goals WHERE id IN (${goalIds.map(() => '?').join(',')})`, goalIds)
      : [];
  const goalMap = new Map(goals.map((g) => [g.id, g]));

  const dueOn = (date) =>
    allTasks.filter((t) => !t.goal_id || (goalMap.get(t.goal_id) && goalMap.get(t.goal_id).start_date <= date && goalMap.get(t.goal_id).end_date >= date)).map((t) => t.id);

  const comps = allTaskIds.length
    ? await db.all(
        `SELECT task_id, date FROM completions WHERE user_id = ? AND task_id IN (${allTaskIds.map(() => '?').join(',')})`,
        [userId, ...allTaskIds]
      )
    : [];

  const dueToday = dueOn(today);
  const byDate = {};
  for (const c of comps) (byDate[c.date] = byDate[c.date] || []).push(c.task_id);

  const daily = [];
  for (const [date, ids] of Object.entries(byDate)) {
    const due = dueOn(date);
    if (due.length && due.every((id) => ids.includes(id))) daily.push(date);
  }

  const streaks = computeStreaks(daily.map((date) => ({ date })), today);

  let last30Count = 0;
  let due30Count = 0;
  for (let i = 0; i < 30; i++) {
    const d = addDays(today, -i);
    due30Count += dueOn(d).length;
    if (byDate[d]) last30Count += byDate[d].filter((id) => dueOn(d).includes(id)).length;
  }

  return {
    taskCount: dueToday.length,
    currentStreak: streaks.current,
    bestStreak: streaks.best,
    totalCompletions: comps.length,
    last30Completions: last30Count,
    completionRate: due30Count ? Math.round((last30Count / due30Count) * 100) : 0,
    bestDay: 0,
    daily,
  };
}

export async function getStats(req) {
  const auth = verifyAuth(req);
  if (auth.error) return json(401, { error: auth.error });
  return ok(await userStats(auth.user.id));
}

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------
export async function listUsers(req) {
  const auth = verifyAuth(req);
  if (auth.error) return json(401, { error: auth.error });
  const rows = await db.all('SELECT id, username, display_name FROM users ORDER BY display_name');
  return ok(rows);
}

export async function listFriends(req) {
  const auth = verifyAuth(req);
  if (auth.error) return json(401, { error: auth.error });
  const users = await db.all(
    'SELECT id, username, display_name AS displayName FROM users WHERE id != ?',
    [auth.user.id]
  );
  const result = [];
  for (const u of users) {
    result.push({ ...u, stats: await userStats(u.id) });
  }
  return ok(result);
}

export { userStats };
