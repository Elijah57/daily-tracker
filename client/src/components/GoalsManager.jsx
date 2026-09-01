import React, { useState } from 'react';
import { api } from '../api.js';
import { todayISO, addDaysISO, fmtShort } from '../utils.js';

const GOAL_COLORS = ['#a5b8a9', '#c3a6a0', '#b0bec5', '#c9bca5', '#a9a6c0', '#c4b3a9', '#d6b0a0'];

export default function GoalsManager({ goals, onClose, onChanged }) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankForm(goals.length));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const startCreate = () => {
    setEditing(null);
    setForm(blankForm(goals.length));
    setCreating(true);
    setError('');
  };

  const startEdit = (g) => {
    setCreating(false);
    setEditing(g);
    setForm({ title: g.title, color: g.color || GOAL_COLORS[0], startDate: g.start_date, endDate: g.end_date });
    setError('');
  };

  const cancel = () => {
    setCreating(false);
    setEditing(null);
    setError('');
  };

  const saveGoal = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { setError('Give the goal a name'); return; }
    if (form.endDate < form.startDate) { setError('End date must be after start date'); return; }
    setBusy(true);
    setError('');
    try {
      if (editing) {
        await api(`/goals/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ title: form.title, color: form.color, startDate: form.startDate, endDate: form.endDate }),
        });
      } else {
        await api('/goals', {
          method: 'POST',
          body: JSON.stringify({ title: form.title, color: form.color, startDate: form.startDate, endDate: form.endDate }),
        });
      }
      cancel();
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const removeGoal = async (goal) => {
    if (!confirm(`Delete goal "${goal.title}"? Its recurring tasks will be removed from your tracker.`)) return;
    await api(`/goals/${goal.id}`, { method: 'DELETE' });
    if (editing?.id === goal.id) setEditing(null);
    await onChanged();
  };

  const active = goals.filter((g) => todayISO() <= g.end_date && todayISO() >= g.start_date);
  const upcoming = goals.filter((g) => todayISO() < g.start_date);
  const ended = goals.filter((g) => todayISO() > g.end_date);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Goals</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {!creating && !editing && (
            <button className="btn" onClick={startCreate} style={{ marginBottom: 16 }}>
              + New goal
            </button>
          )}

          {(creating || editing) && (
            <form className="goal-form" onSubmit={saveGoal}>
              <div className="field">
                <label>Goal name</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Get fit, Learn guitar…" autoFocus />
              </div>
              <div className="field">
                <label>Duration</label>
                <div className="date-range">
                  <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                  <span>→</span>
                  <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                </div>
                <p className="hint">Recurring tasks show on your tracker every day in this range.</p>
              </div>
              <div className="field">
                <label>Color tag</label>
                <div className="color-row">
                  {GOAL_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`color-swatch ${form.color === c ? 'active' : ''}`}
                      style={{ background: c }}
                      onClick={() => setForm({ ...form, color: c })}
                      aria-label={c}
                    />
                  ))}
                </div>
              </div>
              {error && <div className="error">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={cancel}>Cancel</button>
                <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save goal'}</button>
              </div>
            </form>
          )}

          {!creating && !editing && (
            <div className="goal-list">
              {goals.length === 0 && (
                <div className="empty">No goals yet. Create one to add recurring tasks that show up daily.</div>
              )}

              {active.length > 0 && <GoalGroup title="Active" goals={active} onEdit={startEdit} onRemove={removeGoal} onChanged={onChanged} />}
              {upcoming.length > 0 && <GoalGroup title="Upcoming" goals={upcoming} onEdit={startEdit} onRemove={removeGoal} onChanged={onChanged} />}
              {ended.length > 0 && <GoalGroup title="Ended" goals={ended} onEdit={startEdit} onRemove={removeGoal} onChanged={onChanged} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function blankForm(n) {
  return {
    title: '',
    color: GOAL_COLORS[n % GOAL_COLORS.length],
    startDate: todayISO(),
    endDate: addDaysISO(todayISO(), 30),
  };
}

function GoalGroup({ title, goals, onEdit, onRemove, onChanged }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="section-title">{title}</div>
      {goals.map((g) => (
        <GoalItem key={g.id} goal={g} onEdit={onEdit} onRemove={onRemove} onChanged={onChanged} />
      ))}
    </div>
  );
}

function GoalItem({ goal, onEdit, onRemove, onChanged }) {
  const [openAdd, setOpenAdd] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: '', time: '', description: '' });
  const [busy, setBusy] = useState(false);

  const addTask = async () => {
    if (!taskForm.title.trim()) return;
    setBusy(true);
    try {
      await api('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: taskForm.title,
          description: taskForm.description,
          time: taskForm.time || null,
          goalId: goal.id,
          color: goal.color,
        }),
      });
      setTaskForm({ title: '', time: '', description: '' });
      setOpenAdd(false);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const removeTask = async (taskId) => {
    await api(`/tasks/${taskId}`, { method: 'DELETE' });
    await onChanged();
  };

  return (
    <div className="goal-item" style={{ '--gc': goal.color || '#a5b8a9' }}>
      <div className="goal-bar" />
      <div className="goal-content">
        <div className="goal-top">
          <span className="goal-item-title">{goal.title}</span>
          <span className="goal-dates">{fmtShort(goal.start_date)} – {fmtShort(goal.end_date)}</span>
          <div className="goal-actions">
            <button className="mini-btn" onClick={() => onEdit(goal)}>Edit</button>
            <button className="mini-btn danger" onClick={() => onRemove(goal)}>Delete</button>
          </div>
        </div>

        {goal.tasks.length > 0 && (
          <div className="goal-tasks">
            {goal.tasks.map((t) => (
              <div key={t.id} className="goal-task">
                <span>{t.title}</span>
                <span className="goal-task-meta">
                  {t.time && <span className="task-time">at {t.time}</span>}
                  {t.description && <span className="goal-task-desc">{t.description}</span>}
                </span>
                <button className="mini-btn danger del-task" onClick={() => removeTask(t.id)} title="Remove task">✕</button>
              </div>
            ))}
          </div>
        )}

        {openAdd && (
          <div className="goal-add">
            <input
              value={taskForm.title}
              onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
              placeholder="Recurring task title"
            />
            <div className="add-sub">
              <input
                value={taskForm.description}
                onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                placeholder="Description (optional)"
              />
              <input
                type="time"
                value={taskForm.time}
                onChange={(e) => setTaskForm({ ...taskForm, time: e.target.value })}
              />
            </div>
            <button className="btn" onClick={addTask} disabled={busy || !taskForm.title.trim()}>
              Add task
            </button>
          </div>
        )}

        {!openAdd && (
          <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setOpenAdd(true)}>
            + Recurring task
          </button>
        )}
      </div>
    </div>
  );
}
