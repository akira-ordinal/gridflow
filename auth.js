'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'ログインに失敗しました');
        setLoading(false);
        return;
      }

      // ログイン成功 → ダッシュボードへ
      router.push('/dashboard');
    } catch (err) {
      setError('ログインに失敗しました');
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: '#0a0e1a', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      fontFamily: 'sans-serif'
    }}>
      <div style={{ 
        width: '100%', 
        maxWidth: 400, 
        padding: 24 
      }}>
        {/* ロゴ */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ 
            fontFamily: 'monospace', 
            fontSize: 28, 
            fontWeight: 700, 
            color: '#00d4ff', 
            letterSpacing: 2,
            marginBottom: 8
          }}>
            GRID<span style={{ color: '#00ff9d' }}>FLOW</span>
          </h1>
          <p style={{ color: '#64748b', fontSize: 14 }}>
            ログインして取引を開始
          </p>
        </div>

        {/* フォーム */}
        <form onSubmit={handleSubmit} style={{
          background: '#111827',
          border: '1px solid #1e2d45',
          borderRadius: 12,
          padding: 24
        }}>
          {error && (
            <div style={{
              background: 'rgba(255,77,109,0.1)',
              border: '1px solid #ff4d6d',
              borderRadius: 8,
              padding: 12,
              marginBottom: 16,
              color: '#ff4d6d',
              fontSize: 13
            }}>
              {error}
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <label style={{ 
              display: 'block', 
              fontSize: 12, 
              color: '#64748b', 
              marginBottom: 6,
              fontFamily: 'monospace'
            }}>
              メールアドレス
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: '100%',
                background: '#1a2235',
                border: '1px solid #1e2d45',
                borderRadius: 8,
                color: '#e2e8f0',
                fontSize: 14,
                padding: '10px 12px',
                outline: 'none'
              }}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ 
              display: 'block', 
              fontSize: 12, 
              color: '#64748b', 
              marginBottom: 6,
              fontFamily: 'monospace'
            }}>
              パスワード
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: '100%',
                background: '#1a2235',
                border: '1px solid #1e2d45',
                borderRadius: 8,
                color: '#e2e8f0',
                fontSize: 14,
                padding: '10px 12px',
                outline: 'none'
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: 12,
              borderRadius: 8,
              border: 'none',
              background: loading ? '#64748b' : 'linear-gradient(135deg,#00d4ff,#00ff9d)',
              color: '#0a0e1a',
              fontFamily: 'monospace',
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 1,
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>

          {/* 新規登録へのリンク */}
          <div style={{
            marginTop: 16,
            textAlign: 'center',
            fontSize: 13,
            color: '#64748b'
          }}>
            アカウントをお持ちでない方は{' '}
            <a 
              href="/register" 
              style={{ 
                color: '#00d4ff', 
                textDecoration: 'none',
                fontWeight: 600
              }}
            >
              新規登録
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}