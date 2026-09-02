import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../App.jsx';

export default function Nav() {
  const { user, logout } = useAuth();
  const initial = (user?.displayName || user?.username || '?').charAt(0).toUpperCase();

  return (
    <nav className="nav">
      <div className="nav-inner">
        <NavLink to="/" className="brand">
          <svg width="26" height="26" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="8" fill="#2f3542" />
            <rect x="8" y="8" width="5" height="5" rx="1.5" fill="#a5d6a7" />
            <rect x="14" y="8" width="5" height="5" rx="1.5" fill="#b0bec5" />
            <rect x="20" y="8" width="5" height="5" rx="1.5" fill="#e0a5a5" />
            <rect x="8" y="14" width="5" height="5" rx="1.5" fill="#b0bec5" />
            <rect x="14" y="14" width="5" height="5" rx="1.5" fill="#a5d6a7" />
            <rect x="20" y="14" width="5" height="5" rx="1.5" fill="#e0a5a5" />
          </svg>
          Daily Tracker
        </NavLink>
        <div className="nav-links">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
            Dashboard
          </NavLink>
          <NavLink to="/friends" className={({ isActive }) => (isActive ? 'active' : '')}>
            Friends
          </NavLink>
        </div>
        <div className="nav-user">
          <span className="avatar">{initial}</span>
          <span className="nav-username">{user?.displayName || user?.username}</span>
          <button className="btn btn-ghost" onClick={logout} style={{ padding: '7px 12px', fontSize: 13 }}>
            Log out
          </button>
        </div>
      </div>
    </nav>
  );
}
