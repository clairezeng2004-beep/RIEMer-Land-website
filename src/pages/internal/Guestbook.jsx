import { useState, useEffect, useCallback, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import {
  MessageCircle,
  Trash2,
  User,
  Clock,
  Mail,
  RefreshCw,
  AlertCircle,
  Inbox,
} from 'lucide-react';
import './Guestbook.css';

// 内部留言板页面专用缓存（sessionStorage，仅本次会话），
// 与底部访客留言弹窗用的 localStorage('riemer_guestbook') 彻底隔离：
// 之前这两边共用同一个 key，导致内部页读到的只是"访客自己在本机留下
// 的几条"，既不完整又会误导管理员。
const INTERNAL_CACHE_KEY = 'riemer_internal_guestbook_cache';
// 单次查询最多拉多少条；日常业务量很小，200 已足够覆盖，
// 避免留言累积后每次 SELECT * 都扫全表。
const QUERY_LIMIT = 200;
// 查询超时阈值：超过就放弃本次加载，用已有缓存兜底，不再让用户干等。
const QUERY_TIMEOUT_MS = 10000;

function readCache() {
  try {
    const raw = sessionStorage.getItem(INTERNAL_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCache(list) {
  try {
    sessionStorage.setItem(INTERNAL_CACHE_KEY, JSON.stringify(list));
  } catch {
    /* quota 满或禁用 sessionStorage 就忽略 */
  }
}

export default function Guestbook() {
  const { isAuthenticated, isAdmin } = useAuth();

  // 同步从 sessionStorage 读取缓存，有缓存就直接渲染，避免 loading 闪烁
  const [entries, setEntries] = useState(() => readCache());
  // 有缓存时不显示全屏 loading，只在首次无缓存时才显示
  const [loading, setLoading] = useState(() => readCache().length === 0);
  const [refreshing, setRefreshing] = useState(false);

  // 防止 effect 触发多次请求叠在一起
  const inflightRef = useRef(false);

  const loadEntries = useCallback(async () => {
    if (inflightRef.current) return;
    inflightRef.current = true;

    const hasCache = readCache().length > 0;
    if (!hasCache) setLoading(true);
    else setRefreshing(true);

    try {
      if (!isSupabaseConfigured || !supabase) {
        // 没配 Supabase：直接用缓存
        setEntries(readCache());
        return;
      }

      // 不再等 AuthContext 里的 supabaseOk 探活完成（那步要一个额外 RTT，
      // 慢网下首屏要多等 1-3s）。直接发请求，失败就回退到缓存。
      const queryPromise = supabase
        .from('guestbook_entries')
        // 精确字段比 select('*') 传输量更小，避免未来新增大字段被一起拉下来
        .select('id,nickname,message,contact,show_contact,created_at')
        .order('created_at', { ascending: false })
        .limit(QUERY_LIMIT);

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('guestbook_query_timeout')), QUERY_TIMEOUT_MS)
      );

      const { data, error } = await Promise.race([queryPromise, timeoutPromise]);
      if (error) throw error;

      const list = data || [];
      setEntries(list);
      writeCache(list);
    } catch (err) {
      console.error('[Guestbook] 加载留言失败:', err);
      // 失败时不清空已有 entries，继续沿用之前的缓存，避免"刷新一下就空了"
    } finally {
      setLoading(false);
      setRefreshing(false);
      inflightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadEntries();
    }
  }, [isAuthenticated, loadEntries]);

  const handleDelete = useCallback(async (id) => {
    if (!window.confirm('确定删除这条留言吗？')) return;

    // 乐观删除：先本地移除 + 更新缓存，再后台发删除请求
    setEntries((prev) => {
      const next = prev.filter((e) => e.id !== id);
      writeCache(next);
      return next;
    });

    try {
      if (isSupabaseConfigured && supabase) {
        const { error } = await supabase.from('guestbook_entries').delete().eq('id', id);
        if (error) throw error;
      }
    } catch (err) {
      console.error('[Guestbook] 删除留言失败:', err);
      alert('删除失败，将在下次刷新时恢复该留言');
      // 失败时重新拉一次，让服务端真实状态覆盖本地假删
      loadEntries();
    }
  }, [loadEntries]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="guestbook-page">
      <div className="container">
        <div className="guestbook-page__header">
          <div>
            <h1>
              <MessageCircle size={28} /> 访客留言板
            </h1>
            <p>来自网站访客的留言</p>
          </div>
          <button
            className="guestbook-page__refresh-btn"
            onClick={loadEntries}
            disabled={loading || refreshing}
            title="刷新留言"
          >
            <RefreshCw size={16} className={(loading || refreshing) ? 'guestbook-page__spin' : ''} />
            刷新
          </button>
        </div>

        <div className="guestbook-page__stats">
          <span className="guestbook-page__stats-item">
            <Inbox size={14} /> 共 {entries.length} 条留言
          </span>
        </div>

        {loading ? (
          <div className="guestbook-page__loading">
            <RefreshCw size={20} className="guestbook-page__spin" />
            <span>加载中…</span>
          </div>
        ) : entries.length === 0 ? (
          <div className="guestbook-page__empty">
            <MessageCircle size={40} />
            <p>暂无留言</p>
            <span>当有访客在网站底部提交留言后，将会显示在这里</span>
          </div>
        ) : (
          <div className="guestbook-page__list">
            {entries.map((entry) => (
              <div key={entry.id} className="guestbook-card">
                <div className="guestbook-card__header">
                  <div className="guestbook-card__user">
                    <div className="guestbook-card__avatar">
                      <User size={16} />
                    </div>
                    <span className="guestbook-card__name">{entry.nickname || '匿名访客'}</span>
                  </div>
                  <div className="guestbook-card__actions">
                    <span className="guestbook-card__time">
                      <Clock size={12} />
                      {new Date(entry.created_at).toLocaleString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {isAdmin && (
                      <button
                        className="guestbook-card__delete"
                        onClick={() => handleDelete(entry.id)}
                        title="删除留言"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                <p className="guestbook-card__message">{entry.message}</p>

                {entry.show_contact && entry.contact && (
                  <div className="guestbook-card__contact">
                    <Mail size={12} />
                    <span>{entry.contact}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="guestbook-page__hint">
          <AlertCircle size={14} />
          <span>留言由访客在网站底部「给我们留言」入口提交，仅内部成员可查看。管理员可删除不当留言。</span>
        </div>
      </div>
    </div>
  );
}
