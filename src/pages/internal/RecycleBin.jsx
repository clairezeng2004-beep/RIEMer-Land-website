import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  Trash2,
  RotateCcw,
  Clock,
  User,
  Search,
  Share2,
  FolderOpen,
  FileText,
  CalendarRange,
} from 'lucide-react';
import {
  fetchRecycleBin,
  subscribeRecycleBin,
  restoreItem,
  purgeItem,
  RECYCLE_TYPE_LABELS,
} from '../../services/recycleBinService';
// 复用「活动发布 / 公众号归档」的卡片样式（ia-card / ep-card），保持视觉一致
import './InternalArticles.css';
import './EventPublish.css';
import './RecycleBin.css';

const TYPE_ICONS = {
  member_sharing: Share2,
  document: FolderOpen,
  article: FileText,
  event: CalendarRange,
};

function formatDeletedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function RecycleBin() {
  const { isAuthenticated, isAdmin, user } = useAuth();

  const [entries, setEntries] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);
  const [purgeTarget, setPurgeTarget] = useState(null);
  const [purgeError, setPurgeError] = useState('');
  const [notice, setNotice] = useState('');
  const purgeDialogRef = useRef(null);

  useEffect(() => {
    if (!purgeTarget) return;
    const dialog = purgeDialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, [purgeTarget]);

  const handlePurge = async () => {
    if (busyId || !purgeTarget) return;
    setBusyId(purgeTarget.id);
    setPurgeError('');
    try {
      const result = await purgeItem(purgeTarget);
      if (!result.success) { setPurgeError(result.error); return; }
      setEntries((prev) => prev.filter((e) => String(e.id) !== String(purgeTarget.id)));
      setNotice(result.shared ? `已彻底删除。${result.shared} 个文件仍被其他内容引用，已保留。` : '已彻底删除，相关存储文件已完成清理。');
      setPurgeTarget(null);
    } catch (err) {
      setPurgeError(err.message || '清理失败，请重试。');
    } finally {
      setBusyId(null);
    }
  };

  // 首次加载
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchRecycleBin();
        if (!cancelled) setEntries(list);
      } catch (err) {
        console.warn('[RecycleBin] 加载失败:', err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 实时订阅
  useEffect(() => {
    const unsubscribe = subscribeRecycleBin(({ type, newItem, oldItem }) => {
      if (type === 'INSERT' && newItem) {
        setEntries((prev) => (
          prev.some((e) => String(e.id) === String(newItem.id)) ? prev : [newItem, ...prev]
        ));
      } else if (type === 'DELETE' && oldItem) {
        setEntries((prev) => prev.filter((e) => String(e.id) !== String(oldItem.id)));
      }
    });
    return () => unsubscribe();
  }, []);

  // 权限：管理员看全部；普通成员只看自己删的 / 自己是原作者的
  const visibleEntries = useMemo(() => {
    if (isAdmin) return entries;
    const uid = user?.id != null ? String(user.id) : null;
    if (!uid) return [];
    return entries.filter(
      (e) => String(e.authorId) === uid || String(e.deletedById) === uid,
    );
  }, [entries, isAdmin, user]);

  const filtered = useMemo(() => {
    const kw = searchTerm.trim().toLowerCase();
    return visibleEntries.filter((e) => {
      const matchType = typeFilter === 'all' || e.itemType === typeFilter;
      const matchKw =
        !kw ||
        (e.title || '').toLowerCase().includes(kw) ||
        (e.author || '').toLowerCase().includes(kw);
      return matchType && matchKw;
    });
  }, [visibleEntries, typeFilter, searchTerm]);

  const handleRestore = useCallback(async (entry) => {
    if (busyId) return;
    setBusyId(entry.id);
    // 乐观移除
    setEntries((prev) => prev.filter((e) => String(e.id) !== String(entry.id)));
    const res = await restoreItem(entry);
    if (!res?.success) {
      // 失败 → 放回列表并提示
      setEntries((prev) => (
        prev.some((e) => String(e.id) === String(entry.id)) ? prev : [entry, ...prev]
      ));
      alert(`恢复失败：${res?.error || '未知错误'}。条目已保留在回收站。`);
    }
    setBusyId(null);
  }, [busyId]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const typeChips = ['all', ...Object.keys(RECYCLE_TYPE_LABELS)];

  return (
    <div className="rb-page">
      {purgeTarget && <dialog ref={purgeDialogRef} className="rb-purge-dialog" aria-labelledby="rb-purge-title"
        onCancel={(e) => { e.preventDefault(); if (!busyId) setPurgeTarget(null); }}>
        <h2 id="rb-purge-title">彻底删除</h2>
        <p>确定彻底删除“{purgeTarget.title}”吗？未被其他内容引用的附件、正文图片和封面也会清理，此操作无法恢复。</p>
        {purgeError && <p role="alert" className="rb-purge-dialog__error">{purgeError} 条目暂时保留；部分文件可能已清理，请重试彻底删除。</p>}
        <div className="rb-card__actions">
          <button type="button" className="rb-card__btn" disabled={!!busyId} onClick={() => setPurgeTarget(null)}>取消</button>
          <button type="button" className="rb-card__btn rb-card__btn--purge" disabled={!!busyId} onClick={handlePurge}>
            {busyId ? '正在清理…' : '彻底删除'}
          </button>
        </div>
      </dialog>}

      <div className="container">
        <div className="rb-page__header">
          <div>
            <h1><Trash2 size={28} /> 回收站</h1>
            <p>这里暂存各模块删除的资料与分享，可恢复到原处。</p>
          </div>
        </div>

        {/* 筛选 */}
        <div className="rb-filters">
          <div className="rb-filters__search">
            <Search size={18} className="rb-filters__icon" />
            <input
              type="text"
              placeholder="搜索标题或作者..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="rb-filters__input"
            />
          </div>
          <div className="rb-filters__types">
            {typeChips.map((t) => (
              <button
                key={t}
                className={`rb-filters__chip ${typeFilter === t ? 'rb-filters__chip--active' : ''}`}
                onClick={() => setTypeFilter(t)}
              >
                {t === 'all' ? '全部' : RECYCLE_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {notice && <p role="status">{notice}</p>}

        {/* 列表 */}
        <div className="rb-list">
          {filtered.map((entry) => {
            const TypeIcon = TYPE_ICONS[entry.itemType] || FileText;
            const typeLabel = RECYCLE_TYPE_LABELS[entry.itemType] || '内容';
            return (
              <div key={entry.id} className="ia-card card ep-card rb-card">
                <div className="ia-card__body">
                  <div className="ep-card__top">
                    <span className="rb-card__type">
                      <TypeIcon size={12} /> {typeLabel}
                    </span>
                  </div>
                  <h3 className="ia-card__title">{entry.title}</h3>
                  {entry.excerpt && (
                    <p className="ia-card__excerpt">{entry.excerpt}</p>
                  )}
                  <div className="ia-card__footer ep-card__info rb-card__info">
                    {entry.author && (
                      <span className="ia-card__meta">
                        <User size={13} /> {entry.author}
                      </span>
                    )}
                    <span className="ia-card__meta">
                      <Clock size={13} /> 删除于 {formatDeletedAt(entry.deletedAt)}
                    </span>
                  </div>
                  <div className="rb-card__actions">
                    <button
                      type="button"
                      className="rb-card__btn rb-card__btn--restore"
                      onClick={() => handleRestore(entry)}
                      disabled={!!busyId}
                    >
                      <RotateCcw size={14} /> 恢复
                    </button>
                    {isAdmin && <button type="button" className="rb-card__btn rb-card__btn--purge"
                      onClick={() => { setPurgeError(''); setPurgeTarget(entry); }} disabled={!!busyId}>
                      <Trash2 size={14} /> 彻底删除
                    </button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {loaded && filtered.length === 0 && (
          <div className="rb-empty">
            <Trash2 size={48} />
            <h3>回收站是空的</h3>
            <p>删除的资料与分享会先放到这里，方便随时恢复。</p>
          </div>
        )}
      </div>
    </div>
  );
}
