import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { route } from './lib/router.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Single adapter: any /api/* path goes through the same router used by
// Netlify & Vercel functions, so behavior is identical everywhere.
app.use('/api', async (req, res) => {
  const result = await route({
    method: req.method,
    path: req.originalUrl,
    query: req.query,
    body: req.body || {},
    headers: req.headers,
  });
  res.status(result.status).json(result.json);
});

// Static frontend (production build)
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
