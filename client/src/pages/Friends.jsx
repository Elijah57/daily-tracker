import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Friends() {
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/friends')
      .then(setFriends)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading…</div>;

  // Sort by today's progress so the day's winner is on top
  const sorted = [...friends].sort((a, b) => {
    const aRate = a.stats.taskCount ? a.stats.currentStreak : 0;
    const bRate = b.stats.taskCount ? b.stats.currentStreak : 0;
    return bRate - aRate;
  });

  return (
    <div className="page">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Friends</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          How everyone's doing. Friendly accountability, no judgment.
        </p>
      </div>

      {friends.length === 0 ? (
        <div className="card">
          <div className="empty">
            No friends yet. Share the URL with friends and have them create an account — they'll
            show up here.
          </div>
        </div>
      ) : (
        <div className="grid grid-2">
          {sorted.map((f) => {
            const initial = (f.displayName || f.username || '?').charAt(0).toUpperCase();
            const s = f.stats;
            return (
              <div key={f.id} className="friend-card">
                <div className="friend-head">
                  <span className="avatar">{initial}</span>
                  <div>
                    <div className="friend-name">{f.displayName || f.username}</div>
                    <div className="friend-username">@{f.username}</div>
                  </div>
                </div>
                <div className="friend-stats">
                  <div className="friend-stat">
                    <div className="v">{s.currentStreak}</div>
                    <div className="l">current</div>
                  </div>
                  <div className="friend-stat">
                    <div className="v">{s.bestStreak}</div>
                    <div className="l">best streak</div>
                  </div>
                  <div className="friend-stat">
                    <div className="v">{s.taskCount}</div>
                    <div className="l">tasks</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
