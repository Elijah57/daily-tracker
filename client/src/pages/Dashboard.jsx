import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { todayLabel, todayISO, lastNDays, fmt, fmtShort } from '../utils.js';
import GoalsManager from '../components/GoalsManager.jsx';

const PALETTE = ['#a5b8a9', '#c3a6a0', '#b0bec5', '#c9bca5', '#a9a6c0', '#c4b3a9'];

export default function Dashboard() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [goals, setGoals] = useState([]);
  const [stats, setStats] = useState(null);
  const [completions, setCompletions] = useState({});
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newTime, setNewTime] = useState('');
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);
  const [showGoals, setShowGoals] = useState(false);

  const load = useCallback(async () => {
    const [t, g, s, c, n] = await Promise.all([
      api('/tasks'),
      api('/goals'),
      api('/stats'),
      api('/completions?days=120'),
      api('/notes'),
    ]);
    setTasks(t);
    setGoals(g);
    setStats(s);
    const map = {};
    for (const row of c) map[`${row.task_id}:${row.date}`] = true;
    setCompletions(map);
    const todays = n.find((x) => x.date === todayISO());
    setNote(todays?.body || '');
  }, []);

  const refresh = useCallback(async () => {
    const [t, g, s] = await Promise.all([api('/tasks'), api('/goals'), api('/stats')]);
    setTasks(t);
    setGoals(g);
    setStats(s);
  }, []);

  useEffect(() => {
    load()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [load]);

  const toggle = async (task, done, date = todayISO()) => {
    setCompletions((prev) => {
      const key = `${task.id}:${date}`;
      const next = { ...prev };
      if (done) next[key] = true;
      else delete next[key];
      return next;
    });
    try {
      if (done) await api('/completions', { method: 'POST', body: JSON.stringify({ taskId: task.id, date }) });
      else await api(`/completions/${task.id}/${date}`, { method: 'DELETE' });
      const s = await api('/stats');
      setStats(s);
    } catch {
      await load();
    }
  };

  const addTask = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setAdding(true);
    try {
      const task = await api('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle,
          description: newDesc,
          time: newTime,
          color: PALETTE[tasks.length % PALETTE.length],
        }),
      });
      setTasks((prev) => [...prev, task]);
      setNewTitle('');
      setNewDesc('');
      setNewTime('');
      const s = await api('/stats');
      setStats(s);
    } finally {
      setAdding(false);
    }
  };

  const saveNote = async () => {
    const body = note.trim();
    await api(`/notes/${todayISO()}`, { method: 'PUT', body: JSON.stringify({ body }) });
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 2000);
  };

  const removeTask = async (id) => {
    await api(`/tasks/${id}`, { method: 'DELETE' });
    setTasks((prev) => prev.filter((t) => t.id !== id));
    const s = await api('/stats');
    setStats(s);
  };

  const doneToday = tasks.filter((t) => completions[`${t.id}:${todayISO()}`]).length;

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <div className="page">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>
          Good day, {user?.displayName || user?.username}
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>{todayLabel()}</p>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 22 }}>
        <div className="stat">
          <div className="label">Current streak</div>
          <div className="value">{stats?.currentStreak ?? 0}</div>
          {stats?.currentStreak === 0 && <div className="sub">Complete all tasks today to start</div>}
          {stats?.currentStreak === 1 && <div className="sub">Good start — keep going!</div>}
          {stats?.currentStreak > 1 && <div className="sub">days in a row</div>}
        </div>
        <div className="stat">
          <div className="label">Best streak</div>
          <div className="value">{stats?.bestStreak ?? 0}</div>
          <div className="sub">your personal record</div>
        </div>
        <div className="stat">
          <div className="label">Today's progress</div>
          <div className="value">
            {doneToday}/{tasks.length}
          </div>
          <div className="progress-wrap">
            <div
              className="progress-fill"
              style={{ width: `${tasks.length ? (doneToday / tasks.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn" onClick={() => setShowGoals(true)}>
          Manage goals
        </button>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="section-title">Today's tasks</div>
          {tasks.length === 0 ? (
            <div className="empty">
              No tasks due today. Add a daily habit below, or create a goal with recurring tasks.
            </div>
          ) : (
            tasks.map((task) => {
              const done = !!completions[`${task.id}:${todayISO()}`];
              return (
                <div key={task.id} className={`task ${done ? 'done' : ''}`}>
                  <button
                    className="check"
                    onClick={() => toggle(task, !done)}
                    aria-label={done ? 'Unmark complete' : 'Mark complete'}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                  <span className="dot" style={{ background: task.color || 'var(--surface-matte)' }} />
                  <span className="title">
                    {task.title}
                    {(task.description || task.time) && (
                      <span className="task-meta">
                        {task.time && <span className="task-time">at {task.time}</span>}
                        {task.description && <span className="task-desc">{task.description}</span>}
                      </span>
                    )}
                    {task.goal && (
                      <span className="goal-tag" style={{ '--gc': task.goal.color || '#a5b8a9' }}>
                        {task.goal.title}
                      </span>
                    )}
                  </span>
                  <button className="del" onClick={() => removeTask(task.id)} aria-label="Delete task">
                    ✕
                  </button>
                </div>
              );
            })
          )}

          <form className="add-row add-col" onSubmit={addTask}>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Add a normal daily task…"
            />
            <div className="add-sub">
              <input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Description (optional)"
              />
              <input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="add-time"
              />
            </div>
            <button className="btn" disabled={adding || !newTitle.trim()}>
              Add
            </button>
          </form>

          <button className="btn btn-ghost goal-link" onClick={() => setShowGoals(true)}>
            Create a goal with recurring tasks →
          </button>
        </div>

        <div className="card">
          <div className="section-title">Weekly view</div>
          <StreakCalendar completions={completions} tasks={tasks} />
          <div className="week-days">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>

          <div style={{ marginTop: 22 }}>
            <div className="section-title">Note for today</div>
            <textarea
              className="note-box"
              rows={3}
              value={note}
              onChange={(e) => { setNote(e.target.value); setNoteSaved(false); }}
              placeholder="Jot down a note for the day…"
            />
            <button className="btn btn-ghost" onClick={saveNote} style={{ marginTop: 8 }}>
              {noteSaved ? 'Saved ✓' : 'Save note'}
            </button>
          </div>
        </div>
      </div>

      {showGoals && (
        <GoalsManager
          goals={goals}
          onClose={() => setShowGoals(false)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function StreakCalendar({ completions, tasks }) {
  const days = lastNDays(90);
  const today = todayISO();
  const allDone = (date) => tasks.length > 0 && tasks.every((t) => completions[`${t.id}:${date}`]);

  const months = [];
  let cursor = days[0].slice(0, 7);
  let chunk = [];
  for (const d of days) {
    const m = d.slice(0, 7);
    if (m !== cursor) {
      months.push({ id: cursor, cells: chunk });
      cursor = m;
      chunk = [];
    }
    chunk.push(d);
  }
  if (chunk.length) months.push({ id: cursor, cells: chunk });

  return (
    <div>
      {months.map((month) => (
        <div key={month.id}>
          <div className="cal-month">
            <span>{fmt(month.id)}</span>
            <span>
              {month.cells.filter((d) => allDone(d)).length}/{month.cells.length}
            </span>
          </div>
          <div className="calendar">
            {month.cells.map((d) => (
              <div
                key={d}
                className={`cal-cell ${allDone(d) ? 'hit' : ''}`}
                title={`${d}${allDone(d) ? ' — all done' : ''}`}
                style={{ cursor: 'default' }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}


