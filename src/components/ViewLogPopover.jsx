// ============================================
// 访问记录弹层（配合"小眼睛"浏览数按钮）
// ============================================
// 职责：点击小眼睛后弹出，展示所有访问过该内容的成员 + 访问时间。
// 数据源由外部注入（fetchLog 返回 [{userId, userName, viewedAt}]），
// 组件只负责拉数据、按访问者分组（保留最近一次时间）、渲染。
//
// 用法：
//   <ViewLogPopover
//     open={open}
//     anchorRect={rect}         // 可选，用于定位小箭头；不提供则居中弹窗
//     totalCount={N}            // 标题处显示的总浏览数
//     onClose={() => ...}
//     fetchLog={async () => recordList}
//     resolveName={(uid, fallback) => 真名}  // 可选：用真名覆盖日志中的 userName
//   />

import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, X, Clock, User as UserIcon } from 'lucide-react';
import './ViewLogPopover.css';

const VIEW_LOG_UI_TIMEOUT_MS = 10000;

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatRelative(iso) {
  if (!iso) return '';
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, now - then);
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  if (diff < MIN) return '刚刚';
  if (diff < HOUR) return `${Math.floor(diff / MIN)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} 天前`;
  return '';
}

export default function ViewLogPopover({
  open,
  totalCount = 0,
  onClose,
  fetchLog,
  resolveName,
}) {
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);
  const overlayRef = useRef(null);

  // 保存最新的 fetchLog，避免父组件每次渲染传入新引用导致 effect 无限重跑
  const fetchLogRef = useRef(fetchLog);
  useEffect(() => {
    fetchLogRef.current = fetchLog;
  }, [fetchLog]);

  // 拉取数据（只依赖 open，避免因父组件重渲染导致 fetchLog 引用变化引发循环刷新）
  useEffect(() => {
    if (!open) return;
    const fn = fetchLogRef.current;
    if (!fn) return;
    let cancelled = false;
    let timedOut = false;
    setLoading(true);
    setError(null);
    const timeoutId = setTimeout(() => {
      if (!cancelled) {
        timedOut = true;
        setError('访问记录加载超时，请稍后重试');
        setLoading(false);
      }
    }, VIEW_LOG_UI_TIMEOUT_MS);
    (async () => {
      try {
        const list = await fn();
        if (!cancelled && !timedOut) {
          clearTimeout(timeoutId);
          setLogs(Array.isArray(list) ? list : []);
        }
      } catch (err) {
        if (!cancelled && !timedOut) {
          clearTimeout(timeoutId);
          setError(err?.message || '加载访问记录失败');
        }
      } finally {
        if (!cancelled && !timedOut) {
          clearTimeout(timeoutId);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [open]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 按访问者聚合：同一个用户只显示一次，取最近访问时间，保留访问次数
  const groupedVisitors = useMemo(() => {
    const map = new Map();
    for (const item of logs) {
      const key = item.userId || `anon:${item.userName}`;
      const existing = map.get(key);
      const latest = item.viewedAt;
      if (!existing) {
        map.set(key, {
          userId: item.userId,
          userName: item.userName,
          latestAt: latest,
          count: 1,
        });
      } else {
        existing.count += 1;
        if (new Date(latest) > new Date(existing.latestAt)) {
          existing.latestAt = latest;
        }
      }
    }
    const arr = Array.from(map.values());
    arr.sort((a, b) => new Date(b.latestAt || 0) - new Date(a.latestAt || 0));
    return arr;
  }, [logs]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="vlp-overlay"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose?.();
      }}
    >
      <div
        className="vlp-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="访问记录"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="vlp-header">
          <div className="vlp-header__title">
            <Eye size={18} />
            <span>访问记录</span>
            <span className="vlp-header__count">共 {totalCount} 次浏览 · {groupedVisitors.length} 位访客</span>
          </div>
          <button
            type="button"
            className="vlp-header__close"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="vlp-body">
          {loading && <div className="vlp-state">加载中…</div>}
          {!loading && error && <div className="vlp-state vlp-state--error">{error}</div>}
          {!loading && !error && groupedVisitors.length === 0 && (
            <div className="vlp-state">暂无访问记录</div>
          )}
          {!loading && !error && groupedVisitors.length > 0 && (
            <ul className="vlp-list">
              {groupedVisitors.map((v) => {
                const displayName =
                  (resolveName && resolveName(v.userId, v.userName)) || v.userName || '访客';
                const rel = formatRelative(v.latestAt);
                return (
                  <li key={v.userId || `anon:${v.userName}`} className="vlp-item">
                    <div className="vlp-item__avatar">
                      <UserIcon size={14} />
                    </div>
                    <div className="vlp-item__main">
                      <div className="vlp-item__name">
                        {displayName}
                        {v.count > 1 && (
                          <span className="vlp-item__times" title={`访问了 ${v.count} 次`}>
                            ×{v.count}
                          </span>
                        )}
                      </div>
                      <div className="vlp-item__time">
                        <Clock size={12} />
                        <span>{formatDateTime(v.latestAt)}</span>
                        {rel && <span className="vlp-item__rel">· {rel}</span>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
