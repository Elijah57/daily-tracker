# Daily Tracker

A small daily task/habit tracker for you and your friends — flat, matte design.

## Features

- **Accounts** — anyone can register with a username + password; everyone shares the same app.
- **Daily tasks** — each person has their own checklist of recurring daily tasks.
- **Streaks** — current streak + best streak (a day only counts when *all* tasks are done).
- **Stats** — today's progress bar, completion counts, and a history calendar.
- **Friends** — see how everyone else is doing for friendly accountability.

## Stack

- **Backend**: Node, JWT auth (bcrypt-hashed passwords), `@libsql/client` (libSQL/SQLite)
- **Frontend**: React + Vite, React Router, flat matte CSS design
- **Database**: [Turso](https://turso.tech) (SQLite-compatible, hosted) in production, or a local SQLite file for development. Choose via `TURSO_DATABASE_URL`.
- **Deploy**: platform-agnostic — the same serverless function works on **Vercel** **or** **Netlify**, and the Express adapter for self-host / dev.

One shared router (`server/src/lib/router.js`) dispatches every `/api/*` request to the
business logic, and each platform is just a thin adapter around it:
`api/[...slug].js` (Vercel), `netlify/functions/api.js` (Netlify), `server/src/index.js` (Express).

## Run it (local / self-host)

Requires Node 18+ (20+ recommended).

```bash
# 1. Install everything
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

| Env var              | Default                      | Purpose                                |
| -------------------- | ---------------------------- | -------------------------------------- |
| `PORT`               | `4000`                       | Self-host server port                  |
| `JWT_SECRET`         | dev-only value (change it!)  | Signs auth tokens                      |
| `TURSO_DATABASE_URL` | *(unset → local file)*       | Turso DB URL, e.g. `libsql://my-app.turso.io` |
| `TURSO_AUTH_TOKEN`   | *(unset → local file)*       | Turso auth token (required for Turso)  |

When `TURSO_DATABASE_URL` is set, the app uses Turso; otherwise it falls back to a
local SQLite file. `JWT_SECRET` must be a strong, secret value in production.

Copy `.env.example` to `.env` for local env-var management (already git-ignored).
For self-host, load it with Node's built-in flag:

```bash
node --env-file=.env server/src/index.js
```

## Data

- **Local dev**: SQLite file at `server/data/daily-tracker.db`, created automatically on first run.
- **Production (Turso)**: the schema is created automatically on first request — there is no
  separate migration step. Just point `TURSO_DATABASE_URL` at a Turso DB.

Create a Turso database:

```bash
npm i -g @turso/cli
turso auth login
turso db create daily-tracker
turso db show daily-tracker       # copy the URL
turso db tokens create daily-tracker   # copy the token
```

Then set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in your hosting platform's env settings.

## Deploy

`vercel.json`, `netlify.toml`, and the `api/` + `netlify/functions/` directories are all present,
so the project deploys as-is to either platform. Both build the Vite frontend
(`client/dist`) and supply the single serverless function for `/api/*`.

**Vercel**

1. Push to GitHub, then import the repo at vercel.com (framework: Vite).
2. Add production env vars: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `JWT_SECRET`.
3. Deploy. SPA fallback + `/api/*` routing are handled by `vercel.json`.

**Netlify**

1. Push to GitHub, then import the repo at netlify.com (build command `npm run build`,
   publish dir `client/dist`, functions dir `netlify/functions`).
2. Add the same production env vars.
3. Deploy. `netlify.toml` wires `/api/*` to the function and provides SPA fallback.
