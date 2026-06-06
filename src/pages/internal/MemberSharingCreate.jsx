import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { emitNotificationEvent } from '../../lib/notificationRuleEngine';
import CustomSelect from '../../components/CustomSelect';
import { marked } from 'marked';
import {
  Share2,
  Plus,
  ChevronLeft,
  ChevronDown,
  Code2,
  FileText,
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
import {
  attachTableControls,
  attachColumnPlaceholderHandler,
  attachWordEditingNormalizer,
} from '../../utils/wordDocBlocks';
import FloatingTextToolbar from '../../components/FloatingTextToolbar';
import WordEditorToolbar from '../../components/WordEditorToolbar';
import WordBlockHandle from '../../components/WordBlockHandle';
import { handleEditorTabIndent } from '../../utils/editorTabIndent';
import SyncScrollToggle from '../../components/SyncScrollToggle';
import useMarkdownSyncScroll from '../../hooks/useMarkdownSyncScroll';
import useAutoResizeTextarea from '../../hooks/useAutoResizeTextarea';
import { stripUnderline } from '../../utils/stripUnderline';
import { htmlToMarkdown, markdownToHtml } from '../../utils/markdownWordInterop';
import {
  addSharing,
  updateSharing,
  fetchSharingById,
  fetchCategories,
  addCategory as addCategoryRemote,
  DEFAULT_CATEGORIES,
} from '../../services/memberSharingService';
import './MemberSharingCreate.css';

// 生成年份列表：从「当前年份」开始往前 10 年（不含未来年份）。
// 这样下拉默认定位到当前年份，而不是之前从 cur+2 起头、顶部停在未来年份
// （例如 2026 年时停在 2028）。选项数 > 6，CustomSelect 会自动显示搜索框，
// 用户可直接打字筛选/输入想要的年份，时间段本身仍为选填、可不选。
function getYears() {
  const cur = new Date().getFullYear();
  const years = [];
  for (let y = cur; y >= cur - 10; y--) {
    years.push(y);
  }
  return years;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const YEARS = getYears();

function parsePeriodValue(period) {
  if (!period) {
    return { startYear: null, startMonth: null, endYear: null, endMonth: null };
  }
  const parts = String(period).split(/\s*-\s*/);
  const parsePart = (value) => {
    const match = String(value || '').trim().match(/^(\d{4})(?:\.(\d{1,2}))?$/);
    return {
      year: match ? Number(match[1]) : null,
      month: match?.[2] ? Number(match[2]) : null,
    };
  };
  const start = parsePart(parts[0]);
  const end = parsePart(parts[1]);
  return {
    startYear: start.year,
    startMonth: start.month,
    endYear: end.year,
    endMonth: end.month,
  };
}

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

/* ====== 时间段选择器（成员经验分享用：从年月 至 年月） ====== */
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
          placeholder=""
          value={startYear ? String(startYear) : ''}
          onChange={(v) => update('startYear', v ? Number(v) : null)}
          options={[{ value: '', label: '' }, ...YEARS.map((y) => ({ value: String(y), label: String(y) }))]}
        />
        <span className="msc-period__sep">年</span>
        <CustomSelect
          size="sm"
          className="msc-period__select"
          placeholder=""
          value={startMonth ? String(startMonth) : ''}
          onChange={(v) => update('startMonth', v ? Number(v) : null)}
          options={[{ value: '', label: '' }, ...MONTHS.map((m) => ({ value: String(m), label: String(m) }))]}
        />
        <span className="msc-period__sep">月</span>
      </div>

      <span className="msc-period__to">至</span>

      <div className="msc-period__group">
        <CustomSelect
          size="sm"
          className="msc-period__select"
          placeholder=""
          value={endYear ? String(endYear) : ''}
          onChange={(v) => update('endYear', v ? Number(v) : null)}
          options={[{ value: '', label: '' }, ...YEARS.map((y) => ({ value: String(y), label: String(y) }))]}
        />
        <span className="msc-period__sep">年</span>
        <CustomSelect
          size="sm"
          className="msc-period__select"
          placeholder=""
          value={endMonth ? String(endMonth) : ''}
          onChange={(v) => update('endMonth', v ? Number(v) : null)}
          options={[{ value: '', label: '' }, ...MONTHS.map((m) => ({ value: String(m), label: String(m) }))]}
        />
        <span className="msc-period__sep">月</span>
      </div>
    </div>
  );
}

/* ====== 单点日期选择器（历史会议用：某年某月） ======
 * 与 PeriodPicker 共享 period 对象结构，但只读写 startYear / startMonth，
 * endYear / endMonth 始终留 null。这样切换分类时不会丢失已填的 start，
 * 切回"成员经验分享"时用户原先输入的起点月份还在。 */
function SinglePointPicker({ value, onChange }) {
  const { startYear, startMonth } = value || {};

  const update = (field, val) => {
    onChange({ ...value, [field]: val || null });
  };

  return (
    <div className="msc-period">
      <div className="msc-period__group">
        <CustomSelect
          size="sm"
          className="msc-period__select"
          placeholder=""
          value={startYear ? String(startYear) : ''}
          onChange={(v) => update('startYear', v ? Number(v) : null)}
          options={[{ value: '', label: '' }, ...YEARS.map((y) => ({ value: String(y), label: String(y) }))]}
        />
        <span className="msc-period__sep">年</span>
        <CustomSelect
          size="sm"
          className="msc-period__select"
          placeholder=""
          value={startMonth ? String(startMonth) : ''}
          onChange={(v) => update('startMonth', v ? Number(v) : null)}
          options={[{ value: '', label: '' }, ...MONTHS.map((m) => ({ value: String(m), label: String(m) }))]}
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
            <span className="msc-attach__dropzone-drag">拖拽文件到此处，或 </span>
            <span className="msc-attach__dropzone-link">点击浏览</span>
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
  const { isAuthenticated, isAdmin, user } = useAuth();
  const { addNotification } = useNotifications();
  const navigate = useNavigate();
  const location = useLocation();
  const wordEditorRef = useRef(null);
  const mdEditorRef = useRef(null);
  const mdPreviewRef = useRef(null);
  const editId = useMemo(() => new URLSearchParams(location.search).get('edit'), [location.search]);
  const isEditingPost = !!editId;

  // 浏览器标签页标题：新窗口里更直观地显示当前在编辑什么文档
  useEffect(() => {
    const prev = document.title;
    document.title = isEditingPost ? '成员内部分享 - 编辑文档' : '成员内部分享 - 文档编辑';
    return () => { document.title = prev; };
  }, [isEditingPost]);

  /* ============ Markdown 同步滚动 ============
   * 统一由 useMarkdownSyncScroll hook 管理：
   *   - 默认关闭，两侧各自独立滚动
   *   - 点击 <SyncScrollToggle /> 才显式开启
   *   - 内部用 lockRef 做互斥，避免 A->B->A 循环触发
   * 所有 Markdown 编辑入口共用同一个 hook + 开关组件，
   * 避免"有的页面有开关、有的没有"的体验割裂。
   * （这里 mdEditorRef / mdPreviewRef 仍保留下来，
   *  因为 FloatingTextToolbar 也要用 editorRef 做定位。） */
  const {
    syncScroll,
    toggleSyncScroll,
    editorRef: syncEditorRef,
    previewRef: syncPreviewRef,
    handleEditorScroll,
    handlePreviewScroll,
  } = useMarkdownSyncScroll(false);

  // 加载动态分类（先本地默认，然后从云端拉取）
  const [cats, setCats] = useState(DEFAULT_CATEGORIES);

  useEffect(() => {
    let cancelled = false;
    fetchCategories()
      .then((list) => {
        if (cancelled) return;
        // 允许云端空数组（用户可能已在其它设备把所有分类都删了），
        // 直接应用；若服务层意外返回 null/undefined 则保留当前 cats。
        if (Array.isArray(list)) setCats(list);
      })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, []);

  const [newPost, setNewPost] = useState({
    title: '',
    summary: '',
    category: cats.length > 0 ? cats[0].key : 'experience',
    format: 'word',
    content: '',
    period: { startYear: null, startMonth: null, endYear: null, endMonth: null },
    attachments: [],
  });
  const [isPublishing, setIsPublishing] = useState(false);
  const [editingSource, setEditingSource] = useState(null);

  useEffect(() => {
    if (!editId || !isAuthenticated) return;
    let cancelled = false;
    fetchSharingById(editId)
      .then((post) => {
        if (cancelled) return;
        if (!post) {
          alert('没有找到这篇分享');
          navigate('/internal/member-sharing', { replace: true });
          return;
        }
        const canEdit = isAdmin || (post.authorId && String(post.authorId) === String(user?.id));
        if (!canEdit) {
          alert('你没有权限编辑这篇分享');
          navigate('/internal/member-sharing', { replace: true });
          return;
        }
        setEditingSource(post);
        setNewPost({
          title: post.title || '',
          summary: post.summary || '',
          category: post.category || 'experience',
          format: post.format || 'word',
          content: post.content || '',
          period: parsePeriodValue(post.period),
          attachments: Array.isArray(post.attachments) ? post.attachments : [],
        });
      })
      .catch(() => {
        if (cancelled) return;
        alert('加载分享内容失败，请稍后再试');
        navigate('/internal/member-sharing', { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [editId, isAuthenticated, isAdmin, navigate, user?.id]);

  // Markdown 编辑器：高度随内容自动增长，避免被父容器限制（用户要求"不要限制高度"）
  useAutoResizeTextarea(mdEditorRef, newPost.content, { minHeight: 360 });

  // 新增分类（同步到云端）
  const handleAddCategory = (cat) => {
    setCats((prev) => [...prev, cat]);
    addCategoryRemote(cat).catch(() => { /* ignore */ });
  };

  const handleFormatChange = useCallback((format) => {
    setNewPost((prev) => {
      if (prev.format === format) return prev;
      if (format === 'markdown') {
        return { ...prev, format, content: htmlToMarkdown(prev.content) };
      }
      return { ...prev, format, content: stripUnderline(markdownToHtml(prev.content)) };
    });
  }, []);

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
    // 粘贴入口统一清除 Word / 网页带过来的下划线装饰，
    // 保证编辑器里的所见即所得与全站正文样式一致（站点正文不使用下划线装饰）。
    cleaned = stripUnderline(cleaned);
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
      const paragraphs = stripUnderline(
        text.split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
      );
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
          const paragraphs = stripUnderline(
            text.split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
          );
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
          const paragraphs = stripUnderline(
            text.split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
          );
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
    return marked.parse(newPost.content, { breaks: true, gfm: true });
  }, [newPost.format, newPost.content]);

  /* ============ Word 编辑器挂载：图片插入/拖拽/粘贴/拉伸 + 分栏 + 表格 ============ */
  const imageApiRef = useRef(null);
  useEffect(() => {
    if (newPost.format !== 'word') {
      imageApiRef.current?.destroy?.();
      imageApiRef.current = null;
      return undefined;
    }
    if (!wordEditorRef.current) return undefined;
    const editor = wordEditorRef.current;
    const api = attachWordImageEditor(editor, {
      onChange: (html) => setNewPost((prev) => ({ ...prev, content: html })),
    });
    imageApiRef.current = api;

    // 表格行列控制条 + 分栏占位点击补图
    const syncHtml = () => {
      setNewPost((prev) => ({ ...prev, content: editor.innerHTML }));
    };
    const detachTable = attachTableControls(editor, syncHtml);
    const detachCols = attachColumnPlaceholderHandler(editor, syncHtml);
    const detachNormalize = attachWordEditingNormalizer(editor, syncHtml);

    return () => {
      detachNormalize();
      detachCols();
      detachTable();
      api.destroy();
      imageApiRef.current = null;
    };
  }, [newPost.format]);

  useEffect(() => {
    if (newPost.format !== 'word' || !wordEditorRef.current) return;
    if (wordEditorRef.current.innerHTML !== newPost.content) {
      wordEditorRef.current.innerHTML = newPost.content || '';
    }
  }, [newPost.format, newPost.content]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const handleCreate = async (e) => {
    e?.preventDefault?.();
    if (isPublishing) return;

    const currentContent = newPost.format === 'word' && wordEditorRef.current
      ? wordEditorRef.current.innerHTML
      : newPost.content;
    const normalizedContent = stripUnderline(currentContent || '');
    const hasContent = normalizedContent.trim().length > 0;
    const hasAttachments = newPost.attachments.length > 0;
    if (!newPost.title.trim() || (!hasContent && !hasAttachments)) {
      alert('请填写标题，并提供正文内容或上传至少一个附件');
      return;
    }

    setIsPublishing(true);

    // 构建时间段字符串（如果有填写）
    // 规则：
    //   - category === 'history'   → 单个时间点 "YYYY.MM" 或 "YYYY"
    //     （UI 上只有一组年/月选择，endYear/endMonth 永远为 null）
    //   - category === 'experience' → 区间 "YYYY.MM - YYYY.MM"
    //     （任一端缺失时退化为单端；两端全空则不输出）
    //   - 其它分类（不显示时间段 UI）→ 强制不带 period，避免切分类时残留旧值
    const { startYear, startMonth, endYear, endMonth } = newPost.period || {};
    let periodStr = '';
    if (newPost.category === 'history') {
      if (startYear) {
        periodStr = `${startYear}${startMonth ? '.' + String(startMonth).padStart(2, '0') : ''}`;
      }
    } else if (newPost.category === 'experience') {
      if (startYear || endYear) {
        const start = startYear ? `${startYear}${startMonth ? '.' + String(startMonth).padStart(2, '0') : ''}` : '';
        const end = endYear ? `${endYear}${endMonth ? '.' + String(endMonth).padStart(2, '0') : ''}` : '';
        periodStr = start && end ? `${start} - ${end}` : start || end;
      }
    }
    // 其它分类：periodStr 保持空字符串，post.period 最终会是 null

    // 附件元信息（保留 dataUrl 以支持下载）
    const attachments = newPost.attachments.map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size,
      type: f.type,
      dataUrl: f.dataUrl,
    }));

    const post = {
      id: editingSource?.id || `sharing-${Date.now()}`,
      title: newPost.title.trim(),
      summary: newPost.summary.trim(),
      category: newPost.category,
      format: newPost.format,
      content: normalizedContent,
      period: periodStr || null,
      attachments: attachments.length > 0 ? attachments : null,
      author: editingSource?.author || user?.name || user?.nickname || 'Unknown',
      authorId: editingSource?.authorId || user?.id || null,
      createdAt: editingSource?.createdAt || new Date().toISOString().split('T')[0],
      likes: editingSource?.likes || [],
    };

    try {
      if (isEditingPost) {
        // updateSharing 内部会先同步更新本地缓存，云端在后台同步。
        // 不再 await 云端，避免"保存后长时间无反应"。
        updateSharing(post.id, {
          title: post.title,
          summary: post.summary,
          category: post.category,
          format: post.format,
          content: post.content,
          period: post.period,
          attachments: post.attachments,
        }).catch((err) => console.warn('[MemberSharingCreate] 云端更新失败（已写本地）:', err?.message || err));
      } else {
        // addSharing 在调用瞬间已同步写入本地缓存（列表页用缓存可立即显示），
        // 云端同步放到后台进行。不再 await 云端附件上传/插入，
        // 避免移动端冷启动/弱网下"点了发布要等很久、其实已发布却没反应"。
        addSharing(post).catch((err) => console.warn('[MemberSharingCreate] 云端发布失败（已写本地）:', err?.message || err));

        // 发送"新成员分享"通知（由规则引擎按用户自定义规则触发）
        try {
          const categoryLabel =
            cats.find((c) => c.key === post.category)?.label || '';
          emitNotificationEvent('sharing.new', {
            operator: post.author,
            operatorUserId: user?.id,
            title: post.title,
            categoryLabel,
          });
        } catch (err) {
          console.warn('[MemberSharingCreate] 发送通知失败:', err?.message || err);
        }
      }

      // 本地已写入，立即跳转回列表页（列表用缓存秒显；云端后台同步 + Realtime 兜底）
      navigate('/internal/member-sharing');
    } finally {
      setIsPublishing(false);
    }
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
          <button type="button" className="btn btn-primary" onClick={handleCreate} disabled={isPublishing}>
            <Share2 size={16} /> {isPublishing ? (isEditingPost ? '保存中...' : '发布中...') : (isEditingPost ? '保存修改' : '发布分享')}
          </button>
        </div>
      </div>

      {/* 全屏编辑区 */}
      <div className="msc-content">
        <div className="msc-content__inner">
          <h2 className="msc-content__title"><Plus size={22} /> {isEditingPost ? '编辑分享' : '发布新分享'}</h2>
          <p className="msc-content__desc">{isEditingPost ? '修改分享内容，保存后会同步更新列表与详情页' : '填写以下内容发布分享，支持 Markdown 和 Word 格式'}</p>

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

            <div className="msc-form__field">
              <label>简介栏</label>
              <textarea
                className="msc-form__textarea msc-form__textarea--summary"
                value={newPost.summary}
                onChange={(e) => setNewPost({ ...newPost, summary: e.target.value })}
                placeholder="此内容将显示在分享卡片上。可以在此处填写推荐理由、资料使用指南、本文概览等；若不填写，将默认抓取正文开头的部分文字作为简介。"
                rows={3}
              />
            </div>

            {/* 第二行：时间段 —— 仅对两类分类显示：
                  - 成员经验分享 (experience)：从年月 至 年月（时间范围）
                  - 历史会议     (history)   ：某年某月（单个时间点）
                其它分类（如"课程资料"或用户自建分类）暂不需要时间段字段。
                切换分类时保留 period state 里已填的 startYear/startMonth，
                允许用户在两种分类间切换而不丢数据；但提交时由 handleCreate
                再次按分类裁剪，避免把多余的 endYear/endMonth 带出去。 */}
            {(newPost.category === 'experience' || newPost.category === 'history') && (
              <div className="msc-form__field">
                <label>
                  <Calendar size={14} /> {newPost.category === 'history' ? '会议时间' : '时间段'}
                  <span className="msc-form__hint">
                    {newPost.category === 'history'
                      ? '选填，标注会议发生的具体年份和月份，例如 2025 年 6 月'
                      : '选填，标注分享内容的时间范围，例如 2025 年 6 月到 9 月实习则标注 2025 年 6 月 至 2025 年 9 月'}
                  </span>
                </label>
                {newPost.category === 'history' ? (
                  <SinglePointPicker
                    value={newPost.period}
                    onChange={(period) => setNewPost({ ...newPost, period })}
                  />
                ) : (
                  <PeriodPicker
                    value={newPost.period}
                    onChange={(period) => setNewPost({ ...newPost, period })}
                  />
                )}
              </div>
            )}

            {/* 格式切换 + 附件上传（同一行） */}
            <div className="msc-form__field">
              <label>内容格式</label>
              <div className="msc-form__format-toggle">
                <button
                  type="button"
                  className={`msc-form__format-btn ${newPost.format === 'word' ? 'msc-form__format-btn--active' : ''}`}
                  onClick={() => handleFormatChange('word')}
                >
                  <FileText size={14} /> Word (HTML)
                </button>
                <button
                  type="button"
                  className={`msc-form__format-btn ${newPost.format === 'markdown' ? 'msc-form__format-btn--active' : ''}`}
                  onClick={() => handleFormatChange('markdown')}
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
                    : '支持从 Word 直接粘贴，自动保留格式'}
                </span>
              </label>
              {newPost.format === 'markdown' ? (
                <div className="msc-md-split">
                  <div className="msc-md-split__pane">
                    <div className="msc-md-split__label">
                      <Code2 size={14} /> 编辑
                      <SyncScrollToggle on={syncScroll} onToggle={toggleSyncScroll} />
                    </div>
                    <textarea
                      ref={(el) => {
                        // 同时写入两个 ref：
                        //   - mdEditorRef：供 FloatingTextToolbar 定位使用
                        //   - syncEditorRef：供 useMarkdownSyncScroll hook 计算滚动比例
                        mdEditorRef.current = el;
                        syncEditorRef.current = el;
                      }}
                      className="msc-md-split__editor"
                      value={newPost.content}
                      onChange={(e) => setNewPost({ ...newPost, content: e.target.value })}
                      onScroll={handleEditorScroll}
                      placeholder={'# 标题\n\n正文内容...\n\n- 列表项 1\n- 列表项 2'}
                      rows={16}
                    />
                    <FloatingTextToolbar
                      mode="markdown"
                      editorRef={mdEditorRef}
                      value={newPost.content}
                      onChange={(nextValue) => setNewPost((prev) => ({ ...prev, content: nextValue }))}
                    />
                  </div>
                  <div className="msc-md-split__pane">
                    <div className="msc-md-split__label">
                      <Eye size={14} /> 预览
                    </div>
                    <div
                      ref={(el) => {
                        mdPreviewRef.current = el;
                        syncPreviewRef.current = el;
                      }}
                      className="msc-md-split__preview"
                      onScroll={handlePreviewScroll}
                      dangerouslySetInnerHTML={{
                        __html: markdownPreview || '<p class="msc-md-split__empty">在左侧输入 Markdown 内容后，这里会显示实时预览</p>',
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="msc-form__word-editor-wrapper">
                  <WordEditorToolbar
                    editorRef={wordEditorRef}
                    imageApiRef={imageApiRef}
                    onChange={(html) => setNewPost((prev) => ({ ...prev, content: html }))}
                  />
                  <div
                    ref={wordEditorRef}
                    className="msc-form__word-editor"
                    contentEditable
                    onKeyDown={handleEditorTabIndent}
                    onPaste={handleWordPaste}
                    onInput={() => {
                      if (wordEditorRef.current) {
                        setNewPost((prev) => ({ ...prev, content: wordEditorRef.current.innerHTML }));
                      }
                    }}
                    data-placeholder="从 Word 复制内容后，直接 Ctrl+V / ⌘+V 粘贴；可以直接拖拽/粘贴图片，图片插入后居中显示，点击图片可以拖动手柄调整大小"
                    suppressContentEditableWarning
                  />
                  <FloatingTextToolbar
                    editorRef={wordEditorRef}
                    onChange={(html) => setNewPost((prev) => ({ ...prev, content: html }))}
                  />
                  <WordBlockHandle
                    editorRef={wordEditorRef}
                    onChange={(html) => setNewPost((prev) => ({ ...prev, content: html }))}
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
