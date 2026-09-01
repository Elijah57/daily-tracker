import {
  register,
  login,
  me,
  listGoals,
  createGoal,
  patchGoal,
  deleteGoal,
  listTasks,
  createTask,
  patchTask,
  deleteTask,
  listCompletions,
  addCompletion,
  removeCompletion,
  listNotes,
  putNote,
  getStats,
  listUsers,
  listFriends,
} from './handlers.js';

// Platform-agnostic dispatcher: turns (method, path, query, body, headers)
// into { status, json } by matching /api/* routes. The same router is used by
// the Netlify function, the Vercel function, and the local Express server.

export async function route({ method, path, query = {}, body = {}, headers = {} }) {
  const req = { method, body, headers, query };
  const segs = (path || '').replace(/^\/+/, '').split('/').filter(Boolean); // e.g. ['api','goals','5']
  const api = segs.shift();

  if (api !== 'api') return { status: 404, json: { error: 'Not found' } };

  const [r1, r2] = segs; // resource, optional id/date

  switch (r1) {
    case 'auth':
      if (r2 === 'register' && method === 'POST') return await register(req);
      if (r2 === 'login' && method === 'POST') return await login(req);
      break;

    case 'me':
      if (method === 'GET') return await me(req);
      break;

    case 'goals':
      if (method === 'GET' && !r2) return await listGoals(req);
      if (method === 'POST' && !r2) return await createGoal(req);
      if (method === 'PATCH' && r2) return await patchGoal(req, Number(r2));
      if (method === 'DELETE' && r2) return await deleteGoal(req, Number(r2));
      break;

    case 'tasks':
      if (method === 'GET' && !r2) return await listTasks(req);
      if (method === 'POST' && !r2) return await createTask(req);
      if (method === 'PATCH' && r2) return await patchTask(req, Number(r2));
      if (method === 'DELETE' && r2) return await deleteTask(req, Number(r2));
      break;

    case 'completions':
      if (method === 'GET' && !r2) return await listCompletions(req, query);
      if (method === 'POST' && !r2) return await addCompletion(req);
      // /completions/:taskId/:date
      if (r2 && segs[1] && method === 'DELETE') return await removeCompletion(req, Number(r2), segs[1]);
      break;

    case 'notes':
      if (method === 'GET' && !r2) return await listNotes(req);
      if (r2 && method === 'PUT') return await putNote(req, r2);
      break;

    case 'stats':
      if (method === 'GET') return await getStats(req);
      break;

    case 'users':
      if (method === 'GET') return await listUsers(req);
      break;

    case 'friends':
      if (method === 'GET') return await listFriends(req);
      break;

    default:
      break;
  }

  return { status: 404, json: { error: `No route: ${method} /api/${segs.join('/')}` } };
}
