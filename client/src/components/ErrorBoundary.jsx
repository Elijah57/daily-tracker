import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('UI error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page">
          <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}>
            <h2 style={{ marginBottom: 8 }}>Something went wrong</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 12 }}>
              The page hit an unexpected error. Here's what we caught:
            </p>
            <pre
              style={{
                background: 'var(--surface-matte)',
                padding: 12,
                borderRadius: 8,
                fontSize: 13,
                overflow: 'auto',
                marginBottom: 16,
              }}
            >
              {this.state.error.message}
            </pre>
            <button className="btn" onClick={() => window.location.reload()}>
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
