import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '3rem 2rem',
          textAlign: 'center',
          color: '#666',
          minHeight: '40vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
        }}>
          <h2 style={{ color: '#333', fontSize: '1.25rem' }}>页面加载出错了</h2>
          <p style={{ fontSize: '0.9rem', maxWidth: 400 }}>
            可能是缓存数据不兼容，请尝试刷新页面或清除浏览器缓存。
          </p>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={this.handleReset}
              style={{
                padding: '0.5rem 1.25rem',
                borderRadius: '8px',
                border: '1px solid #5B8C3E',
                background: '#5B8C3E',
                color: 'white',
                cursor: 'pointer',
                fontSize: '0.9rem',
              }}
            >
              重试
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '0.5rem 1.25rem',
                borderRadius: '8px',
                border: '1px solid #ddd',
                background: 'white',
                color: '#333',
                cursor: 'pointer',
                fontSize: '0.9rem',
              }}
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
