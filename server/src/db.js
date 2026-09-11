import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { createClient } from '@libsql/client';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  display_name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  color TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  time TEXT,
  color TEXT,
  position INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  goal_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  task_title TEXT,
  task_color TEXT,
  skipped INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(task_id, date)
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_completions_user_date ON completions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_user_date ON notes(user_id, date);
`;

// Determine the DB source: Turso cloud (TURSO_DATABASE_URL) or local file.
function buildClient() {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (tursoUrl) {
    return createClient({ url: tursoUrl, authToken: authToken || undefined });
  }

  const dataDir = path.join(sourceDir, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return createClient({ url: `file:${path.join(dataDir, 'daily-tracker.db')}` });
}

async function init(client) {
  await client.batch(SCHEMA.split(';').filter((s) => s.trim()).map((sql) => ({ sql, args: [] })));

  // migrations: ensure optional task columns exist (ignore errors if present).
  let cols = [];
  try {
    const res = await client.execute('PRAGMA table_info(tasks)');
    cols = res.rows.map((r) => r.name);
  } catch {
    return;
  }
  const add = (name, ddl) => {
    if (!cols.includes(name)) {
      return client.execute(`ALTER TABLE tasks ADD COLUMN ${ddl}`).catch(() => {});
    }
    return Promise.resolve();
  };
  await add('description', 'description TEXT');
  await add('time', 'time TEXT');
  await add('goal_id', 'goal_id INTEGER');
  await add('weekdays', 'weekdays TEXT');

  // Migrations for completions: snapshot the task's title/color at completion
  // time so the history log survives task and goal deletion.
  let compCols = [];
  try {
    const res = await client.execute('PRAGMA table_info(completions)');
    compCols = res.rows.map((r) => r.name);
  } catch {
    return;
  }
  const addComp = (name, ddl) => {
    if (!compCols.includes(name)) {
      return client.execute(`ALTER TABLE completions ADD COLUMN ${ddl}`).catch(() => {});
    }
    return Promise.resolve();
  };
  await addComp('task_title', 'task_title TEXT');
  await addComp('task_color', 'task_color TEXT');
  await addComp('skipped', 'skipped INTEGER DEFAULT 0');

  // Backfill snapshots for rows created before the columns existed.
  await client.execute(
    `UPDATE completions SET
       task_title = COALESCE((SELECT title FROM tasks WHERE tasks.id = completions.task_id), task_title),
       task_color = COALESCE((SELECT color FROM tasks WHERE tasks.id = completions.task_id), task_color)
     WHERE task_title IS NULL`
  );
}

let db = null;
let initPromise = null;

// Returns a shared, initialized client (lazy + memoized).
export async function getDb() {
  if (db) return db;
  if (!initPromise) {
    initPromise = (async () => {
      const client = buildClient();
      await init(client);
      db = { client, run, get, all };
      return db;
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

async function run(sql, params = []) {
  const res = await (await getDb()).client.execute({ sql, args: params });
  return { changes: res.rowsAffected, lastInsertRowid: Number(res.lastInsertRowid) };
}

async function get(sql, params = []) {
  const res = await (await getDb()).client.execute({ sql, args: params });
  return res.rows[0] || null;
}

async function all(sql, params = []) {
  const res = await (await getDb()).client.execute({ sql, args: params });
  return res.rows;
}

// Proxy so handlers can call db.get/all/run without awaiting init first.
const dbProxy = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === 'get') return get;
      if (prop === 'all') return all;
      if (prop === 'run') return run;
      return undefined;
    },
  }
);

export default dbProxy;
