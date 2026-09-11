import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { todayISO } from '../utils.js';

function noteLabel(dateStr) {
  if (dateStr === todayISO()) return 'Today';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function Notes() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await api('/notes');
        if (!cancelled) setNotes((raw || []).filter((n) => n.body && String(n.body).trim()));
      } catch {
        if (!cancelled) setNotes([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <div className="page">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Notes</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          Your private thoughts and reflections, one per day.
        </p>
      </div>

      {notes.length === 0 ? (
        <div className="card">
          <div className="empty">Write a note on the Dashboard and it'll show up here.</div>
        </div>
      ) : (
        <div className="note-list-page">
          {notes.map((n) => (
            <div key={n.date} className="card note-card">
              <div className="note-card-date">{noteLabel(n.date)}</div>
              <div className="note-card-body">{n.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
