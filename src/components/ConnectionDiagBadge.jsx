// ============================================
// 连接诊断浮标（右下角，点击展开）
// ============================================
// 用于快速定位"为什么页面显示的是本地 mock 数据"的问题。
// 显示：Supabase 是否已配置、健康检查结果、当前用户、supabaseOk 状态。
// 并提供"强制重试连接"按钮。

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  isSupabaseConfigured,
  supabase,
  recheckSupabaseHealth,
  getReachable,
} from '../lib/supabase';

export default function ConnectionDiagBadge() {
  const { user, supabaseOk, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [reachable, setReachable] = useState(getReachable());
  const [checking, setChecking] = useState(false);
  const [sessionInfo, setSessionInfo] = useState(null);

  const refreshReach = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setChecking(true);
    const ok = await recheckSupabaseHealth();
    setReachable(ok);
    setChecking(false);
  }, []);

  const refreshSession = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data } = await supabase.auth.getSession();
      setSessionInfo({
        hasSession: !!data?.session,
        sessionUserEmail: data?.session?.user?.email || null,
        accessTokenPrefix: data?.session?.access_token
          ? data.session.access_token.slice(0, 12) + '...'
          : null,
      });
    } catch (e) {
      setSessionInfo({ error: e?.message || String(e) });
    }
  }, []);

  // 打开面板时自动刷新一次
  useEffect(() => {
    if (open) {
      refreshReach();
      refreshSession();
    }
  }, [open, refreshReach, refreshSession]);

  // 状态颜色
  let badgeColor = '#6b7280'; // 灰
  let badgeLabel = '连接中';
  if (!isSupabaseConfigured) {
    badgeColor = '#dc2626'; // 红
    badgeLabel = '未配置 DB';
  } else if (supabaseOk === true) {
    badgeColor = '#16a34a'; // 绿
    badgeLabel = '已连接';
  } else if (supabaseOk === false) {
    badgeColor = '#dc2626'; // 红
    badgeLabel = '离线模式';
  } else {
    badgeColor = '#f59e0b'; // 橙
    badgeLabel = '检测中';
  }

  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 9999,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 12,
      }}
    >
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            background: '#fff',
            border: `2px solid ${badgeColor}`,
            color: badgeColor,
            borderRadius: 999,
            padding: '6px 12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
          title="点击查看连接诊断"
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: badgeColor,
              display: 'inline-block',
            }}
          />
          {badgeLabel}
        </button>
      )}

      {open && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            padding: 12,
            width: 320,
            boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
            lineHeight: 1.5,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <strong>连接诊断</strong>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: '#6b7280',
                fontSize: 16,
              }}
            >
              ×
            </button>
          </div>

          <div style={{ color: '#374151' }}>
            <div>
              <b>env 配置：</b>
              <span style={{ color: isSupabaseConfigured ? '#16a34a' : '#dc2626' }}>
                {isSupabaseConfigured ? '已配置' : '未配置（env 缺失！）'}
              </span>
            </div>
            <div>
              <b>HEAD 健康：</b>
              <span
                style={{
                  color:
                    reachable === true
                      ? '#16a34a'
                      : reachable === false
                      ? '#dc2626'
                      : '#6b7280',
                }}
              >
                {reachable === true
                  ? '可达'
                  : reachable === false
                  ? '不可达'
                  : '未检测'}
              </span>
            </div>
            <div>
              <b>supabaseOk：</b>
              <span>
                {supabaseOk === true
                  ? 'true (在线)'
                  : supabaseOk === false
                  ? 'false (本地 mock)'
                  : 'null (检测中)'}
              </span>
            </div>
            <div>
              <b>loading：</b>
              <span>{String(loading)}</span>
            </div>
            <div>
              <b>当前用户：</b>
              <span style={{ wordBreak: 'break-all' }}>
                {user?.email || '(未登录)'}
              </span>
            </div>
            {sessionInfo && (
              <div style={{ marginTop: 6, padding: 6, background: '#f9fafb', borderRadius: 6 }}>
                <div>
                  <b>session：</b>
                  {sessionInfo.error
                    ? '获取异常'
                    : sessionInfo.hasSession
                    ? '存在'
                    : '不存在'}
                </div>
                {sessionInfo.sessionUserEmail && (
                  <div style={{ wordBreak: 'break-all' }}>
                    <b>session user：</b>
                    {sessionInfo.sessionUserEmail}
                  </div>
                )}
                {sessionInfo.accessTokenPrefix && (
                  <div style={{ wordBreak: 'break-all', color: '#6b7280' }}>
                    token: {sessionInfo.accessTokenPrefix}
                  </div>
                )}
                {sessionInfo.error && (
                  <div style={{ color: '#dc2626' }}>{sessionInfo.error}</div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              onClick={refreshReach}
              disabled={checking || !isSupabaseConfigured}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid #d1d5db',
                background: '#f9fafb',
                cursor: checking ? 'wait' : 'pointer',
                color: '#111827',
              }}
            >
              {checking ? '检测中…' : '重试连接'}
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid #2563eb',
                background: '#2563eb',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              硬刷新
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
