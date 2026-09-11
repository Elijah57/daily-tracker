import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { isoDate, addDays, daysBetween, computeStreaks } from '../stats.js';

const JWT_SECRET = process.env.JWT_SECRET || 'daily-tracker-dev-secret-change-me';

// Weekday numbers (0=Sun .. 6=Sat) match JS Date#getDay() and SQLite
// strftime('%w'). Tasks store a comma-separated list, e.g. "2,5" for Tue/Fri.
// Empty/undefined means the task runs every day.
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function normalizeWeekdays(weekdays) {
  if (Array.isArray(weekdays)) {
    const cleaned = [...new Set(weekdays.map(Number))]
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
      .sort((a, b) => a - b);
    return cleaned.length ? cleaned.join(',') : null;
  }
  if (typeof weekdays === 'string' && weekdays.trim()) {
    const cleaned = [...new Set(weekdays.split(',').map(Number))]
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
      .sort((a, b) => a - b);
    return cleaned.length ? cleaned.join(',') : null;
  }
  return null;
}

function weekdayMatches(weekdays, dateStr) {
  if (!weekdays) return true;
  const day = new Date(dateStr + 'T00:00:00').getDay();
  return String(weekdays).split(',').map(Number).includes(day);
}

function dueOnTask(t, goalMap, date) {
  if (t.goal_id) {
    const g = goalMap.get(t.goal_id);
    if (!g || g.start_date > date || g.end_date < date) return false;
  }
  return weekdayMatches(t.weekdays, date);
}

// Current streak for a single task: consecutive scheduled days (per weekdays +
// goal range) walking backwards from today, completed. Today being incomplete
// doesn't break the streak (mirrors computeStreaks).
function taskCurrentStreak(completedSet, t, goalMap, today) {
  let streak = 0;
  let cursor = today;
  if (!completedSet.has(cursor)) cursor = addDays(today, -1);
  for (let guard = 0; guard < 3660; guard++) {
    if (!dueOnTask(t, goalMap, cursor)) {
      cursor = addDays(cursor, -1);
      continue;
    }
    if (!completedSet.has(cursor)) break;
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

// { done, total, percent } for a goal, counting each scheduled day inside the
// goal's date range that had at least one active task, done when all of them
// were completed that day.
function goalProgress(g, tasks, compsByTask) {
  const span = daysBetween(g.start_date, g.end_date);
  let total = 0;
  let done = 0;
  for (let i = 0; i <= span; i++) {
    const date = addDays(g.start_date, i);
    const due = tasks.filter((t) => weekdayMatches(t.weekdays, date));
    if (!due.length) continue;
    total++;
    if (due.every((t) => compsByTask.get(t.id) && compsByTask.get(t.id).has(date))) done++;
  }
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

// SQL fragment appended in WHERE clauses: true when a task with this weekday
// list is due on the given date (bound as the next positional param).
const WEEKDAY_SQL =
  "(t.weekdays IS NULL OR t.weekdays = '' OR INSTR(',' || t.weekdays || ',', ',' || CAST(strftime('%w', ?) AS TEXT) || ',') > 0)";

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
       AND ${WEEKDAY_SQL}
     ORDER BY t.position, t.id`,
    [userId, date, date, date]
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

  // Bulk-load all goal tasks + completions once so each goal's progress is a
  // simple in-memory computation (avoids N queries on Turso).
  const taskRows = await db.all(
    'SELECT * FROM tasks WHERE user_id = ? AND goal_id IS NOT NULL AND active = 1 ORDER BY position, id',
    [auth.user.id]
  );
  const compRows = await db.all('SELECT task_id, date FROM completions WHERE user_id = ?', [auth.user.id]);
  const compsByTask = new Map();
  for (const c of compRows) {
    if (!compsByTask.has(c.task_id)) compsByTask.set(c.task_id, new Set());
    compsByTask.get(c.task_id).add(c.date);
  }
  const tasksByGoal = new Map();
  for (const t of taskRows) {
    if (!tasksByGoal.has(t.goal_id)) tasksByGoal.set(t.goal_id, []);
    tasksByGoal.get(t.goal_id).push(t);
  }

  const result = [];
  for (const g of rows) {
    const goalTasks = tasksByGoal.get(g.id) || [];
    result.push({ ...g, progress: goalProgress(g, goalTasks, compsByTask), tasks: await withGoal(goalTasks) });
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
  const { title, color, description, time, goalId, weekdays } = req.body || {};
  if (!title || !String(title).trim()) return json(400, { error: 'Task title is required' });
  if (goalId) {
    const goal = await db.get('SELECT * FROM goals WHERE id = ? AND user_id = ?', [goalId, auth.user.id]);
    if (!goal) return json(404, { error: 'Goal not found' });
  }
  const posRow = await db.get('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM tasks WHERE user_id = ?', [auth.user.id]);
  const info = await db.run(
    'INSERT INTO tasks (user_id, title, description, time, color, position, goal_id, weekdays) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      auth.user.id,
      String(title).trim(),
      (description || '').trim() || null,
      time || null,
      color || null,
      posRow.p,
      goalId || null,
      normalizeWeekdays(weekdays),
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
  const { title, color, active, position, description, time, weekdays } = req.body || {};
  const fields = [];
  const values = [];
  if (title !== undefined) { fields.push('title = ?'); values.push(String(title).trim()); }
  if (description !== undefined) { fields.push('description = ?'); values.push(String(description).trim() || null); }
  if (time !== undefined) { fields.push('time = ?'); values.push(time || null); }
  if (color !== undefined) { fields.push('color = ?'); values.push(color || null); }
  if (active !== undefined) { fields.push('active = ?'); values.push(active ? 1 : 0); }
  if (position !== undefined) { fields.push('position = ?'); values.push(position); }
  if (weekdays !== undefined) { fields.push('weekdays = ?'); values.push(normalizeWeekdays(weekdays)); }
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
  await db.run(
    `INSERT INTO completions (task_id, user_id, date, task_title, task_color)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(task_id, date) DO UPDATE SET
       task_title = excluded.task_title,
       task_color = excluded.task_color`,
    [taskId, auth.user.id, d, task.title, task.color]
  );
  return json(201, { taskId, date: d });
}

export async function removeCompletion(req, taskId, date) {
  const auth = verifyAuth(req);
  if (auth.error) return json(401, { error: auth.error });
  await db.run('DELETE FROM completions WHERE task_id = ? AND user_id = ? AND date = ?', [taskId, auth.user.id, date]);
  return ok({ ok: true });
}

// ---------------------------------------------------------------------------
// History (all-time completion log)
// ---------------------------------------------------------------------------
export async function getHistory(req, query) {
  const auth = verifyAuth(req);
  if (auth.error) return json(401, { error: auth.error });
  const days = query && query.days && !Number.isNaN(parseInt(query.days, 10)) ? parseInt(query.days, 10) : 0;

  let sql = 'SELECT id, task_id, date, task_title, task_color, created_at FROM completions WHERE user_id = ?';
  const params = [auth.user.id];
  if (days > 0) {
    sql += ' AND date >= ?';
    params.push(addDays(isoDate(), -(days - 1)));
  }
  sql += ' ORDER BY date DESC, id DESC LIMIT 2000';

  const rows = await db.all(sql, params);
  if (!rows.length) return ok({ total: 0, events: [] });

  const ids = [...new Set(rows.map((r) => r.task_id))];
  const tasks = await db.all(
    `SELECT id, title, color, active FROM tasks WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
    [auth.user.id, ...ids]
  );
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  // Prefer the live task (if it still exists and is active), else the snapshot.
  const events = rows.map((r) => {
    const live = taskMap.get(r.task_id);
    const current = live && live.active ? live : null;
    return {
      id: r.id,
      taskId: r.task_id,
      date: r.date,
      createdAt: r.created_at,
      title: (current && current.title) || r.task_title || null,
      color: (current && current.color) || r.task_color || null,
    };
  });

  return ok({ total: rows.length, events });
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
       AND (t.goal_id IS NULL OR (g.active = 1 AND g.start_date <= ? AND g.end_date >= ?))
       AND ${WEEKDAY_SQL}`,
    [userId, date, date, date]
  );
  return rows.map((r) => r.id);
}

async function userStats(userId) {
  const today = isoDate();

  // Bulk-load all active tasks + all completions once (avoids HTTP round-trips on Turso).
  const allTasks = await db.all(
    'SELECT id, goal_id, weekdays, title, color FROM tasks WHERE user_id = ? AND active = 1',
    [userId]
  );
  const allTaskIds = allTasks.map((t) => t.id);
  const goalIds = [...new Set(allTasks.map((t) => t.goal_id).filter(Boolean))];
  const goals =
    goalIds.length > 0
      ? await db.all(`SELECT id, start_date, end_date FROM goals WHERE id IN (${goalIds.map(() => '?').join(',')})`, goalIds)
      : [];
  const goalMap = new Map(goals.map((g) => [g.id, g]));

  const dueOn = (date) =>
    allTasks
      .filter(
        (t) =>
          (!t.goal_id || (goalMap.get(t.goal_id) && goalMap.get(t.goal_id).start_date <= date && goalMap.get(t.goal_id).end_date >= date)) &&
          weekdayMatches(t.weekdays, date)
      )
      .map((t) => t.id);

  const comps = await db.all(
    'SELECT task_id, date, task_title, task_color FROM completions WHERE user_id = ?',
    [userId]
  );
  const compsByTask = new Map();
  for (const c of comps) {
    if (!compsByTask.has(c.task_id)) compsByTask.set(c.task_id, new Set());
    compsByTask.get(c.task_id).add(c.date);
  }

  const dueToday = dueOn(today);
  const byDate = {};
  for (const c of comps) (byDate[c.date] = byDate[c.date] || []).push(c.task_id);

  const daily = [];
  for (const [date, ids] of Object.entries(byDate)) {
    const due = dueOn(date);
    if (due.length && due.every((id) => ids.includes(id))) daily.push(date);
  }

  const streaks = computeStreaks(daily.map((date) => ({ date })), today);

  const last30 = [];
  let last30Completions = 0;
  let due30Count = 0;
  for (let i = 29; i >= 0; i--) {
    const d = addDays(today, -i);
    const due = dueOn(d);
    const done = byDate[d] ? byDate[d].filter((id) => due.includes(id)).length : 0;
    last30.push({ date: d, done, total: due.length });
    last30Completions += done;
    due30Count += due.length;
  }

  // All-time analytics.
  const weekdayTotals = [0, 0, 0, 0, 0, 0, 0];
  const daysDoneSet = new Set();
  const perTaskMap = new Map();
  for (const c of comps) {
    weekdayTotals[new Date(c.date + 'T00:00:00').getDay()]++;
    daysDoneSet.add(c.date);
    let row = perTaskMap.get(c.task_id);
    if (!row) {
      row = { id: c.task_id, title: c.task_title || null, color: c.task_color || null, total: 0, last: c.date };
      perTaskMap.set(c.task_id, row);
    }
    row.total++;
    if (c.date > row.last) row.last = c.date;
  }
  let bestDay = 0;
  for (let i = 1; i < 7; i++) if (weekdayTotals[i] > weekdayTotals[bestDay]) bestDay = i;

  // Last 12 weeks (Sunday-start), for the weekly chart.
  const sunday = addDays(today, -new Date(today + 'T00:00:00').getDay());
  const weekly = [];
  for (let w = 11; w >= 0; w--) {
    const start = addDays(sunday, -7 * w);
    let done = 0;
    let total = 0;
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, d);
      const due = dueOn(date);
      total += due.length;
      done += byDate[date] ? byDate[date].filter((id) => due.includes(id)).length : 0;
    }
    weekly.push({ start, done, total });
  }

  const activeTaskMap = new Map(allTasks.map((t) => [t.id, t]));
  const perTask = [...perTaskMap.values()]
    .map((row) => {
      const t = activeTaskMap.get(row.id);
      if (t) {
        row.title = t.title;
        row.color = t.color;
        row.streak = taskCurrentStreak(compsByTask.get(row.id) || new Set(), t, goalMap, today);
      }
      return row;
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);

  return {
    taskCount: dueToday.length,
    currentStreak: streaks.current,
    bestStreak: streaks.best,
    totalCompletions: comps.length,
    totalDays: daysDoneSet.size,
    last30Completions,
    completionRate: due30Count ? Math.round((last30Completions / due30Count) * 100) : 0,
    bestDay,
    weekdayTotals,
    last30,
    weekly,
    perTask,
    daily,
    perfectDays: daily.length,
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
