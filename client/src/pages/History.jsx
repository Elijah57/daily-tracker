import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { todayISO, addDaysISO } from '../utils.js';

const RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'All', days: 0 },
];

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function dayLabel(dateStr) {
  if (dateStr === todayISO()) return 'Today';
  if (dateStr === addDaysISO(todayISO(), -1)) return 'Yesterday';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function lastCompleted(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export default function History() {
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);
  const [range, setRange] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [s, h] = await Promise.all([
          api('/stats'),
          range ? api(`/history?days=${range}`) : api('/history'),
        ]);
        if (cancelled) return;
        setStats(s);
        setEvents(h.events);
      } catch {
        if (!cancelled) setEvents([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range]);

  if (loading && !stats) return <div className="loading">Loading…</div>;

  const last30 = stats?.last30 || [];
  const maxDay = last30.reduce((m, d) => Math.max(m, d.done), 0);
  const maxWeekday = Math.max(0, ...(stats?.weekdayTotals || []));
  const maxTask = Math.max(0, ...(stats?.perTask || []).map((t) => t.total));

  // Group history events into date buckets (events come newest-first).
  const groups = [];
  for (const ev of events) {
    const last = groups[groups.length - 1];
    if (last && last.date === ev.date) last.items.push(ev);
    else groups.push({ date: ev.date, items: [ev] });
  }

  return (
    <div className="page">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>History</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          Everything you've completed, and how it adds up over time.
        </p>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 22 }}>
        <div className="stat">
          <div className="label">Total completions</div>
          <div className="value">{stats?.totalCompletions ?? 0}</div>
          <div className="sub">
            {stats?.totalDays ?? 0} different days with completions
          </div>
        </div>
        <div className="stat">
          <div className="label">Last 30 days</div>
          <div className="value">{stats?.completionRate ?? 0}%</div>
          <div className="sub">
            {stats?.last30Completions ?? 0} of {last30.reduce((sum, d) => sum + d.total, 0)} scheduled tasks done
          </div>
        </div>
        <div className="stat">
          <div className="label">Best streak</div>
          <div className="value">{stats?.bestStreak ?? 0}</div>
          <div className="sub">
            best day: {WEEKDAYS[stats?.bestDay ?? 0].slice(0, 3)} · {stats?.currentStreak ?? 0}-day streak now
          </div>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 22 }}>
        <div className="card">
          <div className="section-title">Last 30 days</div>
          <div className="chart">
            <div className="chart-bars">
              {last30.map((d) => (
                <div
                  key={d.date}
                  className={`chart-col ${d.total === 0 ? 'off' : ''}`}
                  title={`${dayLabel(d.date)} — ${d.done}/${d.total} done`}
                >
                  <div
                    className={`chart-bar ${d.done >= d.total && d.total > 0 ? 'full' : d.done > 0 ? 'partial' : 'track'}`}
                    style={{ height: `${d.total === 0 ? 4 : Math.max(6, (d.done / maxDay) * 100)}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="chart-foot">
              <span>{last30.length ? last30[0].date.slice(5).replace('-', '/') : '—'}</span>
              <span>{todayISO().slice(5).replace('-', '/')}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="section-title">By weekday</div>
          <div className="chart">
            <div className="chart-bars">
              {(stats?.weekdayTotals || []).map((n, i) => (
                <div
                  key={i}
                  className="chart-col"
                  title={`${WEEKDAYS[i]} — ${n} completions`}
                >
                  <div
                    className="chart-bar full"
                    style={{ height: `${maxWeekday ? Math.max(6, (n / maxWeekday) * 100) : 4}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="chart-foot">
              {DAY_LETTERS.map((l, i) => (
                <span key={i}>{l}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="section-title">Top tasks</div>
          {(stats?.perTask || []).length === 0 ? (
            <div className="empty">Complete some tasks and they'll show up here.</div>
          ) : (
            (stats.perTask || []).slice(0, 8).map((t) => (
              <div key={t.id} className="top-task">
                <span className="dot" style={{ background: t.color || 'var(--surface-matte)' }} />
                <span className="name" title={t.title || 'Completed task'}>
                  {t.title || 'Completed task'}
                </span>
                <span className="count">{t.total}×</span>
                <span className="track">
                  <span className="fill" style={{ width: `${maxTask ? (t.total / maxTask) * 100 : 0}%` }} />
                </span>
                <span className="last">{t.last ? `last ${lastCompleted(t.last)}` : ''}</span>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <div className="section-title">Completed tasks</div>
          <div className="filter-row">
            {RANGES.map((r) => (
              <button
                key={r.label}
                className={`pill-btn ${range === r.days ? 'active' : ''}`}
                onClick={() => setRange(r.days)}
              >
                {r.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="loading" style={{ padding: '20px 0' }}>Loading…</div>
          ) : events.length === 0 ? (
            <div className="empty">
              {range ? `Nothing completed in the last ${range} days yet.` : 'Nothing completed yet.'}
            </div>
          ) : (
            <div className="h-list">
              {groups.map((g) => (
                <div key={g.date} className="h-group">
                  <div className="h-date">
                    <span>{dayLabel(g.date)}</span>
                    <span className="h-count">{g.items.length}</span>
                  </div>
                  {g.items.map((ev) => (
                    <div key={ev.id} className="h-item">
                      <span className="dot" style={{ background: ev.color || 'var(--surface-matte)' }} />
                      <span className="h-title">{ev.title || 'Completed task'}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}