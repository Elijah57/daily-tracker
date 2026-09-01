import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import db from './db.js';
import { requireAuth, signToken } from './auth.js';
import { isoDate, addDays, computeStreaks, groupByDate, daysBetween } from './stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// ---------------- Auth ----------------
app.post('/api/auth/register', (req, res) => {
  const { username, password, displayName } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }
  const cleanUser = String(username).trim().toLowerCase();
  if (!/^[a-z0-9_]{2,20}$/.test(cleanUser)) {
    return res.status(400).json({ error: 'Username must be 2-20 chars (letters, numbers, underscore)' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUser);
  if (exists) {
    return res.status(409).json({ error: 'Username already taken' });
  }
  const hash = bcrypt.hashSync(String(password), 10);
  const display = (displayName || '').trim() || cleanUser;
  const info = db
    .prepare('INSERT INTO users (username, password, display_name) VALUES (?, ?, ?)')
    .run(cleanUser, hash, display);
  const user = { id: info.lastInsertRowid, username: cleanUser, displayName: display };
  res.status(201).json({ token: signToken(user), user });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const cleanUser = String(username || '').trim().toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(cleanUser);
  if (!row || !bcrypt.compareSync(String(password || ''), row.password)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const user = { id: row.id, username: row.username, displayName: row.display_name };
  res.json({ token: signToken(user), user });
});

app.get('/api/me', requireAuth, (req, res) => {
  const row = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(req.user.id);
  if (!row) return res.status(404).json({ error: 'User not found' });
  res.json({ id: row.id, username: row.username, displayName: row.display_name });
});

// ---------------- Goals ----------------
// A task belongs to a goal via task.goal_id. Goal tasks only appear on the
// tracker on dates within the goal's [start_date, end_date] range, but they
// are created ONCE and auto-recur every day of that range.

function withGoal(tasks) {
  return tasks.map((t) => {
    const g = t.goal_id ? db.prepare('SELECT * FROM goals WHERE id = ?').get(t.goal_id) : null;
    return {
      ...t,
      goal: g || null,
    };
  });
}

// Tasks that are due for the given user on the given date: all standalone
// tasks (no goal) plus goal tasks whose goal range covers the date.
function tasksForDate(userId, date) {
  const rows = db
    .prepare(
      `SELECT t.* FROM tasks t
       LEFT JOIN goals g ON g.id = t.goal_id
       WHERE t.user_id = ? AND t.active = 1
         AND (t.goal_id IS NULL OR (g.active = 1 AND g.start_date <= ? AND g.end_date >= ?))
       ORDER BY t.position, t.id`
    )
    .all(userId, date, date);
  return withGoal(rows);
}

app.get('/api/goals', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM goals WHERE user_id = ? AND active = 1 ORDER BY start_date, id')
    .all(req.user.id);
  const result = rows.map((g) => ({
    ...g,
    tasks: withGoal(
      db.prepare('SELECT * FROM tasks WHERE user_id = ? AND goal_id = ? AND active = 1 ORDER BY position, id').all(req.user.id, g.id)
    ),
  }));
  res.json(result);
});

app.post('/api/goals', requireAuth, (req, res) => {
  const { title, color, startDate, endDate } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'Goal title is required' });
  }
  if (!startDate || !endDate || endDate < startDate) {
    return res.status(400).json({ error: 'A valid start and end date are required' });
  }
  const info = db
    .prepare('INSERT INTO goals (user_id, title, color, start_date, end_date) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, String(title).trim(), color || null, startDate, endDate);
  const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ ...goal, tasks: [] });
});

app.patch('/api/goals/:id', requireAuth, (req, res) => {
  const goal = db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  const { title, color, startDate, endDate, active } = req.body || {};
  const fields = [];
  const values = [];
  if (title !== undefined) { fields.push('title = ?'); values.push(String(title).trim()); }
  if (color !== undefined) { fields.push('color = ?'); values.push(color || null); }
  if (startDate !== undefined) { fields.push('start_date = ?'); values.push(startDate); }
  if (endDate !== undefined) { fields.push('end_date = ?'); values.push(endDate); }
  if (active !== undefined) { fields.push('active = ?'); values.push(active ? 1 : 0); }
  if (fields.length) {
    values.push(req.params.id, req.user.id);
    db.prepare(`UPDATE goals SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
  }
  const updated = db.prepare('SELECT * FROM goals WHERE id = ?').get(req.params.id);
  res.json({ ...updated, tasks: withGoal(db.prepare('SELECT * FROM tasks WHERE goal_id = ? AND active = 1').all(updated.id)) });
});

app.delete('/api/goals/:id', requireAuth, (req, res) => {
  const goal = db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  // Remove the goal's recurring tasks too, so they no longer appear on the tracker.
  db.prepare('DELETE FROM tasks WHERE goal_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  db.prepare('DELETE FROM goals WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------------- Tasks ----------------
app.get('/api/tasks', requireAuth, (req, res) => {
  res.json(tasksForDate(req.user.id, isoDate()));
});

app.post('/api/tasks', requireAuth, (req, res) => {
  const { title, color, description, time, goalId } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'Task title is required' });
  }
  if (goalId) {
    const goal = db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(goalId, req.user.id);
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
  }
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM tasks WHERE user_id = ?').get(req.user.id).p;
  const goal = goalId || null;
  const info = db
    .prepare('INSERT INTO tasks (user_id, title, description, time, color, position, goal_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.user.id, String(title).trim(), (description || '').trim() || null, time || null, color || null, pos, goal);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(withGoal([task])[0]);
});

app.patch('/api/tasks/:id', requireAuth, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { title, color, active, position, description, time } = req.body || {};
  const fields = [];
  const values = [];
  if (title !== undefined) { fields.push('title = ?'); values.push(String(title).trim()); }
  if (description !== undefined) { fields.push('description = ?'); values.push(String(description).trim() || null); }
  if (time !== undefined) { fields.push('time = ?'); values.push(time || null); }
  if (color !== undefined) { fields.push('color = ?'); values.push(color || null); }
  if (active !== undefined) { fields.push('active = ?'); values.push(active ? 1 : 0); }
  if (position !== undefined) { fields.push('position = ?'); values.push(position); }
  if (fields.length === 0) return res.json(withGoal([task])[0]);
  values.push(req.params.id, req.user.id);
  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  res.json(withGoal([updated])[0]);
});

app.delete('/api/tasks/:id', requireAuth, (req, res) => {
  const info = db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Task not found' });
  res.json({ ok: true });
});

// ---------------- Completions ----------------
app.get('/api/completions', requireAuth, (req, res) => {
  const days = Math.min(parseInt(req.query.days || '30', 10), 365);
  const from = addDays(isoDate(), -(days - 1));
  const rows = db
    .prepare('SELECT task_id, date FROM completions WHERE user_id = ? AND date >= ? ORDER BY date')
    .all(req.user.id, from);
  res.json(rows);
});

app.post('/api/completions', requireAuth, (req, res) => {
  const { taskId, date } = req.body || {};
  const d = date || isoDate();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(taskId, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  db.prepare('INSERT OR IGNORE INTO completions (task_id, user_id, date) VALUES (?, ?, ?)').run(taskId, req.user.id, d);
  res.status(201).json({ taskId, date: d });
});

app.delete('/api/completions/:taskId/:date', requireAuth, (req, res) => {
  db.prepare('DELETE FROM completions WHERE task_id = ? AND user_id = ? AND date = ?').run(
    req.params.taskId,
    req.user.id,
    req.params.date
  );
  res.json({ ok: true });
});

// ---------------- Notes (daily journal) ----------------
app.get('/api/notes', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT date, body FROM notes WHERE user_id = ? ORDER BY date DESC LIMIT 366')
    .all(req.user.id);
  res.json(rows);
});

app.put('/api/notes/:date', requireAuth, (req, res) => {
  const { body } = req.body || {};
  const text = String(body || '').trim();
  db.prepare(
    `INSERT INTO notes (user_id, date, body, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, date) DO UPDATE SET body = excluded.body, updated_at = datetime('now')`
  ).run(req.user.id, req.params.date, text);
  res.json({ date: req.params.date, body: text });
});

// ---------------- Stats ----------------
// For a given date, determine which of the user's tasks were "due" (standalone
// tasks always count; goal tasks only within their goal's range). This makes
// streaks/rates reflect only the tasks actually expected on each day.
function dueTaskIdsForDate(userId, date) {
  const rows = db
    .prepare(
      `SELECT t.id FROM tasks t
       LEFT JOIN goals g ON g.id = t.goal_id
       WHERE t.user_id = ? AND t.active = 1
         AND (t.goal_id IS NULL OR (g.active = 1 AND g.start_date <= ? AND g.end_date >= ?))`
    )
    .all(userId, date, date);
  return rows.map((r) => r.id);
}

function userStats(userId) {
  const today = isoDate();
  const dueToday = dueTaskIdsForDate(userId, today);

  // Pull completions for all of this user's active-or-goal tasks (wide net),
  // then compute per-day expected/actual.
  const allTaskIds = db
    .prepare('SELECT t.id FROM tasks t WHERE t.user_id = ? AND t.active = 1')
    .all(userId)
    .map((r) => r.id);

  const comps = allTaskIds.length
    ? db
        .prepare(
          `SELECT task_id, date FROM completions WHERE user_id = ? AND task_id IN (${allTaskIds.map(() => '?').join(',')})`
        )
        .all(userId, ...allTaskIds)
    : [];

  // Group completions by date, then evaluate completeness against tasks due that day.
  const daily = new Set();
  const byDate = {};
  for (const c of comps) (byDate[c.date] = byDate[c.date] || []).push(c.task_id);

  for (const [date, ids] of Object.entries(byDate)) {
    const due = dueTaskIdsForDate(userId, date);
    if (due.length && due.every((id) => ids.includes(id))) {
      daily.add(date);
    }
  }

  const dailyArr = [...daily];
  const streaks = computeStreaks(dailyArr.map((date) => ({ date })), today);

  const totalCompletions = comps.length;

  // Completion rate over the last 30 days vs. tasks actually due in that window.
  let last30Count = 0;
  let due30Count = 0;
  for (let i = 0; i < 30; i++) {
    const d = addDays(today, -i);
    due30Count += dueTaskIdsForDate(userId, d).length;
    if (byDate[d]) last30Count += byDate[d].filter((id) => dueTaskIdsForDate(userId, d).includes(id)).length;
  }

  return {
    taskCount: dueToday.length,
    currentStreak: streaks.current,
    bestStreak: streaks.best,
    totalCompletions,
    last30Completions: last30Count,
    completionRate: due30Count ? Math.round((last30Count / due30Count) * 100) : 0,
    bestDay: 0, // reserved
    daily: dailyArr,
  };
}

app.get('/api/stats', requireAuth, (req, res) => {
  res.json(userStats(req.user.id));
});

// ---------------- Friends / social ----------------
app.get('/api/users', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT id, username, display_name FROM users ORDER BY display_name').all();
  res.json(rows);
});

app.get('/api/friends', requireAuth, (req, res) => {
  const users = db.prepare('SELECT id, username, display_name AS displayName FROM users WHERE id != ?').all(req.user.id);
  const result = users.map((u) => ({ ...u, stats: userStats(u.id) }));
  res.json(result);
});

// ---------------- Static frontend (production build) ----------------
const clientBuild = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientBuild)) {
  app.use(express.static(clientBuild));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuild, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Daily Tracker running on http://localhost:${PORT}`);
});
