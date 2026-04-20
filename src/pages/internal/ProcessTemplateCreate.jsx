import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { marked } from 'marked';
import {
  FolderOpen,
  Plus,
  ChevronLeft,
  Code2,
  FileText,
  Eye,
  Upload,
  Paperclip,
  X,
  File,
  Image,
  FileSpreadsheet,
  FileArchive,
  Clock,
  Check,
  RotateCcw,
} from 'lucide-react';
import CustomSelect from '../../components/CustomSelect';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { createDoc, canUseSupabase } from '../../lib/documentsService';
import { attachWordImageEditor } from '../../utils/wordImageEditor';
import {
  attachTableControls,
  attachColumnPlaceholderHandler,
} from '../../utils/wordDocBlocks';
import FloatingTextToolbar from '../../components/FloatingTextToolbar';
import WordEditorToolbar from '../../components/WordEditorToolbar';
import SyncScrollToggle from '../../components/SyncScrollToggle';
import useMarkdownSyncScroll from '../../hooks/useMarkdownSyncScroll';
import { stripUnderline } from '../../utils/stripUnderline';
import useDraftAutosave from '../../hooks/useDraftAutosave';
import './MemberSharingCreate.css';
import './DraftAutosave.css';

const DEFAULT_TYPE_LABELS = {
  process: '流程手册及模版文件',
  regulation: '规章制度',
  course: '课程及考试资料',
  history: '历史会议',
  experience: '成员经验分享',
};

/* ====== 工具函数 ====== */
function getFileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
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

function inferFileType(fileName) {
  if (!fileName) return 'pdf';
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'xlsx';
  if (['pptx', 'ppt'].includes(ext)) return 'pptx';
  if (['docx', 'doc'].includes(ext)) return 'docx';
  return 'pdf';
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 注：真正的发布持久化（本地 + 云端）已由 documentsService.createDoc 统一处理。

/* ====== 主组件 ====== */
export default function ProcessTemplateCreate() {
  const { isAuthenticated, user, getAllUsers } = useAuth();
  const navigate = useNavigate();
  const wordEditorRef = useRef(null);
  const mdEditorRef = useRef(null);
  const mdPreviewRef = useRef(null);

  /* ============ Markdown 同步滚动 ============
   * 使用公共 hook 管理，默认关闭。和其他 Markdown 编辑入口
   * （MemberSharingCreate / ProcessTemplateDetail 编辑态）保持一致。
   * mdEditorRef 仍保留，供 FloatingTextToolbar 定位浮动工具条。 */
  const {
    syncScroll,
    toggleSyncScroll,
    editorRef: syncEditorRef,
    previewRef: syncPreviewRef,
    handleEditorScroll,
    handlePreviewScroll,
  } = useMarkdownSyncScroll(false);

  const { filterOptions, internalConfig } = useSiteContent();

  // 动态类型（从 siteContent 中读取，兼容管理员自定义）+ 默认的流程/规章类型
  const docTypes = filterOptions.documentTypes || [];
  const typeLabelsMap = useMemo(() => {
    const labels = { ...DEFAULT_TYPE_LABELS };
    docTypes.forEach((t) => { labels[t.key] = t.label; });
    return labels;
  }, [docTypes]);

  // 流程模板发布页的类型下拉，必须与 ProcessTemplates 列表页的 tab 一致：
  //   白名单内置 ['process', 'regulation']（可能被隐藏的除外）
  //   + 用户在列表页编辑模式下新增的 extraTypeKeys（custom_*）
  // 读取来源：internalConfig.processTemplates.extraTypeKeys / hiddenBuiltinKeys
  const typeOptions = useMemo(() => {
    const pt = internalConfig?.processTemplates || {};
    const extraKeys = Array.isArray(pt.extraTypeKeys) ? pt.extraTypeKeys : [];
    const hiddenBuiltin = Array.isArray(pt.hiddenBuiltinKeys) ? pt.hiddenBuiltinKeys : [];
    const builtin = ['process', 'regulation'].filter((k) => !hiddenBuiltin.includes(k));
    // extraKeys 必须仍然存在于全局文档类型池中
    const extras = extraKeys.filter((k) => docTypes.some((t) => t.key === k));
    return [...builtin, ...extras].map((key) => ({
      value: key,
      label: typeLabelsMap[key] || key,
    }));
  }, [internalConfig, docTypes, typeLabelsMap]);

  const [newDoc, setNewDoc] = useState({
    title: '',
    type: 'process',
    description: '',
    format: 'word',
    content: '',
    attachments: [],
  });

  /* ============ 贡献者多选 ============
     支持"文档迁移"——发布者本人不一定是贡献者，可多选。
     默认选中当前用户本人。 */
  const [contributorIds, setContributorIds] = useState(() => (user?.id ? [user.id] : []));
  // 用户 async 登录完成后若仍为空则补一次
  useEffect(() => {
    if (user?.id && contributorIds.length === 0) {
      setContributorIds([user.id]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  const [allUsers, setAllUsers] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = (await getAllUsers?.()) || [];
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

  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const dragCounterRef = useRef(0);

  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  const MAX_FILES = 10;

  /* ============ 草稿自动保存 ============ */
  const draftKey = user?.id ? `process-template-create:${user.id}` : 'process-template-create:guest';
  const draft = useDraftAutosave({
    key: draftKey,
    values: newDoc,
    enabled: isAuthenticated,
    delay: 1500,
    isEmpty: (v) =>
      !v ||
      ((v.title || '').trim() === '' &&
        (v.description || '').trim() === '' &&
        (v.content || '').trim() === '' &&
        (!v.attachments || v.attachments.length === 0)),
  });

  // 是否展示恢复草稿 banner（初次进入页面时检测）
  const [showDraftPrompt, setShowDraftPrompt] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    const existing = draft.loadDraft();
    if (existing && existing.values) {
      const v = existing.values;
      const nonEmpty =
        (v.title || '').trim() ||
        (v.description || '').trim() ||
        (v.content || '').trim() ||
        (v.attachments && v.attachments.length > 0);
      if (nonEmpty) {
        setShowDraftPrompt(true);
        setDraftSavedAt(existing.savedAt);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const handleRestoreDraft = useCallback(() => {
    const existing = draft.loadDraft();
    if (existing && existing.values) {
      setNewDoc((prev) => ({ ...prev, ...existing.values }));
    }
    setShowDraftPrompt(false);
  }, [draft]);

  const handleDiscardDraft = useCallback(() => {
    draft.clearDraft();
    setShowDraftPrompt(false);
  }, [draft]);

  /* ============ 附件处理 ============ */
  const handleFiles = useCallback(async (files) => {
    const newFiles = [];
    for (const file of files) {
      if (newDoc.attachments.length + newFiles.length >= MAX_FILES) {
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
      } catch { /* 读取失败，跳过 */ }
    }
    if (newFiles.length > 0) {
      setNewDoc((prev) => ({
        ...prev,
        attachments: [...prev.attachments, ...newFiles],
        // 如果还没标题且是第一次上传附件，用第一个文件名填充
        title: prev.title || newFiles[0].name.replace(/\.[^.]+$/, ''),
      }));
    }
  }, [newDoc.attachments.length]);

  const handleInputChange = useCallback((e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) handleFiles(files);
    e.target.value = '';
  }, [handleFiles]);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    dragCounterRef.current = 0;
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleFiles(files);
  }, [handleFiles]);

  const removeAttachment = useCallback((id) => {
    setNewDoc((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((f) => f.id !== id),
    }));
  }, []);

  /* ============ Word 粘贴清洗（与 MemberSharingCreate 保持一致） ============ */
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
        // 本地 file:// 路径跨进程失效，直接丢弃
        img.remove();
        return;
      }
      if (!img.classList.contains('msc-img')) img.classList.add('msc-img');
      img.setAttribute('draggable', 'false');
      // 若没包在 msc-img-wrap 段落里，则包一个
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

  const handleWordPaste = useCallback((e) => {
    // 若剪贴板里有图片，则让 wordImageEditor（capture 阶段已拦截）处理，不要在这里再执行
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
      setNewDoc((prev) => ({ ...prev, content: wordEditorRef.current.innerHTML }));
    }
  }, [cleanWordHtml]);

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
            setNewDoc((prev) => ({ ...prev, content: cleaned }));
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
            setNewDoc((prev) => ({ ...prev, content: paragraphs }));
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
          setNewDoc((prev) => ({ ...prev, content: paragraphs }));
        }
      } catch { /* 剪贴板权限被拒绝 */ }
    }
  }, [cleanWordHtml]);

  /* ============ Markdown 预览 ============ */
  const markdownPreview = useMemo(() => {
    if (newDoc.format !== 'markdown' || !newDoc.content.trim()) return '';
    marked.setOptions({ breaks: true, gfm: true });
    return marked.parse(newDoc.content);
  }, [newDoc.format, newDoc.content]);

  /* ============ Word 编辑器挂载：图片插入/拖拽/粘贴/拉伸 + 分栏 + 表格 ============ */
  const imageApiRef = useRef(null);
  useEffect(() => {
    if (newDoc.format !== 'word') {
      imageApiRef.current?.destroy?.();
      imageApiRef.current = null;
      return undefined;
    }
    if (!wordEditorRef.current) return undefined;
    const editor = wordEditorRef.current;
    const api = attachWordImageEditor(editor, {
      onChange: (html) => setNewDoc((prev) => ({ ...prev, content: html })),
    });
    imageApiRef.current = api;

    // 表格行列控制条 + 分栏占位点击补图
    const syncHtml = () => {
      setNewDoc((prev) => ({ ...prev, content: editor.innerHTML }));
    };
    const detachTable = attachTableControls(editor, syncHtml);
    const detachCols = attachColumnPlaceholderHandler(editor, syncHtml);

    return () => {
      detachCols();
      detachTable();
      api.destroy();
      imageApiRef.current = null;
    };
  }, [newDoc.format]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  /* ============ 发布 ============ */
  const handleCreate = async (e) => {
    e.preventDefault();
    const hasContent = newDoc.content.trim().length > 0;
    const hasAttachments = newDoc.attachments.length > 0;
    if (!newDoc.title.trim()) {
      alert('请填写文档标题');
      return;
    }
    if (!hasContent && !hasAttachments) {
      alert('请至少填写正文内容或上传至少一个附件');
      return;
    }

    // 主附件（列表页预览/下载时用的第一个附件）
    const primaryAttachment = newDoc.attachments[0] || null;

    const doc = {
      id: `doc-${Date.now()}`,
      title: newDoc.title.trim(),
      type: newDoc.type,
      description: (() => {
        // 把用户粘贴进来的 HTML 实体（&nbsp; / &amp; 等）还原为真实字符，并剥掉残留标签
        const raw = (newDoc.description || '').trim();
        if (!raw) return '';
        try {
          const d = new DOMParser().parseFromString(`<!doctype html><body>${raw}`, 'text/html');
          return (d.body.textContent || '').trim();
        } catch {
          return raw;
        }
      })(),
      format: newDoc.format,
      content: stripUnderline(newDoc.content),
      attachments: newDoc.attachments.map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        type: f.type,
        dataUrl: f.dataUrl,
      })),
      // 兼容 Documents.jsx 原有字段
      fileType: primaryAttachment ? inferFileType(primaryAttachment.name) : 'docx',
      fileUrl: primaryAttachment ? primaryAttachment.dataUrl : null,
      size: primaryAttachment ? formatFileSize(primaryAttachment.size) : '—',
      // 贡献者：主贡献者 = contributorIds[0]（默认是当前用户），
      // uploadedBy/uploadedById 保留为主贡献者，兼容旧字段；
      // contributorIds 新增，列表和预览会完整展示多位贡献者。
      uploadedBy: (() => {
        const list = contributorIds.length > 0 ? contributorIds : user?.id ? [user.id] : [];
        const pid = list[0];
        if (pid && userNameMap[pid]) return userNameMap[pid];
        if (pid && pid === user?.id) return user?.name || user?.nickname || 'Unknown';
        return user?.name || user?.nickname || 'Unknown';
      })(),
      uploadedById:
        (contributorIds.length > 0 ? contributorIds[0] : user?.id) || null,
      contributorIds:
        contributorIds.length > 0 ? contributorIds : user?.id ? [user.id] : [],
      date: new Date().toISOString().split('T')[0],
      viewCount: 0,
      likes: [],
    };

    try {
      // 通过 documentsService 同时写本地 + 云端（Supabase 可用时）
      const result = await createDoc(doc);
      if (canUseSupabase() && !result.remote) {
        // Supabase 配置但写云端失败 —— 给用户一个可感知的警告，
        // 但仍然允许发布（本地已保存），避免阻塞工作流。
        console.warn('[ProcessTemplateCreate] 云端同步失败，其他设备将看不到此文档，请联系管理员检查 Supabase 配置。', result.error);
        alert('已本地保存，但云端同步失败 —— 其他设备可能看不到此文档。请联系管理员检查后台配置。');
      }
    } catch (err) {
      console.error('[ProcessTemplateCreate] 发布失败:', err);
      alert('发布失败：' + (err.message || '未知错误'));
      return;
    }

    // 发布成功 —— 清除草稿
    draft.clearDraft();

    // 返回流程模板列表页（非新窗口跳转时）
    if (window.opener && !window.opener.closed) {
      // 通知父窗口刷新
      try { window.opener.postMessage({ type: 'process-template-created' }, '*'); } catch { /* ignore */ }
      window.close();
      // 防止 close 被浏览器阻止
      setTimeout(() => navigate('/internal/process-templates'), 100);
    } else {
      navigate('/internal/process-templates');
    }
  };

  return (
    <div className="msc-page">
      {/* 顶部导航栏 */}
      <div className="msc-topbar">
        <button className="msc-topbar__back" onClick={() => navigate('/internal/process-templates')}>
          <ChevronLeft size={20} /> 返回列表
        </button>
        <div className="msc-topbar__actions">
          <DraftStatusIndicator saving={draft.saving} lastSavedAt={draft.lastSavedAt} />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              if (window.opener && !window.opener.closed) window.close();
              else navigate('/internal/process-templates');
            }}
          >
            取消
          </button>
          <button type="submit" form="ptc-create-form" className="btn btn-primary">
            <Upload size={16} /> 发布文档
          </button>
        </div>
      </div>

      {/* 全屏编辑区 */}
      <div className="msc-content">
        <div className="msc-content__inner">
          {showDraftPrompt && (
            <DraftRestoreBanner
              savedAt={draftSavedAt}
              onRestore={handleRestoreDraft}
              onDiscard={handleDiscardDraft}
            />
          )}
          <h2 className="msc-content__title"><FolderOpen size={22} /> 发布流程/模版文件</h2>
          <p className="msc-content__desc">支持 Markdown、Word 正文与附件上传，三者可组合使用</p>

          <form id="ptc-create-form" onSubmit={handleCreate} className="msc-form">
            {/* 第一行：标题 + 类型 */}
            <div className="msc-form__row">
              <div className="msc-form__field msc-form__field--grow">
                <label>文档标题</label>
                <input
                  type="text"
                  className="msc-form__input"
                  value={newDoc.title}
                  onChange={(e) => setNewDoc({ ...newDoc, title: e.target.value })}
                  placeholder="请输入文档标题"
                  required
                />
              </div>
              <div className="msc-form__field">
                <label>文档类型</label>
                <CustomSelect
                  value={newDoc.type}
                  onChange={(val) => setNewDoc({ ...newDoc, type: val })}
                  options={typeOptions}
                />
              </div>
            </div>

            {/* 贡献者（可多选）——支持文档迁移场景：发布者 ≠ 贡献者 */}
            <div className="msc-form__field">
              <label>
                贡献者
                <span className="msc-form__hint">可多选，默认为本人；文档迁移时请选择实际贡献者</span>
              </label>
              <CustomSelect
                multiple
                value={contributorIds}
                onChange={(vals) => setContributorIds(vals)}
                placeholder="请选择贡献者"
                options={(() => {
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

            {/* 简介描述 */}
            <div className="msc-form__field">
              <label>
                简介
                <span className="msc-form__hint">选填，简要说明文档用途，会显示在列表卡片上</span>
              </label>
              <input
                type="text"
                className="msc-form__input"
                value={newDoc.description}
                onChange={(e) => setNewDoc({ ...newDoc, description: e.target.value })}
                placeholder="一句话描述文档用途"
                maxLength={120}
              />
            </div>

            {/* 格式切换 + 附件按钮（同一行） */}
            <div className="msc-form__field">
              <label>内容格式</label>
              <div className="msc-form__format-toggle">
                <button
                  type="button"
                  className={`msc-form__format-btn ${newDoc.format === 'word' ? 'msc-form__format-btn--active' : ''}`}
                  onClick={() => setNewDoc({ ...newDoc, format: 'word' })}
                >
                  <FileText size={14} /> Word (HTML)
                </button>
                <button
                  type="button"
                  className={`msc-form__format-btn ${newDoc.format === 'markdown' ? 'msc-form__format-btn--active' : ''}`}
                  onClick={() => setNewDoc({ ...newDoc, format: 'markdown' })}
                >
                  <Code2 size={14} /> Markdown
                </button>

                <div className="msc-form__format-divider" />

                <button
                  type="button"
                  className="msc-form__format-btn msc-form__attach-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip size={14} /> 上传附件
                  {newDoc.attachments.length > 0 && (
                    <span className="msc-form__attach-badge">{newDoc.attachments.length}</span>
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleInputChange}
                />
              </div>
            </div>

            {/* 附件拖拽区 —— 独立一块，比按钮更醒目 */}
            <div className="msc-form__field">
              <label>
                <Upload size={14} /> 附件拖拽上传
                <span className="msc-form__hint">
                  支持任意格式，单文件 ≤ 5MB，最多 {MAX_FILES} 个；首个附件将作为主文件用于列表预览
                </span>
              </label>
              <div
                className={`msc-attach__dropzone ${isDragOver ? 'msc-attach__dropzone--active' : ''}`}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={28} className="msc-attach__dropzone-icon" />
                <div className="msc-attach__dropzone-text">
                  <span className="msc-attach__dropzone-main">
                    拖拽文件到此处，或 <span className="msc-attach__dropzone-link">点击浏览</span>
                  </span>
                  <span className="msc-attach__dropzone-hint">
                    PDF / Word / Excel / PPT / 图片 / 压缩包 均可
                  </span>
                </div>
              </div>

              {/* 已上传附件列表 */}
              {newDoc.attachments.length > 0 && (
                <div className="msc-attach__list" style={{ marginTop: 8 }}>
                  {newDoc.attachments.map((file, idx) => {
                    const IconComp = getFileIcon(file.name);
                    return (
                      <div key={file.id} className="msc-attach__item">
                        <IconComp size={18} className="msc-attach__item-icon" />
                        <div className="msc-attach__item-info">
                          <span className="msc-attach__item-name">
                            {idx === 0 && <strong style={{ color: 'var(--color-primary, #5B8C3E)', marginRight: 6 }}>[主]</strong>}
                            {file.name}
                          </span>
                          <span className="msc-attach__item-size">{formatFileSize(file.size)}</span>
                        </div>
                        <button
                          type="button"
                          className="msc-attach__item-remove"
                          onClick={() => removeAttachment(file.id)}
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

            {/* 正文编辑器 */}
            <div className="msc-form__field msc-form__field--editor">
              <label>
                正文内容
                <span className="msc-form__hint">
                  {newDoc.format === 'markdown'
                    ? '支持 Markdown 语法：# 标题、**加粗**、- 列表、```代码块```'
                    : '支持从 Word/网页一键粘贴，自动保留段落和标题层级'}
                </span>
              </label>
              {newDoc.format === 'markdown' ? (
                <div className="msc-md-split">
                  <div className="msc-md-split__pane">
                    <div className="msc-md-split__label">
                      <Code2 size={14} /> 编辑
                      <SyncScrollToggle on={syncScroll} onToggle={toggleSyncScroll} />
                    </div>
                    <textarea
                      ref={(el) => {
                        // 同时写入两个 ref：
                        //   - mdEditorRef：FloatingTextToolbar 用
                        //   - syncEditorRef：useMarkdownSyncScroll hook 用
                        mdEditorRef.current = el;
                        syncEditorRef.current = el;
                      }}
                      className="msc-md-split__editor"
                      value={newDoc.content}
                      onChange={(e) => setNewDoc({ ...newDoc, content: e.target.value })}
                      onScroll={handleEditorScroll}
                      placeholder={'# 文档标题\n\n## 适用范围\n\n说明文档用途...\n\n## 操作步骤\n\n1. 第一步\n2. 第二步'}
                      rows={16}
                    />
                    <FloatingTextToolbar
                      mode="markdown"
                      editorRef={mdEditorRef}
                      value={newDoc.content}
                      onChange={(nextValue) => setNewDoc((prev) => ({ ...prev, content: nextValue }))}
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
                    onOneClickPaste={handleOneClickPaste}
                    onChange={(html) => setNewDoc((prev) => ({ ...prev, content: html }))}
                  />
                  <div
                    ref={wordEditorRef}
                    className="msc-form__word-editor"
                    contentEditable
                    onPaste={handleWordPaste}
                    onInput={() => {
                      if (wordEditorRef.current) {
                        setNewDoc((prev) => ({ ...prev, content: wordEditorRef.current.innerHTML }));
                      }
                    }}
                    data-placeholder="从 Word / 网页复制内容后，点击上方「一键粘贴」按钮，或直接 Ctrl+V / ⌘+V 粘贴；可以直接拖拽/粘贴图片，图片插入后居中显示，点击图片可以拖动手柄调整大小"
                    suppressContentEditableWarning
                  />
                  <FloatingTextToolbar
                    editorRef={wordEditorRef}
                    onChange={(html) => setNewDoc((prev) => ({ ...prev, content: html }))}
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

/* ================== 草稿相关子组件 ================== */
function formatDraftTime(date) {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  if (sameDay) return `${hh}:${mm}:${ss}`;
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${mo}-${da} ${hh}:${mm}`;
}

export function DraftStatusIndicator({ saving, lastSavedAt }) {
  if (saving) {
    return (
      <span className="draft-status draft-status--saving" title="正在保存草稿">
        <Clock size={14} /> 保存中…
      </span>
    );
  }
  if (lastSavedAt) {
    return (
      <span className="draft-status draft-status--saved" title={`草稿已保存于 ${formatDraftTime(lastSavedAt)}`}>
        <Check size={14} /> 草稿已保存 {formatDraftTime(lastSavedAt)}
      </span>
    );
  }
  return null;
}

export function DraftRestoreBanner({ savedAt, onRestore, onDiscard }) {
  return (
    <div className="draft-banner" role="status">
      <div className="draft-banner__icon">
        <RotateCcw size={18} />
      </div>
      <div className="draft-banner__text">
        <strong>检测到未发布的草稿</strong>
        {savedAt && <span className="draft-banner__time">（保存于 {formatDraftTime(savedAt)}）</span>}
        <p>是否恢复上次编辑的内容？忽略则继续使用当前空白表单。</p>
      </div>
      <div className="draft-banner__actions">
        <button type="button" className="draft-banner__btn draft-banner__btn--primary" onClick={onRestore}>
          恢复草稿
        </button>
        <button type="button" className="draft-banner__btn" onClick={onDiscard}>
          忽略并清除
        </button>
      </div>
    </div>
  );
}
