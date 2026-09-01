import React, { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';

export default function Login() {
  const { login } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '', displayName: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      const { token, user } = await api(path, {
        method: 'POST',
        body: JSON.stringify(form),
      });
      login(token, user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <svg width="34" height="34" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="8" fill="#2f3542" />
            <rect x="8" y="8" width="5" height="5" rx="1.5" fill="#a5d6a7" />
            <rect x="14" y="8" width="5" height="5" rx="1.5" fill="#b0bec5" />
            <rect x="20" y="8" width="5" height="5" rx="1.5" fill="#e0a5a5" />
            <rect x="8" y="14" width="5" height="5" rx="1.5" fill="#b0bec5" />
            <rect x="14" y="14" width="5" height="5" rx="1.5" fill="#a5d6a7" />
            <rect x="20" y="14" width="5" height="5" rx="1.5" fill="#e0a5a5" />
          </svg>
          Daily Tracker
        </div>
        <p className="subhead">
          {mode === 'login'
            ? 'Welcome back. Check in on your tasks.'
            : 'Create an account to start tracking.'}
        </p>

        {error && <div className="error">{error}</div>}

        <form onSubmit={submit}>
          {mode === 'register' && (
            <div className="field">
              <label>Display name</label>
              <input value={form.displayName} onChange={set('displayName')} placeholder="How your friends see you" />
            </div>
          )}
          <div className="field">
            <label>Username</label>
            <input value={form.username} onChange={set('username')} placeholder="e.g. alex" required autoFocus />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={form.password}
              onChange={set('password')}
              placeholder="••••••"
              required
            />
          </div>
          <button className="btn btn-block" disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>

        <div className="switch">
          {mode === 'login' ? (
            <>
              Don't have an account?{' '}
              <button onClick={() => { setMode('register'); setError(''); }}>
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button onClick={() => { setMode('login'); setError(''); }}>
                Log in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
