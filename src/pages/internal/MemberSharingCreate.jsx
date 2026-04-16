import { useState, useCallback, useRef, useMemo } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { marked } from 'marked';
import {
  Share2,
  Plus,
  ChevronLeft,
  Code2,
  FileText,
  Clipboard,
  Eye,
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

export default function MemberSharingCreate() {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const wordEditorRef = useRef(null);

  // 加载动态分类
  const cats = loadCategories();
  const categoryLabels = {};
  cats.forEach((c) => { categoryLabels[c.key] = c.label; });

  const [newPost, setNewPost] = useState({
    title: '',
    category: cats.length > 0 ? cats[0].key : 'experience',
    format: 'word',
    content: '',
  });

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

    const post = {
      id: `sharing-${Date.now()}`,
      title: newPost.title.trim(),
      category: newPost.category,
      format: newPost.format,
      content: newPost.content,
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
      <div className="container">
        {/* 顶部导航 */}
        <div className="msc-header">
          <button className="msc-header__back" onClick={() => navigate('/internal/member-sharing')}>
            <ChevronLeft size={20} /> 返回列表
          </button>
        </div>

        {/* 发布表单 */}
        <div className="msc-card card">
          <h2 className="msc-card__title"><Plus size={22} /> 发布新分享</h2>
          <p className="msc-card__desc">填写以下内容发布分享，支持 Markdown 和 Word 格式</p>

          <form onSubmit={handleCreate} className="msc-form">
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
                <select
                  className="msc-form__input msc-form__select"
                  value={newPost.category}
                  onChange={(e) => setNewPost({ ...newPost, category: e.target.value })}
                >
                  {Object.entries(categoryLabels).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
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

            <div className="msc-form__field">
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

            <div className="msc-form__actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigate('/internal/member-sharing')}
              >
                取消
              </button>
              <button type="submit" className="btn btn-primary">
                <Share2 size={16} /> 发布分享
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
