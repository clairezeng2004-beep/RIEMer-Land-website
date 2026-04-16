import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { marked } from 'marked';
import {
  Share2,
  Plus,
  ChevronLeft,
  ChevronDown,
  Code2,
  FileText,
  Clipboard,
  Eye,
  Check,
  Calendar,
} from 'lucide-react';
import './MemberSharingCreate.css';

const SHARING_KEY = 'riemer_member_sharing';
const CATEGORIES_KEY = 'riemer_sharing_categories';

// 默认分类（与 MemberSharing.jsx 保持一致）
const DEFAULT_CATEGORIES = [
  { key: 'course', label: '课程资料', color: '#5EAD8C' },
  { key: 'history', label: '历史会议', color: '#4FBFC4' },
  { key: 'experience', label: '成员经验分享', color: '#EC4899' },
];

function loadCategories() {
  try {
    const stored = localStorage.getItem(CATEGORIES_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return DEFAULT_CATEGORIES;
}

function saveCategories(data) {
  localStorage.setItem(CATEGORIES_KEY, JSON.stringify(data));
}

function loadSharings() {
  try {
    const stored = localStorage.getItem(SHARING_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

function saveSharings(data) {
  localStorage.setItem(SHARING_KEY, JSON.stringify(data));
}

// 生成年份列表（当前年份往前 10 年，往后 2 年）
function getYears() {
  const cur = new Date().getFullYear();
  const years = [];
  for (let y = cur + 2; y >= cur - 10; y--) {
    years.push(y);
  }
  return years;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const YEARS = getYears();

/* ====== 自定义分类选择器 ====== */
function CategorySelect({ cats, value, onChange, onAddCategory }) {
  const [open, setOpen] = useState(false);
  const [newCatInput, setNewCatInput] = useState('');
  const [showAddInput, setShowAddInput] = useState(false);
  const ref = useRef(null);

  // 关闭下拉
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setShowAddInput(false);
        setNewCatInput('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = cats.find((c) => c.key === value);

  const handleAdd = () => {
    const label = newCatInput.trim();
    if (!label) return;
    if (cats.some((c) => c.label === label)) {
      alert('该分类名称已存在');
      return;
    }
    const key = 'cat_' + Date.now();
    onAddCategory({ key, label, color: '#6366F1' });
    onChange(key);
    setNewCatInput('');
    setShowAddInput(false);
    setOpen(false);
  };

  return (
    <div className="msc-custom-select" ref={ref}>
      <button
        type="button"
        className={`msc-custom-select__trigger ${open ? 'msc-custom-select__trigger--open' : ''}`}
        onClick={() => setOpen(!open)}
      >
        {selected && (
          <span className="msc-custom-select__dot" style={{ background: selected.color }} />
        )}
        <span className="msc-custom-select__text">{selected?.label || '选择分类'}</span>
        <ChevronDown size={16} className={`msc-custom-select__arrow ${open ? 'msc-custom-select__arrow--open' : ''}`} />
      </button>

      {open && (
        <div className="msc-custom-select__dropdown">
          <div className="msc-custom-select__options">
            {cats.map((cat) => (
              <button
                key={cat.key}
                type="button"
                className={`msc-custom-select__option ${value === cat.key ? 'msc-custom-select__option--active' : ''}`}
                onClick={() => { onChange(cat.key); setOpen(false); }}
              >
                <span className="msc-custom-select__dot" style={{ background: cat.color }} />
                <span>{cat.label}</span>
                {value === cat.key && <Check size={14} className="msc-custom-select__check" />}
              </button>
            ))}
          </div>

          <div className="msc-custom-select__divider" />

          {showAddInput ? (
            <div className="msc-custom-select__add-form">
              <input
                type="text"
                className="msc-custom-select__add-input"
                value={newCatInput}
                onChange={(e) => setNewCatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                placeholder="输入新分类名称..."
                autoFocus
              />
              <button
                type="button"
                className="msc-custom-select__add-confirm"
                onClick={handleAdd}
                disabled={!newCatInput.trim()}
              >
                添加
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="msc-custom-select__add-trigger"
              onClick={() => setShowAddInput(true)}
            >
              <Plus size={14} /> 新建分类
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ====== 时间段选择器 ====== */
function PeriodPicker({ value, onChange }) {
  const { startYear, startMonth, endYear, endMonth } = value || {};

  const update = (field, val) => {
    onChange({ ...value, [field]: val || null });
  };

  return (
    <div className="msc-period">
      <div className="msc-period__group">
        <span className="msc-period__label">从</span>
        <select
          className="msc-period__select"
          value={startYear || ''}
          onChange={(e) => update('startYear', e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">年份</option>
          {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <span className="msc-period__sep">年</span>
        <select
          className="msc-period__select"
          value={startMonth || ''}
          onChange={(e) => update('startMonth', e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">月份</option>
          {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="msc-period__sep">月</span>
      </div>

      <span className="msc-period__to">至</span>

      <div className="msc-period__group">
        <select
          className="msc-period__select"
          value={endYear || ''}
          onChange={(e) => update('endYear', e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">年份</option>
          {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <span className="msc-period__sep">年</span>
        <select
          className="msc-period__select"
          value={endMonth || ''}
          onChange={(e) => update('endMonth', e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">月份</option>
          {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="msc-period__sep">月</span>
      </div>
    </div>
  );
}

/* ====== 主组件 ====== */
export default function MemberSharingCreate() {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const wordEditorRef = useRef(null);

  // 加载动态分类
  const [cats, setCats] = useState(loadCategories);

  const [newPost, setNewPost] = useState({
    title: '',
    category: cats.length > 0 ? cats[0].key : 'experience',
    format: 'word',
    content: '',
    period: { startYear: null, startMonth: null, endYear: null, endMonth: null },
  });

  // 新增分类
  const handleAddCategory = (cat) => {
    const updated = [...cats, cat];
    setCats(updated);
    saveCategories(updated);
  };

  // 清理从 Word/网页粘贴过来的 HTML，只保留安全标签
  const cleanWordHtml = useCallback((html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, meta, link, title, head').forEach((el) => el.remove());
    doc.querySelectorAll('*').forEach((el) => {
      const attrs = [...el.attributes];
      attrs.forEach((attr) => {
        if (attr.name !== 'href') el.removeAttribute(attr.name);
      });
    });
    let cleaned = doc.body.innerHTML;
    cleaned = cleaned
      .replace(/<div[^>]*>/gi, '<p>')
      .replace(/<\/div>/gi, '</p>')
      .replace(/<span[^>]*>/gi, '')
      .replace(/<\/span>/gi, '')
      .replace(/<p>\s*<\/p>/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return cleaned;
  }, []);

  // 处理 Word 编辑器的粘贴事件
  const handleWordPaste = useCallback((e) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');

    if (html) {
      const cleaned = cleanWordHtml(html);
      document.execCommand('insertHTML', false, cleaned);
    } else if (text) {
      const paragraphs = text.split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
      document.execCommand('insertHTML', false, paragraphs || text);
    }

    if (wordEditorRef.current) {
      setNewPost((prev) => ({ ...prev, content: wordEditorRef.current.innerHTML }));
    }
  }, [cleanWordHtml]);

  // 一键粘贴按钮
  const handleOneClickPaste = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes('text/html')) {
          const blob = await item.getType('text/html');
          const html = await blob.text();
          const cleaned = cleanWordHtml(html);
          if (wordEditorRef.current) {
            wordEditorRef.current.innerHTML = cleaned;
            setNewPost((prev) => ({ ...prev, content: cleaned }));
          }
          return;
        }
        if (item.types.includes('text/plain')) {
          const blob = await item.getType('text/plain');
          const text = await blob.text();
          const paragraphs = text.split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
          if (wordEditorRef.current) {
            wordEditorRef.current.innerHTML = paragraphs;
            setNewPost((prev) => ({ ...prev, content: paragraphs }));
          }
          return;
        }
      }
    } catch {
      try {
        const text = await navigator.clipboard.readText();
        if (text && wordEditorRef.current) {
          const paragraphs = text.split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
          wordEditorRef.current.innerHTML = paragraphs;
          setNewPost((prev) => ({ ...prev, content: paragraphs }));
        }
      } catch {
        /* 剪贴板权限被拒绝 */
      }
    }
  }, [cleanWordHtml]);

  // Markdown 实时预览
  const markdownPreview = useMemo(() => {
    if (newPost.format !== 'markdown' || !newPost.content.trim()) return '';
    marked.setOptions({ breaks: true, gfm: true });
    return marked.parse(newPost.content);
  }, [newPost.format, newPost.content]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const handleCreate = (e) => {
    e.preventDefault();
    if (!newPost.title.trim() || !newPost.content.trim()) return;

    // 构建时间段字符串（如果有填写）
    const { startYear, startMonth, endYear, endMonth } = newPost.period || {};
    let periodStr = '';
    if (startYear || endYear) {
      const start = startYear ? `${startYear}${startMonth ? '.' + String(startMonth).padStart(2, '0') : ''}` : '';
      const end = endYear ? `${endYear}${endMonth ? '.' + String(endMonth).padStart(2, '0') : ''}` : '';
      periodStr = start && end ? `${start} - ${end}` : start || end;
    }

    const post = {
      id: `sharing-${Date.now()}`,
      title: newPost.title.trim(),
      category: newPost.category,
      format: newPost.format,
      content: newPost.content,
      period: periodStr || null,
      author: user?.nickname || user?.name || 'Unknown',
      authorId: user?.id || null,
      createdAt: new Date().toISOString().split('T')[0],
      likes: [],
    };

    const existing = loadSharings();
    const updated = [post, ...existing];
    saveSharings(updated);

    // 跳转回列表页
    navigate('/internal/member-sharing');
  };

  return (
    <div className="msc-page">
      {/* 顶部导航栏 */}
      <div className="msc-topbar">
        <button className="msc-topbar__back" onClick={() => navigate('/internal/member-sharing')}>
          <ChevronLeft size={20} /> 返回列表
        </button>
        <div className="msc-topbar__actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/internal/member-sharing')}
          >
            取消
          </button>
          <button type="submit" form="msc-create-form" className="btn btn-primary">
            <Share2 size={16} /> 发布分享
          </button>
        </div>
      </div>

      {/* 全屏编辑区 */}
      <div className="msc-content">
        <div className="msc-content__inner">
          <h2 className="msc-content__title"><Plus size={22} /> 发布新分享</h2>
          <p className="msc-content__desc">填写以下内容发布分享，支持 Markdown 和 Word 格式</p>

          <form id="msc-create-form" onSubmit={handleCreate} className="msc-form">
            {/* 第一行：标题 + 分类 */}
            <div className="msc-form__row">
              <div className="msc-form__field msc-form__field--grow">
                <label>标题</label>
                <input
                  type="text"
                  className="msc-form__input"
                  value={newPost.title}
                  onChange={(e) => setNewPost({ ...newPost, title: e.target.value })}
                  placeholder="请输入分享标题"
                  required
                />
              </div>
              <div className="msc-form__field">
                <label>分类</label>
                <CategorySelect
                  cats={cats}
                  value={newPost.category}
                  onChange={(key) => setNewPost({ ...newPost, category: key })}
                  onAddCategory={handleAddCategory}
                />
              </div>
            </div>

            {/* 第二行：时间段 */}
            <div className="msc-form__field">
              <label>
                <Calendar size={14} /> 时间段
                <span className="msc-form__hint">选填，标注分享内容的时间范围</span>
              </label>
              <PeriodPicker
                value={newPost.period}
                onChange={(period) => setNewPost({ ...newPost, period })}
              />
            </div>

            {/* 格式切换 */}
            <div className="msc-form__field">
              <label>内容格式</label>
              <div className="msc-form__format-toggle">
                <button
                  type="button"
                  className={`msc-form__format-btn ${newPost.format === 'word' ? 'msc-form__format-btn--active' : ''}`}
                  onClick={() => setNewPost({ ...newPost, format: 'word' })}
                >
                  <FileText size={14} /> Word (HTML)
                </button>
                <button
                  type="button"
                  className={`msc-form__format-btn ${newPost.format === 'markdown' ? 'msc-form__format-btn--active' : ''}`}
                  onClick={() => setNewPost({ ...newPost, format: 'markdown' })}
                >
                  <Code2 size={14} /> Markdown
                </button>
              </div>
            </div>

            <div className="msc-form__field msc-form__field--editor">
              <label>
                内容
                <span className="msc-form__hint">
                  {newPost.format === 'markdown'
                    ? '支持 Markdown 语法：标题用 #，加粗用 **，列表用 -'
                    : '支持一键粘贴 Word 文字，自动保留格式'}
                </span>
              </label>
              {newPost.format === 'markdown' ? (
                <div className="msc-md-split">
                  <div className="msc-md-split__pane">
                    <div className="msc-md-split__label">
                      <Code2 size={14} /> 编辑
                    </div>
                    <textarea
                      className="msc-md-split__editor"
                      value={newPost.content}
                      onChange={(e) => setNewPost({ ...newPost, content: e.target.value })}
                      placeholder={'# 标题\n\n正文内容...\n\n- 列表项 1\n- 列表项 2'}
                      rows={16}
                      required
                    />
                  </div>
                  <div className="msc-md-split__pane">
                    <div className="msc-md-split__label">
                      <Eye size={14} /> 预览
                    </div>
                    <div
                      className="msc-md-split__preview"
                      dangerouslySetInnerHTML={{
                        __html: markdownPreview || '<p class="msc-md-split__empty">在左侧输入 Markdown 内容后，这里会显示实时预览</p>',
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="msc-form__word-editor-wrapper">
                  <button
                    type="button"
                    className="msc-form__paste-btn"
                    onClick={handleOneClickPaste}
                  >
                    <Clipboard size={14} /> 一键粘贴
                  </button>
                  <div
                    ref={wordEditorRef}
                    className="msc-form__word-editor"
                    contentEditable
                    onPaste={handleWordPaste}
                    onInput={() => {
                      if (wordEditorRef.current) {
                        setNewPost((prev) => ({ ...prev, content: wordEditorRef.current.innerHTML }));
                      }
                    }}
                    data-placeholder="从 Word 复制内容后，点击上方「一键粘贴」按钮，或直接 Ctrl+V / ⌘+V 粘贴"
                    suppressContentEditableWarning
                  />
                </div>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
