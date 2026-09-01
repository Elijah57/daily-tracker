// Helpers for computing streaks and stats from completion data.

export function isoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

export function daysBetween(a, b) {
  const ms = new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00');
  return Math.round(ms / 86400000);
}

// Given a set of completed dates and the "current" date, compute the current streak
// and the best (longest) streak. A day is counted as part of a streak if ALL active
// tasks were completed that day.
export function computeStreaks(dailyCompleteness, today) {
  const completed = new Set(dailyCompleteness.map((r) => r.date));

  // current streak: count backwards starting today (today counts even if partial/not done yet? we count only fully-complete days)
  let current = 0;
  let cursor = today;
  if (!completed.has(cursor)) {
    // Allow today to be in-progress: don't break the streak if today isn't complete yet.
    cursor = addDays(today, -1);
  }
  while (completed.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }

  // best streak among all users' history
  const sorted = dailyCompleteness.map((r) => r.date).sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const date of sorted) {
    if (prev !== null && daysBetween(prev, date) === 1) {
      run++;
    } else {
      run = 1;
    }
    if (run > best) best = run;
    prev = date;
  }

  return { current, best };
}

// Build a map of date -> number of completed tasks from flat completion rows.
export function groupByDate(rows) {
  const map = {};
  for (const r of rows) {
    map[r.date] = (map[r.date] || 0) + 1;
  }
  return map;
}
