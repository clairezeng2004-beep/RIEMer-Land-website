import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  FolderOpen,
  Plus,
  ChevronLeft,
  Code2,
  FileText,
  Eye,
  Upload,
  Loader2,
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
import { createDoc } from '../../lib/documentsService';
import { attachWordImageEditor } from '../../utils/wordImageEditor';
import {
  attachTableControls,
  attachColumnPlaceholderHandler,
  attachWordEditingNormalizer,
  attachEditableLinkOpener,
} from '../../utils/wordDocBlocks';
import FloatingTextToolbar from '../../components/FloatingTextToolbar';
import WordEditorToolbar from '../../components/WordEditorToolbar';
import WordBlockHandle from '../../components/WordBlockHandle';
import EditorToc from '../../components/EditorToc';
import { handleEditorKeyDown } from '../../utils/editorTabIndent';
import SyncScrollToggle from '../../components/SyncScrollToggle';
import useMarkdownSyncScroll from '../../hooks/useMarkdownSyncScroll';
import useAutoResizeTextarea from '../../hooks/useAutoResizeTextarea';
import { cleanPastedWordHtml, insertHtmlReplacingEmptyParagraph, plainTextToEditorHtml } from '../../utils/cleanPastedWordHtml';
import { attachPasteAndMatchStyleHandler, insertPlainTextMatchingEditorStyle, isSelectionInImageCaption } from '../../utils/pasteMatchStyle';
import { htmlToMarkdown, markdownToHtml } from '../../utils/markdownWordInterop';
import {
  DEFAULT_DOCUMENT_TYPE_LABELS,
  PROCESS_TEMPLATE_SCOPE,
  PROCESS_TEMPLATE_TYPE_KEYS,
  getScopedDocumentTypeKeys,
} from '../../utils/documentTypeScope';
import useDraftAutosave from '../../hooks/useDraftAutosave';
import { getCachedAllUsers } from '../../lib/userDirectoryCache';
import './MemberSharingCreate.css';
import './DraftAutosave.css';

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

function withPublishTimeout(promise, ms = 15000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error('发布超时，请稍后再试')), ms);
    }),
  ]);
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
  const location = useLocation();
  const wordEditorRef = useRef(null);
  const pasteAsPlainTextRef = useRef(false);
  const mdEditorRef = useRef(null);
  const mdPreviewRef = useRef(null);

  // 浏览器标签页标题：新窗口里更直观地显示当前在编辑什么文档
  useEffect(() => {
    const prev = document.title;
    document.title = '流程模板文件 - 文档编辑';
    return () => { document.title = prev; };
  }, []);

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
  const docTypes = useMemo(
    () => filterOptions.documentTypes || [],
    [filterOptions.documentTypes]
  );
  const typeLabelsMap = useMemo(() => {
    const labels = { ...DEFAULT_DOCUMENT_TYPE_LABELS };
    docTypes.forEach((t) => { labels[t.key] = t.label; });
    return labels;
  }, [docTypes]);

  // 流程模板发布页的类型下拉，必须与 ProcessTemplates 列表页的 tab 一致：
  //   共享白名单内置分类（可能被隐藏的除外）
  //   + 用户在列表页编辑模式下新增的 extraTypeKeys（custom_*）
  // 新增分类也会在 documentTypes.scopes 中记录页面归属，避免两份配置异步加载时漏项。
  const typeOptions = useMemo(() => {
    const pt = internalConfig?.processTemplates || {};
    const extraKeys = Array.isArray(pt.extraTypeKeys) ? pt.extraTypeKeys : [];
    const hiddenBuiltin = Array.isArray(pt.hiddenBuiltinKeys) ? pt.hiddenBuiltinKeys : [];
    const keys = getScopedDocumentTypeKeys({
      builtinKeys: PROCESS_TEMPLATE_TYPE_KEYS,
      documentTypes: docTypes,
      extraTypeKeys: extraKeys,
      hiddenBuiltinKeys: hiddenBuiltin,
      scope: PROCESS_TEMPLATE_SCOPE,
    });
    return keys.map((key) => ({
      value: key,
      label: typeLabelsMap[key] || key,
    }));
  }, [internalConfig, docTypes, typeLabelsMap]);

  const initialFormat = useMemo(() => {
    const requested = new URLSearchParams(location.search).get('format');
    return requested === 'folder' ? 'folder' : 'word';
  }, [location.search]);

  const [newDoc, setNewDoc] = useState({
    title: '',
    type: 'process',
    description: '',
    format: initialFormat,
    content: '',
    attachments: [],
  });
  useEffect(() => {
    if (typeOptions.length === 0) return;
    setNewDoc((current) => (
      typeOptions.some((option) => option.value === current.type)
        ? current
        : { ...current, type: typeOptions[0].value }
    ));
  }, [typeOptions]);
  const [isPublishing, setIsPublishing] = useState(false);
  const isSimpleFolderCreate = newDoc.format === 'folder';

  // Markdown 编辑器：高度随内容自动增长，避免被父容器限制（用户要求"不要限制高度"）
  useAutoResizeTextarea(mdEditorRef, newDoc.content, { minHeight: 360 });

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
  // 贡献者可选列表：走模块级 30s 缓存（getCachedAllUsers），和评论区、
  // 详情页共用同一份 profiles 查询，避免每次打开发布页就触发一次全表拉取。
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

  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const dragCounterRef = useRef(0);

  const MAX_FILES = 10;

  /* ============ 草稿自动保存 ============ */
  const draftKey = user?.id ? `process-template-create:${user.id}` : 'process-template-create:guest';
  const draft = useDraftAutosave({
    key: draftKey,
    values: newDoc,
    enabled: isAuthenticated,
    delay: 500,
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

  const handleFormatChange = useCallback((format) => {
    setNewDoc((prev) => {
      if (prev.format === format) return prev;
      if (format === 'folder') return { ...prev, format, content: '' };
      if (prev.format === 'folder') return { ...prev, format, content: '' };
      if (format === 'markdown') {
        return { ...prev, format, content: htmlToMarkdown(prev.content) };
      }
      return { ...prev, format, content: markdownToHtml(prev.content) };
    });
  }, []);

  /* ============ Word 粘贴清洗（与 MemberSharingCreate 保持一致） ============ */
  const cleanWordHtml = useCallback((html) => {
    return cleanPastedWordHtml(html, { preserveTextAlign: true });
  }, []);

  const handleWordPaste = useCallback((e) => {
    // 若剪贴板里有图片，则让 wordImageEditor（capture 阶段已拦截）处理，不要在这里再执行
    const items = e.clipboardData?.items;
    const html = e.clipboardData.getData('text/html');
    if (!html && items && Array.from(items).some((it) => it.kind === 'file' && it.type.startsWith('image/'))) {
      return;
    }
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    const shouldMatchStyle = pasteAsPlainTextRef.current || e.shiftKey;
    pasteAsPlainTextRef.current = false;
    const shouldPasteAsCaptionText = text && isSelectionInImageCaption(wordEditorRef.current);

    if (shouldPasteAsCaptionText) {
      insertPlainTextMatchingEditorStyle(wordEditorRef.current, text);
    } else if (html && !shouldMatchStyle) {
      const cleaned = cleanWordHtml(html);
      if (!insertHtmlReplacingEmptyParagraph(wordEditorRef.current, cleaned)) {
        document.execCommand('insertHTML', false, cleaned);
      }
    } else if (text) {
      insertPlainTextMatchingEditorStyle(wordEditorRef.current, text);
    }

    if (wordEditorRef.current) {
      setNewDoc((prev) => ({ ...prev, content: wordEditorRef.current.innerHTML }));
    }
  }, [cleanWordHtml]);

  const handleWordBeforeInput = useCallback((e) => {
    if (e.nativeEvent?.inputType === 'insertFromPasteAsPlainText') {
      pasteAsPlainTextRef.current = true;
    }
  }, []);

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
          const paragraphs = plainTextToEditorHtml(text);
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
          const paragraphs = plainTextToEditorHtml(text);
          wordEditorRef.current.innerHTML = paragraphs;
          setNewDoc((prev) => ({ ...prev, content: paragraphs }));
        }
      } catch { /* 剪贴板权限被拒绝 */ }
    }
  }, [cleanWordHtml]);

  /* ============ Markdown 预览 ============ */
  const markdownPreview = useMemo(() => {
    if (newDoc.format !== 'markdown' || !newDoc.content.trim()) return '';
    return markdownToHtml(newDoc.content);
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
    const detachNormalize = attachWordEditingNormalizer(editor, syncHtml);
    const detachPasteMatch = attachPasteAndMatchStyleHandler(editor, { onChange: syncHtml });
    const detachLinks = attachEditableLinkOpener(editor);

    return () => {
      detachLinks();
      detachPasteMatch();
      detachNormalize();
      detachCols();
      detachTable();
      api.destroy();
      imageApiRef.current = null;
    };
  }, [newDoc.format]);

  useEffect(() => {
    if (newDoc.format !== 'word' || !wordEditorRef.current) return;
    if (wordEditorRef.current.innerHTML !== newDoc.content) {
      wordEditorRef.current.innerHTML = newDoc.content || '';
    }
  }, [newDoc.format, newDoc.content]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  /* ============ 发布 ============ */
  const handleCreate = async (e) => {
    e.preventDefault();
    if (isPublishing) return;
    const hasContent = newDoc.content.trim().length > 0;
    const hasAttachments = newDoc.attachments.length > 0;
    if (!newDoc.title.trim()) {
      alert('请填写文档标题');
      return;
    }
    if (newDoc.format !== 'folder' && !hasContent && !hasAttachments) {
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
      content: newDoc.content,
      attachments: newDoc.attachments.map((f) => ({
        id: f.id,
        kind: f.kind,
        name: f.name,
        size: f.size,
        type: f.type,
        dataUrl: f.dataUrl,
        url: f.url,
      })),
      // 兼容 Documents.jsx 原有字段
      fileType: newDoc.format === 'folder' ? 'folder' : primaryAttachment ? inferFileType(primaryAttachment.name) : 'docx',
      fileUrl: primaryAttachment ? (primaryAttachment.dataUrl || primaryAttachment.url || null) : null,
      size: newDoc.format === 'folder'
        ? `${newDoc.attachments.length} 项`
        : primaryAttachment ? formatFileSize(primaryAttachment.size) : '—',
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
      setIsPublishing(true);
      draft.flush();
      await withPublishTimeout(createDoc(doc));
    } catch (err) {
      setIsPublishing(false);
      console.error('[ProcessTemplateCreate] 发布失败:', err);
      alert('云端上传失败，请检查网络后重新发布。草稿已保留。\n\n' + (err.message || '未知错误'));
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
        <button
          className="msc-topbar__back"
          onClick={() => navigate('/internal/process-templates')}
          disabled={isPublishing}
        >
          <ChevronLeft size={20} /> 返回列表
        </button>
        <div className="msc-topbar__actions">
          <DraftStatusIndicator saving={draft.saving} lastSavedAt={draft.lastSavedAt} />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={isPublishing}
            onClick={() => {
              if (window.opener && !window.opener.closed) window.close();
              else navigate('/internal/process-templates');
            }}
          >
            取消
          </button>
          <button type="submit" form="ptc-create-form" className="btn btn-primary" disabled={isPublishing}>
            {isPublishing ? <Loader2 size={16} className="gallery-spin" /> : <Upload size={16} />}
            {isPublishing ? '发布中...' : '发布文档'}
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
          <h2 className="msc-content__title">
            <FolderOpen size={22} /> {newDoc.format === 'folder' ? '新建文件夹' : '发布流程/模版文件'}
          </h2>
          <p className="msc-content__desc">
            {newDoc.format === 'folder'
              ? '填写名称后即可创建，文件夹内容可以之后再添加'
              : '正文格式请选择 Markdown、Word 富文本或文件夹；附件可另行上传'}
          </p>

          <form id="ptc-create-form" onSubmit={handleCreate} className="msc-form">
            {/* 第一行：标题 + 类型 */}
            <div className="msc-form__row">
              <div className="msc-form__field msc-form__field--grow">
                <label>{isSimpleFolderCreate ? '文件夹名称' : '文档标题'}</label>
                <input
                  type="text"
                  className="msc-form__input"
                  value={newDoc.title}
                  onChange={(e) => setNewDoc({ ...newDoc, title: e.target.value })}
                  placeholder={isSimpleFolderCreate ? '请输入文件夹名称' : '请输入文档标题'}
                  required
                />
              </div>
              {!isSimpleFolderCreate && (
                <div className="msc-form__field">
                  <label>文档类型</label>
                  <CustomSelect
                    value={newDoc.type}
                    onChange={(val) => setNewDoc({ ...newDoc, type: val })}
                    options={typeOptions}
                  />
                </div>
              )}
            </div>

            {/* 贡献者（可多选）——支持文档迁移场景：发布者 ≠ 贡献者 */}
            {!isSimpleFolderCreate && (
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
                  // 候选项 = 所有注册成员 ∪ 当前用户本人（兜底）。
                  // 放宽原因：文档迁移场景下，历史贡献者可能还没走完授权流程，
                  // 且 authorized 字段类型漂移（布尔 / 字符串 'true' / 1）会把合法成员
                  // 也挡掉，表现为「搜索范围只能看到自己」。这里不再按 authorized 过滤，
                  // 登录权限控制仍由 UserManagement 负责，两者解耦。
                  // 按注册时间顺序展示，CustomSelect 内部 pinyinMatch 支持
                  // 中文名 / 拼音全拼 / 首字母三种搜索方式。
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
            )}

            {/* 简介描述 */}
            {!isSimpleFolderCreate && (
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
            )}

            {/* 格式切换 + 附件按钮（同一行） */}
            {!isSimpleFolderCreate && (
            <div className="msc-form__field">
              <label>内容格式</label>
              <div className="msc-form__format-toggle">
                <button
                  type="button"
                  className={`msc-form__format-btn ${newDoc.format === 'word' ? 'msc-form__format-btn--active' : ''}`}
                  onClick={() => handleFormatChange('word')}
                >
                  <FileText size={14} /> Word (HTML)
                </button>
                <button
                  type="button"
                  className={`msc-form__format-btn ${newDoc.format === 'markdown' ? 'msc-form__format-btn--active' : ''}`}
                  onClick={() => handleFormatChange('markdown')}
                >
                  <Code2 size={14} /> Markdown
                </button>
                <button
                  type="button"
                  className={`msc-form__format-btn ${newDoc.format === 'folder' ? 'msc-form__format-btn--active' : ''}`}
                  onClick={() => handleFormatChange('folder')}
                >
                  <FolderOpen size={14} /> 文件夹
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
            )}

            {/* 附件拖拽区 —— 独立一块，比按钮更醒目 */}
            {newDoc.format !== 'folder' && (
            <div className="msc-form__field">
              <label>
                <Upload size={14} /> 附件拖拽上传
                <span className="msc-form__hint">
                  支持任意格式，最多 {MAX_FILES} 个；首个附件将作为主文件用于列表预览
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
            )}

            {/* 正文编辑器 */}
            {!isSimpleFolderCreate && (
            <div className="msc-form__field msc-form__field--editor">
              <label>
                正文内容
                <span className="msc-form__hint">
                  {newDoc.format === 'folder'
                    ? '可添加具体文件或在线文档链接'
                    : newDoc.format === 'markdown'
                      ? '支持 Markdown 语法：# 标题、**加粗**、- 列表、```代码块```'
                      : '支持从 Word/网页直接粘贴，自动保留段落和标题层级'}
                </span>
              </label>
              {newDoc.format === 'markdown' ? (
                <>
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
                {/* Markdown 目录：放在分栏网格外，默认折叠成小按钮，
                    避免浮动面板盖住右侧"预览"栏标题与分割线（需要时点开）。 */}
                <EditorToc editorRef={mdPreviewRef} content={markdownPreview} defaultOpen={false} />
                </>
              ) : (
                <div className="msc-form__word-editor-wrapper">
                  <WordEditorToolbar
                    editorRef={wordEditorRef}
                    imageApiRef={imageApiRef}
                    onChange={(html) => setNewDoc((prev) => ({ ...prev, content: html }))}
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
                        setNewDoc((prev) => ({ ...prev, content: wordEditorRef.current.innerHTML }));
                      }
                    }}
                    data-placeholder="从 Word / 网页复制内容后，直接 Ctrl+V / ⌘+V 粘贴；可以直接拖拽/粘贴图片，图片插入后居中显示，点击图片可以拖动手柄调整大小"
                    suppressContentEditableWarning
                  />
                  <FloatingTextToolbar
                    editorRef={wordEditorRef}
                    onChange={(html) => setNewDoc((prev) => ({ ...prev, content: html }))}
                  />
                  <WordBlockHandle
                    editorRef={wordEditorRef}
                    onChange={(html) => setNewDoc((prev) => ({ ...prev, content: html }))}
                  />
                  <EditorToc editorRef={wordEditorRef} content={newDoc.content} />
                </div>
              )}
            </div>
            )}
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
