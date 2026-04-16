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

const GUESTBOOK_LS_KEY = 'riemer_guestbook';

export default function Guestbook() {
  const { isAuthenticated, isAdmin, supabaseOk } = useAuth();
  // 同步从 localStorage 读取缓存，有缓存时直接渲染，避免切换 tab 时闪烁 loading
  const [entries, setEntries] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(GUESTBOOK_LS_KEY) || '[]');
      if (stored.length > 0) return stored;
    } catch { /* ignore */ }
    return [];
  });
  const hasCachedRef = useRef(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(GUESTBOOK_LS_KEY) || '[]');
      return stored.length > 0;
    } catch {
      return false;
    }
  });
  const [loading, setLoading] = useState(!hasCachedRef.current());

  const loadEntries = useCallback(async () => {
    // 只有当前没有缓存数据时才显示 loading（有缓存数据则后台静默刷新）
    if (!hasCachedRef.current()) {
      setLoading(true);
    }
    try {
      if (isSupabaseConfigured && supabaseOk === true) {
        const { data, error } = await supabase
          .from('guestbook_entries')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) throw error;
        setEntries(data || []);
      } else {
        // localStorage fallback
        const stored = JSON.parse(localStorage.getItem(GUESTBOOK_LS_KEY) || '[]');
        setEntries(stored);
      }
    } catch (err) {
      console.error('[Guestbook] 加载留言失败:', err);
    } finally {
      setLoading(false);
    }
  }, [supabaseOk]);

  useEffect(() => {
    if (isAuthenticated) {
      loadEntries();
    }
  }, [isAuthenticated, loadEntries]);

  const handleDelete = useCallback(async (id) => {
    if (!window.confirm('确定删除这条留言吗？')) return;
    try {
      if (isSupabaseConfigured && supabaseOk === true) {
        await supabase.from('guestbook_entries').delete().eq('id', id);
      } else {
        const stored = JSON.parse(localStorage.getItem(GUESTBOOK_LS_KEY) || '[]');
        const updated = stored.filter((e) => e.id !== id);
        localStorage.setItem(GUESTBOOK_LS_KEY, JSON.stringify(updated));
      }
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      console.error('[Guestbook] 删除留言失败:', err);
      alert('删除失败，请稍后再试');
    }
  }, [supabaseOk]);

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
            disabled={loading}
            title="刷新留言"
          >
            <RefreshCw size={16} className={loading ? 'guestbook-page__spin' : ''} />
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
