import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { emitNotificationEvent } from '../../lib/notificationRuleEngine';
import CustomSelect from '../../components/CustomSelect';
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
  Columns,
  Table as TableIcon,
  Highlighter,
  FileSpreadsheet,
  FileArchive,
  Loader2,
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
import EditorToc from '../../components/EditorToc';
import { handleEditorKeyDown } from '../../utils/editorTabIndent';
import SyncScrollToggle from '../../components/SyncScrollToggle';
import useMarkdownSyncScroll from '../../hooks/useMarkdownSyncScroll';
import useAutoResizeTextarea from '../../hooks/useAutoResizeTextarea';
import { stripUnderline } from '../../utils/stripUnderline';
import { cleanPastedWordHtml, insertHtmlReplacingEmptyParagraph, plainTextToEditorHtml } from '../../utils/cleanPastedWordHtml';
import { attachPasteAndMatchStyleHandler, insertPlainTextMatchingEditorStyle } from '../../utils/pasteMatchStyle';
import { htmlToMarkdown, markdownToHtml } from '../../utils/markdownWordInterop';
import { getCachedAllUsers } from '../../lib/userDirectoryCache';
import {
  addSharing,
  updateSharing,
  fetchSharingById,
  fetchCategories,
  addCategory as addCategoryRemote,
  DEFAULT_CATEGORIES,
} from '../../services/memberSharingService';
import './MemberSharingCreate.css';

const HIDDEN_CATEGORY_KEYS = new Set(['history']);

function getVisibleCategories(cats) {
  return (Array.isArray(cats) ? cats : []).filter((cat) => !HIDDEN_CATEGORY_KEYS.has(cat.key));
}

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

function insertTextAtTextarea(textarea, value, snippet, { selectOffset = null, selectLength = 0 } = {}) {
  const start = textarea?.selectionStart ?? value.length;
  const end = textarea?.selectionEnd ?? value.length;
  const nextValue = `${value.slice(0, start)}${snippet}${value.slice(end)}`;
  const cursor = selectOffset == null
    ? start + snippet.length
    : start + selectOffset;

  requestAnimationFrame(() => {
    textarea?.focus();
    textarea?.setSelectionRange(cursor, cursor + selectLength);
  });

  return nextValue;
}

function buildMarkdownColumns(count) {
  const n = Math.max(2, Math.min(4, Number(count) || 2));
  const cols = Array.from({ length: n }, (_, index) => (
    `  <div class="msc-col">\n    <p>第 ${index + 1} 栏内容</p>\n  </div>`
  )).join('\n');
  return `\n<div class="msc-cols msc-cols--${n}" data-cols="${n}">\n${cols}\n</div>\n`;
}

function buildMarkdownTable(rows = 3, cols = 3) {
  const r = Math.max(2, Math.min(8, Number(rows) || 3));
  const c = Math.max(2, Math.min(8, Number(cols) || 3));
  const header = Array.from({ length: c }, (_, index) => `标题 ${index + 1}`);
  const divider = Array.from({ length: c }, () => '---');
  const body = Array.from({ length: r - 1 }, (_, row) => (
    Array.from({ length: c }, (_, col) => `内容 ${row + 1}-${col + 1}`)
  ));
  return `\n${[header, divider, ...body].map((line) => `| ${line.join(' | ')} |`).join('\n')}\n`;
}

function buildMarkdownCallout(tone = 'sage') {
  const safeTone = ['sage', 'sun', 'rose', 'sky', 'lavender'].includes(tone) ? tone : 'sage';
  return `\n<div class="msc-callout msc-callout--${safeTone}" data-callout-tone="${safeTone}">\n  <span class="msc-callout__emoji">💡</span>\n  <div class="msc-callout__body">\n    <p>在这里输入高亮内容</p>\n  </div>\n</div>\n`;
}

function MarkdownInsertToolbar({ textareaRef, value, onChange }) {
  const insertSnippet = (snippet, options) => {
    onChange(insertTextAtTextarea(textareaRef.current, value, snippet, options));
  };

  return (
    <div className="msc-md-toolbar" aria-label="Markdown 插入工具">
      <div className="msc-md-toolbar__group">
        {[2, 3, 4].map((count) => (
          <button
            key={count}
            type="button"
            className="msc-md-toolbar__btn"
            onClick={() => insertSnippet(buildMarkdownColumns(count))}
            title={`插入 ${count} 栏分栏`}
          >
            <Columns size={14} /> {count} 栏
          </button>
        ))}
      </div>
      <div className="msc-md-toolbar__group">
        <button
          type="button"
          className="msc-md-toolbar__btn"
          onClick={() => insertSnippet(buildMarkdownTable(3, 3))}
          title="插入 3 × 3 表格"
        >
          <TableIcon size={14} /> 表格
        </button>
      </div>
      <div className="msc-md-toolbar__group">
        {[
          { id: 'sage', label: '绿', color: '#dfeee4' },
          { id: 'sun', label: '黄', color: '#fff0bf' },
          { id: 'rose', label: '粉', color: '#ffe1df' },
          { id: 'sky', label: '蓝', color: '#dcecff' },
          { id: 'lavender', label: '紫', color: '#eadfff' },
        ].map((tone) => (
          <button
            key={tone.id}
            type="button"
            className="msc-md-toolbar__btn msc-md-toolbar__btn--swatch"
            onClick={() => insertSnippet(buildMarkdownCallout(tone.id))}
            title={`插入${tone.label}色高亮块`}
          >
            <Highlighter size={14} />
            <span className="msc-md-toolbar__swatch" style={{ background: tone.color }} />
            {tone.label}
          </button>
        ))}
      </div>
    </div>
  );
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

  const MAX_FILES = 10;

  const handleFiles = useCallback(async (files) => {
    const newFiles = [];
    for (const file of files) {
      if (attachments.length + newFiles.length >= MAX_FILES) {
        alert(`最多只能上传 ${MAX_FILES} 个附件`);
        break;
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
            支持任意文件格式，最多 {MAX_FILES} 个附件
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
  const { isAuthenticated, user, getAllUsers } = useAuth();
  const { addNotification } = useNotifications();
  const navigate = useNavigate();
  const location = useLocation();
  const wordEditorRef = useRef(null);
  const pasteAsPlainTextRef = useRef(false);
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
        if (Array.isArray(list)) setCats(getVisibleCategories(list));
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

  /* ============ 贡献者多选 ============
     和流程模板文件一致：支持「分享迁移」——发布者本人不一定是贡献者，可多选。
     新建时默认选中当前用户本人；编辑时载入已有 contributorIds（缺省回退 [authorId]）。 */
  const [contributorIds, setContributorIds] = useState(() => (user?.id ? [user.id] : []));
  // 用户 async 登录完成后若仍为空则补一次（仅新建场景，编辑场景由载入逻辑覆盖）
  useEffect(() => {
    if (!isEditingPost && user?.id && contributorIds.length === 0) {
      setContributorIds([user.id]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  // 贡献者可选列表：走模块级 30s 缓存，和详情页 / 评论区共用同一份 profiles 查询。
  const [allUsers, setAllUsers] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = (await getCachedAllUsers(getAllUsers)) || [];
        if (!cancelled) setAllUsers(list);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [getAllUsers]);

  const userNameMap = useMemo(() => {
    const map = {};
    allUsers.forEach((u) => {
      if (u?.id) map[u.id] = u.name || u.nickname || '';
    });
    return map;
  }, [allUsers]);
  // 编辑模式刷新后需从云端拉取这篇内容，期间显示"加载中"避免空屏让人以为内容丢了
  const [editLoading, setEditLoading] = useState(isEditingPost);

  // 云端自动保存：savedIdRef 记录云端记录 id（首次自动/手动保存后填上，避免重复插入）；
  // cloudSaveState 用于顶栏展示"保存中…/已保存到云端/保存失败"。
  const savedIdRef = useRef(null);
  const [cloudSaveState, setCloudSaveState] = useState(null); // 'saving' | 'saved' | 'error' | null
  const [lastCloudSaveAt, setLastCloudSaveAt] = useState(null);
  const autosaveTimerRef = useRef(null);

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
        // 编辑权限：仅该篇发布者 / 任一贡献者本人。
        const editContributorIds = Array.isArray(post.contributorIds) && post.contributorIds.length > 0
          ? post.contributorIds
          : post.authorId ? [post.authorId] : [];
        const canEdit = (post.authorId && String(post.authorId) === String(user?.id))
          || editContributorIds.map(String).includes(String(user?.id));
        if (!canEdit) {
          alert('你没有权限编辑这篇分享');
          navigate('/internal/member-sharing', { replace: true });
          return;
        }
        setEditingSource(post);
        setContributorIds(editContributorIds);
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
      })
      .finally(() => {
        if (!cancelled) setEditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editId, isAuthenticated, navigate, user?.id]);

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
    return cleanPastedWordHtml(html, { preserveTextAlign: true });
  }, []);

  // 处理 Word 编辑器的粘贴事件
  const handleWordPaste = useCallback((e) => {
    // 若剪贴板里有图片，交给 wordImageEditor（capture 阶段已处理），此处不再执行
    const items = e.clipboardData?.items;
    const html = e.clipboardData.getData('text/html');
    if (!html && items && Array.from(items).some((it) => it.kind === 'file' && it.type.startsWith('image/'))) {
      return;
    }
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    const shouldMatchStyle = pasteAsPlainTextRef.current || e.shiftKey;
    pasteAsPlainTextRef.current = false;

    if (html && !shouldMatchStyle) {
      const cleaned = cleanWordHtml(html);
      if (!insertHtmlReplacingEmptyParagraph(wordEditorRef.current, cleaned)) {
        document.execCommand('insertHTML', false, cleaned);
      }
    } else if (text) {
      insertPlainTextMatchingEditorStyle(wordEditorRef.current, text);
    }

    if (wordEditorRef.current) {
      setNewPost((prev) => ({ ...prev, content: wordEditorRef.current.innerHTML }));
    }
  }, [cleanWordHtml]);

  const handleWordBeforeInput = useCallback((e) => {
    if (e.nativeEvent?.inputType === 'insertFromPasteAsPlainText') {
      pasteAsPlainTextRef.current = true;
    }
  }, []);

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
          const paragraphs = plainTextToEditorHtml(text);
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
          const paragraphs = plainTextToEditorHtml(text);
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
    return markdownToHtml(newPost.content);
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
    const detachPasteMatch = attachPasteAndMatchStyleHandler(editor, { onChange: syncHtml });

    return () => {
      detachPasteMatch();
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

  // 自动云端保存：内容变化后防抖 2.5s 保存（标题与正文/附件齐全才会真正写云端）。
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      saveToCloud({ silent: true });
    }, 2500);
    return () => { if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newPost, isAuthenticated]);

  // Ctrl/Cmd+S：保存到当前云端，并阻止浏览器"保存网页到本地"对话框。
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (!isAuthenticated) return;
        saveToCloud({ silent: false });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newPost, isAuthenticated]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  // 构建要保存的 post 对象；标题缺失或正文/附件都为空时返回 null（用于自动保存时静默跳过）
  const buildPost = () => {
    const currentContent = newPost.format === 'word' && wordEditorRef.current
      ? wordEditorRef.current.innerHTML
      : newPost.content;
    const normalizedContent = stripUnderline(currentContent || '');
    const hasContent = normalizedContent.trim().length > 0;
    const hasAttachments = newPost.attachments.length > 0;
    if (!newPost.title.trim() || (!hasContent && !hasAttachments)) return null;

    // 构建时间段字符串：history=单点；experience=区间；其它分类不带 period
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

    const attachments = newPost.attachments.map((f) => ({
      id: f.id, name: f.name, size: f.size, type: f.type, dataUrl: f.dataUrl,
    }));

    // 贡献者：主贡献者 = contributorIds[0]（默认当前用户）。
    // author/authorId 跟随主贡献者，保持「作者」展示与权限判断一致；
    // contributorIds 完整保存，详情页会展示全部贡献者。
    const finalContributorIds = contributorIds.length > 0
      ? contributorIds
      : user?.id ? [user.id] : [];
    const primaryId = finalContributorIds[0] || editingSource?.authorId || user?.id || null;
    const primaryName = (primaryId && userNameMap[primaryId])
      || (primaryId && primaryId === user?.id ? (user?.name || user?.nickname) : null)
      || editingSource?.author
      || user?.name || user?.nickname || 'Unknown';

    return {
      id: savedIdRef.current || editingSource?.id || `sharing-${Date.now()}`,
      title: newPost.title.trim(),
      summary: newPost.summary.trim(),
      category: newPost.category,
      format: newPost.format,
      content: normalizedContent,
      period: periodStr || null,
      attachments: attachments.length > 0 ? attachments : null,
      author: primaryName,
      authorId: primaryId,
      contributorIds: finalContributorIds,
      createdAt: editingSource?.createdAt || new Date().toISOString().split('T')[0],
      likes: editingSource?.likes || [],
    };
  };

  // 保存到云端但不跳转（供自动保存 + Ctrl+S 复用）。
  // 首次保存用 addSharing 建记录并记下 id，之后用 updateSharing 更新，避免重复插入。
  const saveToCloud = ({ silent = true } = {}) => {
    const post = buildPost();
    if (!post) {
      if (!silent) alert('请先填写标题，并提供正文内容或上传至少一个附件');
      return false;
    }
    const fields = {
      title: post.title, summary: post.summary, category: post.category,
      format: post.format, content: post.content, period: post.period, attachments: post.attachments,
      author: post.author, authorId: post.authorId, contributorIds: post.contributorIds,
    };
    const onOk = () => { setCloudSaveState('saved'); setLastCloudSaveAt(new Date()); };
    const onErr = (err) => { console.warn('[MemberSharingCreate] 云端保存失败:', err?.message || err); setCloudSaveState('error'); };
    setCloudSaveState('saving');
    const existingId = isEditingPost ? post.id : savedIdRef.current;
    if (existingId) {
      updateSharing(existingId, fields).then(onOk).catch(onErr);
    } else {
      savedIdRef.current = post.id; // 先记下，避免快速连续保存重复插入
      addSharing(post).then(onOk).catch(onErr);
    }
    return true;
  };

  const handleCreate = async (e) => {
    e?.preventDefault?.();
    if (isPublishing) return;
    const post = buildPost();
    if (!post) {
      alert('请填写标题，并提供正文内容或上传至少一个附件');
      return;
    }
    setIsPublishing(true);
    try {
      const existingId = isEditingPost ? post.id : savedIdRef.current;
      if (existingId) {
        // 编辑，或自动保存已创建过云端记录 → 走更新，避免重复插入。
        updateSharing(existingId, {
          title: post.title, summary: post.summary, category: post.category,
          format: post.format, content: post.content, period: post.period, attachments: post.attachments,
          author: post.author, authorId: post.authorId, contributorIds: post.contributorIds,
        }).catch((err) => console.warn('[MemberSharingCreate] 云端更新失败（已写本地）:', err?.message || err));
      } else {
        addSharing(post).catch((err) => console.warn('[MemberSharingCreate] 云端发布失败（已写本地）:', err?.message || err));
        savedIdRef.current = post.id;
        try {
          const categoryLabel = cats.find((c) => c.key === post.category)?.label || '';
          emitNotificationEvent('sharing.new', {
            operator: post.author, operatorUserId: user?.id, title: post.title, categoryLabel,
          });
        } catch (err) {
          console.warn('[MemberSharingCreate] 发送通知失败:', err?.message || err);
        }
      }
      navigate('/internal/member-sharing');
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="msc-page">
      {/* 编辑模式刷新后，云端内容拉取期间显示加载遮罩，避免空屏被误以为内容丢失 */}
      {editLoading && (
        <div className="msc-loading-overlay">
          <Loader2 size={30} className="msc-loading-overlay__spinner" />
          <p className="msc-loading-overlay__text">正在加载分享内容…</p>
          <p className="msc-loading-overlay__hint">首次打开或弱网时会稍慢，请稍候</p>
        </div>
      )}
      {/* 顶部导航栏 */}
      <div className="msc-topbar">
        <button className="msc-topbar__back" onClick={() => navigate('/internal/member-sharing')}>
          <ChevronLeft size={20} /> 返回列表
        </button>
        <div className="msc-topbar__actions">
          {cloudSaveState && (
            <span className={`msc-topbar__save-state msc-topbar__save-state--${cloudSaveState}`}>
              {cloudSaveState === 'saving' && '保存中…'}
              {cloudSaveState === 'saved' && '已保存到云端'}
              {cloudSaveState === 'error' && '云端保存失败，请稍后重试'}
            </span>
          )}
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

            {/* 贡献者（可多选）——支持分享迁移场景：发布者 ≠ 贡献者 */}
            <div className="msc-form__field">
              <label>
                贡献者
                <span className="msc-form__hint">可多选，默认为本人</span>
              </label>
              <CustomSelect
                multiple
                searchable
                searchPlaceholder="搜索成员（支持中文/拼音/首字母）"
                value={contributorIds}
                onChange={(vals) => setContributorIds(vals)}
                placeholder="请选择贡献者"
                options={(() => {
                  // 候选项 = 所有注册成员 ∪ 当前用户本人（兜底）。不按 authorized 过滤，
                  // 与流程模板文件保持一致（登录权限由 UserManagement 负责，两者解耦）。
                  const seen = new Set();
                  const opts = [];
                  const pushUser = (u) => {
                    if (!u?.id || seen.has(u.id)) return;
                    seen.add(u.id);
                    opts.push({
                      value: u.id,
                      label: u.name || u.nickname || u.email || u.id,
                    });
                  };
                  if (user) pushUser(user);
                  allUsers.forEach(pushUser);
                  return opts;
                })()}
              />
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
                  <Calendar size={14} /> {newPost.category === 'history' ? '会议时间' : '经验时间段'}
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
                        const MAX_FILES = 10;
                        const newFiles = [];
                        for (const file of files) {
                          if (newPost.attachments.length + newFiles.length >= MAX_FILES) {
                            alert(`最多只能上传 ${MAX_FILES} 个附件`);
                            break;
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
                <>
                <div className="msc-md-split">
                  <div className="msc-md-split__pane">
                    <div className="msc-md-split__label">
                      <Code2 size={14} /> 编辑
                      <SyncScrollToggle on={syncScroll} onToggle={toggleSyncScroll} />
                    </div>
                    <MarkdownInsertToolbar
                      textareaRef={mdEditorRef}
                      value={newPost.content}
                      onChange={(nextValue) => setNewPost((prev) => ({ ...prev, content: nextValue }))}
                    />
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
                {/* Markdown 目录：放在分栏网格外。默认折叠成小按钮，
                    避免浮动面板盖住右侧"预览"栏的标题与分割线（需要时点开）。 */}
                <EditorToc editorRef={mdPreviewRef} content={markdownPreview} defaultOpen={false} />
                </>
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
                    onKeyDown={handleEditorKeyDown}
                    onBeforeInput={handleWordBeforeInput}
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
                  <EditorToc editorRef={wordEditorRef} content={newPost.content} />
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
