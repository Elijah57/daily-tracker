# Daily Tracker

A small daily task/habit tracker for you and your friends — flat, matte design.

## Features

- **Accounts** — anyone can register with a username + password; everyone shares the same app.
- **Daily tasks** — each person has their own checklist of recurring daily tasks.
- **Streaks** — current streak + best streak (a day only counts when *all* tasks are done).
- **Stats** — today's progress bar, completion counts, and a history calendar.
- **Friends** — see how everyone else is doing for friendly accountability.

## Stack

- **Backend**: Node + Express + better-sqlite3 (SQLite), JWT auth (bcrypt hashed passwords)
- **Frontend**: React + Vite, React Router, flat matte CSS design
- Production: the Express server serves the built frontend, so it's one deployable server.

## Run it

Requires Node 18+.

```bash
# 1. Install everything (root + server + client)
npm run install:all

# 2. Build the frontend
npm run build

# 3. Start the server
npm start
```

The app runs at **http://localhost:4000** and serves both the API and the built UI.

To let friends use it, run it on a machine reachable on your network and give them
`http://<your-ip>:4000` (open port 4000 in your firewall), or deploy it to any host
(such as a VPS / Render / Railway) that can run Node.

### Dev mode (hot reload)

```bash
npm run dev:server   # backend on :4000
npm run dev:client   # Vite on :5173 proxying /api to :4000
```

## Configuration

| Env var       | Default                      | Purpose                       |
| ------------- | ---------------------------- | ----------------------------- |
| `PORT`        | `4000`                       | Server port                   |
| `JWT_SECRET`  | dev-only value (change it!)  | Signs auth tokens             |

Set a strong `JWT_SECRET` before deploying anywhere public.

## Data

Everything is stored in an SQLite file at `server/data/daily-tracker.db`, created
automatically on first run. Delete that folder to reset all data.
