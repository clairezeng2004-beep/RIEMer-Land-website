import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationContext';
import CustomSelect from '../../components/CustomSelect';
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
  Upload,
  Paperclip,
  X,
  File,
  Image,
  FileSpreadsheet,
  FileArchive,
} from 'lucide-react';
import { attachWordImageEditor } from '../../utils/wordImageEditor';
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
        <CustomSelect
          size="sm"
          className="msc-period__select"
          placeholder="年份"
          value={startYear ? String(startYear) : ''}
          onChange={(v) => update('startYear', v ? Number(v) : null)}
          options={[{ value: '', label: '年份' }, ...YEARS.map((y) => ({ value: String(y), label: String(y) }))]}
        />
        <span className="msc-period__sep">年</span>
        <CustomSelect
          size="sm"
          className="msc-period__select"
          placeholder="月份"
          value={startMonth ? String(startMonth) : ''}
          onChange={(v) => update('startMonth', v ? Number(v) : null)}
          options={[{ value: '', label: '月份' }, ...MONTHS.map((m) => ({ value: String(m), label: String(m) }))]}
        />
        <span className="msc-period__sep">月</span>
      </div>

      <span className="msc-period__to">至</span>

      <div className="msc-period__group">
        <CustomSelect
          size="sm"
          className="msc-period__select"
          placeholder="年份"
          value={endYear ? String(endYear) : ''}
          onChange={(v) => update('endYear', v ? Number(v) : null)}
          options={[{ value: '', label: '年份' }, ...YEARS.map((y) => ({ value: String(y), label: String(y) }))]}
        />
        <span className="msc-period__sep">年</span>
        <CustomSelect
          size="sm"
          className="msc-period__select"
          placeholder="月份"
          value={endMonth ? String(endMonth) : ''}
          onChange={(v) => update('endMonth', v ? Number(v) : null)}
          options={[{ value: '', label: '月份' }, ...MONTHS.map((m) => ({ value: String(m), label: String(m) }))]}
        />
        <span className="msc-period__sep">月</span>
      </div>
    </div>
  );
}

/* ====== 文件类型图标映射 ====== */
function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return Image;
  if (['pdf'].includes(ext)) return FileText;
  if (['xls', 'xlsx', 'csv'].includes(ext)) return FileSpreadsheet;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return FileArchive;
  if (['doc', 'docx', 'ppt', 'pptx', 'txt', 'md'].includes(ext)) return FileText;
  return File;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// 将文件转为 base64 Data URL
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ====== 附件拖拽上传组件 ====== */
function AttachmentUploader({ attachments, onChange }) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const dragCounterRef = useRef(0);

  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB（localStorage 限制）
  const MAX_FILES = 10;

  const handleFiles = useCallback(async (files) => {
    const newFiles = [];
    for (const file of files) {
      if (attachments.length + newFiles.length >= MAX_FILES) {
        alert(`最多只能上传 ${MAX_FILES} 个附件`);
        break;
      }
      if (file.size > MAX_FILE_SIZE) {
        alert(`文件 "${file.name}" 超过 5MB 限制，已跳过`);
        continue;
      }
      try {
        const dataUrl = await fileToDataUrl(file);
        newFiles.push({
          id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          size: file.size,
          type: file.type,
          dataUrl,
        });
      } catch {
        /* 读取失败，跳过 */
      }
    }
    if (newFiles.length > 0) {
      onChange([...attachments, ...newFiles]);
    }
  }, [attachments, onChange]);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleFiles(files);
  }, [handleFiles]);

  const handleInputChange = useCallback((e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) handleFiles(files);
    e.target.value = '';
  }, [handleFiles]);

  const removeFile = useCallback((id) => {
    onChange(attachments.filter((f) => f.id !== id));
  }, [attachments, onChange]);

  return (
    <div className="msc-attach">
      {/* 拖拽上传区 */}
      <div
        className={`msc-attach__dropzone ${isDragging ? 'msc-attach__dropzone--active' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="msc-attach__input"
          onChange={handleInputChange}
        />
        <Upload size={28} className="msc-attach__dropzone-icon" />
        <div className="msc-attach__dropzone-text">
          <span className="msc-attach__dropzone-main">
            拖拽文件到此处，或 <span className="msc-attach__dropzone-link">点击浏览</span>
          </span>
          <span className="msc-attach__dropzone-hint">
            支持任意文件格式，单文件最大 5MB，最多 {MAX_FILES} 个附件
          </span>
        </div>
      </div>

      {/* 已上传文件列表 */}
      {attachments.length > 0 && (
        <div className="msc-attach__list">
          {attachments.map((file) => {
            const IconComp = getFileIcon(file.name);
            return (
              <div key={file.id} className="msc-attach__item">
                <IconComp size={18} className="msc-attach__item-icon" />
                <div className="msc-attach__item-info">
                  <span className="msc-attach__item-name">{file.name}</span>
                  <span className="msc-attach__item-size">{formatFileSize(file.size)}</span>
                </div>
                <button
                  type="button"
                  className="msc-attach__item-remove"
                  onClick={() => removeFile(file.id)}
                  title="移除"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ====== 主组件 ====== */
export default function MemberSharingCreate() {
  const { isAuthenticated, user } = useAuth();
  const { addNotification } = useNotifications();
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
    attachments: [],
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
      const tag = el.tagName.toLowerCase();
      // 保留 <img> 的 src/alt/width/height/style/class，其它元素只保留 href
      const keepAttrs = tag === 'img'
        ? new Set(['src', 'alt', 'width', 'height', 'style', 'class'])
        : new Set(['href']);
      attrs.forEach((attr) => {
        if (!keepAttrs.has(attr.name)) el.removeAttribute(attr.name);
      });
    });
    // 对粘贴进来的 <img>：没 class 的补上 msc-img 类并包到居中段落里
    doc.querySelectorAll('img').forEach((img) => {
      if (!img.src || img.src.startsWith('file:')) {
        img.remove();
        return;
      }
      if (!img.classList.contains('msc-img')) img.classList.add('msc-img');
      img.setAttribute('draggable', 'false');
      const parent = img.parentElement;
      if (!parent || !parent.classList.contains('msc-img-wrap')) {
        const wrap = doc.createElement('p');
        wrap.className = 'msc-img-wrap';
        wrap.setAttribute('style', 'text-align:center');
        img.replaceWith(wrap);
        wrap.appendChild(img);
      }
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
    // 若剪贴板里有图片，交给 wordImageEditor（capture 阶段已处理），此处不再执行
    const items = e.clipboardData?.items;
    if (items && Array.from(items).some((it) => it.kind === 'file' && it.type.startsWith('image/'))) {
      return;
    }
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

  /* ============ Word 编辑器挂载：图片插入/拖拽/粘贴/拉伸 ============ */
  const imageApiRef = useRef(null);
  useEffect(() => {
    if (newPost.format !== 'word') {
      imageApiRef.current?.destroy?.();
      imageApiRef.current = null;
      return undefined;
    }
    if (!wordEditorRef.current) return undefined;
    const api = attachWordImageEditor(wordEditorRef.current, {
      onChange: (html) => setNewPost((prev) => ({ ...prev, content: html })),
    });
    imageApiRef.current = api;
    return () => {
      api.destroy();
      imageApiRef.current = null;
    };
  }, [newPost.format]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const handleCreate = (e) => {
    e.preventDefault();
    const hasContent = newPost.content.trim().length > 0;
    const hasAttachments = newPost.attachments.length > 0;
    if (!newPost.title.trim() || (!hasContent && !hasAttachments)) {
      alert('请填写标题，并提供正文内容或上传至少一个附件');
      return;
    }

    // 构建时间段字符串（如果有填写）
    const { startYear, startMonth, endYear, endMonth } = newPost.period || {};
    let periodStr = '';
    if (startYear || endYear) {
      const start = startYear ? `${startYear}${startMonth ? '.' + String(startMonth).padStart(2, '0') : ''}` : '';
      const end = endYear ? `${endYear}${endMonth ? '.' + String(endMonth).padStart(2, '0') : ''}` : '';
      periodStr = start && end ? `${start} - ${end}` : start || end;
    }

    // 附件元信息（保留 dataUrl 以支持下载）
    const attachments = newPost.attachments.map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size,
      type: f.type,
      dataUrl: f.dataUrl,
    }));

    const post = {
      id: `sharing-${Date.now()}`,
      title: newPost.title.trim(),
      category: newPost.category,
      format: newPost.format,
      content: newPost.content,
      period: periodStr || null,
      attachments: attachments.length > 0 ? attachments : null,
      author: user?.nickname || user?.name || 'Unknown',
      authorId: user?.id || null,
      createdAt: new Date().toISOString().split('T')[0],
      likes: [],
    };

    const existing = loadSharings();
    const updated = [post, ...existing];
    saveSharings(updated);

    // 发送"新成员分享"通知（发布者自己自动已读）
    try {
      addNotification({
        title: '新成员分享',
        message: `${post.author} 发布了新分享「${post.title}」${cats.find((c) => c.key === post.category)?.label ? '（' + cats.find((c) => c.key === post.category).label + '）' : ''}`,
        type: 'sharing',
        read: true,
      });
    } catch (err) {
      console.warn('[MemberSharingCreate] 发送通知失败:', err?.message || err);
    }

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
                <span className="msc-form__hint">选填，标注分享内容的时间范围，例如 2025 年 6 月到 9 月实习则标注 2025 年 6 月 至 2025 年 9 月</span>
              </label>
              <PeriodPicker
                value={newPost.period}
                onChange={(period) => setNewPost({ ...newPost, period })}
              />
            </div>

            {/* 格式切换 + 附件上传（同一行） */}
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

                <div className="msc-form__format-divider" />

                <button
                  type="button"
                  className="msc-form__format-btn msc-form__attach-btn"
                  onClick={() => document.getElementById('msc-attach-input')?.click()}
                >
                  <Paperclip size={14} /> 上传附件
                  {newPost.attachments.length > 0 && (
                    <span className="msc-form__attach-badge">{newPost.attachments.length}</span>
                  )}
                </button>
                <input
                  id="msc-attach-input"
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const files = Array.from(e.target.files);
                    if (files.length > 0) {
                      const processFiles = async () => {
                        const MAX_FILE_SIZE = 5 * 1024 * 1024;
                        const MAX_FILES = 10;
                        const newFiles = [];
                        for (const file of files) {
                          if (newPost.attachments.length + newFiles.length >= MAX_FILES) {
                            alert(`最多只能上传 ${MAX_FILES} 个附件`);
                            break;
                          }
                          if (file.size > MAX_FILE_SIZE) {
                            alert(`文件 "${file.name}" 超过 5MB 限制，已跳过`);
                            continue;
                          }
                          try {
                            const dataUrl = await fileToDataUrl(file);
                            newFiles.push({
                              id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                              name: file.name,
                              size: file.size,
                              type: file.type,
                              dataUrl,
                            });
                          } catch { /* ignore */ }
                        }
                        if (newFiles.length > 0) {
                          setNewPost((prev) => ({
                            ...prev,
                            attachments: [...prev.attachments, ...newFiles],
                          }));
                        }
                      };
                      processFiles();
                    }
                    e.target.value = '';
                  }}
                />
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
                  <div className="msc-form__editor-toolbar">
                    <button
                      type="button"
                      className="msc-form__paste-btn"
                      onClick={handleOneClickPaste}
                    >
                      <Clipboard size={14} /> 一键粘贴
                    </button>
                    <button
                      type="button"
                      className="msc-form__paste-btn msc-form__paste-btn--ghost"
                      onClick={() => imageApiRef.current?.pickImage()}
                      title="插入图片（也支持拖拽/粘贴；插入后点击图片可拖动 8 个手柄调整大小，按住 Shift 自由缩放）"
                    >
                      <Image size={14} /> 插入图片（也支持拖拽插入）
                    </button>
                  </div>
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
                    data-placeholder="从 Word 复制内容后，点击上方「一键粘贴」按钮，或直接 Ctrl+V / ⌘+V 粘贴；可以直接拖拽/粘贴图片，图片插入后居中显示，点击图片可以拖动手柄调整大小"
                    suppressContentEditableWarning
                  />
                </div>
              )}
            </div>

            {/* 已上传附件列表 */}
            {newPost.attachments.length > 0 && (
              <div className="msc-form__field">
                <label>
                  <Paperclip size={14} /> 已上传附件
                  <span className="msc-form__hint">共 {newPost.attachments.length} 个文件</span>
                </label>
                <div className="msc-attach__list">
                  {newPost.attachments.map((file) => {
                    const IconComp = getFileIcon(file.name);
                    return (
                      <div key={file.id} className="msc-attach__item">
                        <IconComp size={18} className="msc-attach__item-icon" />
                        <div className="msc-attach__item-info">
                          <span className="msc-attach__item-name">{file.name}</span>
                          <span className="msc-attach__item-size">{formatFileSize(file.size)}</span>
                        </div>
                        <button
                          type="button"
                          className="msc-attach__item-remove"
                          onClick={() => setNewPost((prev) => ({
                            ...prev,
                            attachments: prev.attachments.filter((f) => f.id !== file.id),
                          }))}
                          title="移除"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
