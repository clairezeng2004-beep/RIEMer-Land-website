import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { marked } from 'marked';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationContext';
import {
  FileText,
  Upload,
  Search,
  Download,
  Trash2,
  Plus,
  File,
  FolderOpen,
  X,
  Eye,
  Image,
  FileSpreadsheet,
  Presentation,
  ChevronLeft,
  UploadCloud,
  Clock,
  User,
  HardDrive,
  BarChart3,
  ThumbsUp,
  CheckCircle2,
  Edit3,
  Paperclip,
  Code2,
} from 'lucide-react';
import { documentsData } from '../../data/siteData';
import CustomSelect from '../../components/CustomSelect';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useWysiwyg } from '../../contexts/WysiwygContext';
import EditableText from '../../components/EditableText';
import { pinyinMatch } from '../../utils/pinyinSearch';
import TextAnnotation from '../../components/TextAnnotation';
import WordPreview from '../../components/WordPreview';
import './Documents.css';

const defaultTypeLabels = {
  course: '课程及考试资料',
  history: '历史会议',
  process: '流程手册及模版文件',
  regulation: '规章制度',
  experience: '成员经验分享',
};

const defaultTypeColors = {
  course: '#5EAD8C',
  history: '#4FBFC4',
  process: '#D4A44C',
  regulation: '#8B5CF6',
  experience: '#EC4899',
};

const fileTypeIcons = {
  pdf: FileText,
  docx: FileText,
  xlsx: FileSpreadsheet,
  pptx: Presentation,
  image: Image,
};

const fileTypeLabels = {
  pdf: 'PDF 文档',
  docx: 'Word 文档',
  xlsx: 'Excel 表格',
  pptx: 'PPT 演示',
  image: '图片',
};

// 从文件名推断类型
function inferFileType(fileName) {
  if (!fileName) return 'pdf';
  const ext = fileName.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'xlsx';
  if (['pptx', 'ppt'].includes(ext)) return 'pptx';
  if (['docx', 'doc'].includes(ext)) return 'docx';
  return 'pdf';
}

// ============ localStorage 持久化 ============
// 用户通过独立发布页上传的文档（内容+附件）
const DOCUMENTS_KEY = 'riemer_documents';

function loadUserDocs() {
  try {
    const stored = localStorage.getItem(DOCUMENTS_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

function saveUserDocs(data) {
  try {
    localStorage.setItem(DOCUMENTS_KEY, JSON.stringify(data));
  } catch (err) {
    console.error('localStorage 保存失败', err);
  }
}

export default function Documents({ filterTypes, customTitle, customDesc, configSection }) {
  const { isAuthenticated, isAdmin, user } = useAuth();
  const { addNotification } = useNotifications();
  const { internalConfig, updateInternalConfig, filterOptions, updateFilterOptions } = useSiteContent();
  const { editing } = useWysiwyg();
  const sectionKey = configSection || 'documents';
  const dc = internalConfig[sectionKey] || internalConfig.documents;

  // 从 filterOptions 获取动态文档类型
  const docTypes = filterOptions.documentTypes || [];
  const typeLabels = useMemo(() => {
    const labels = { ...defaultTypeLabels };
    docTypes.forEach((t) => { labels[t.key] = t.label; });
    return labels;
  }, [docTypes]);
  const typeColors = useMemo(() => {
    const colors = { ...defaultTypeColors };
    docTypes.forEach((t) => { colors[t.key] = t.color; });
    return colors;
  }, [docTypes]);

  const updateDocs = useCallback(
    (key, val) => updateInternalConfig({ [sectionKey]: { [key]: val } }),
    [updateInternalConfig, sectionKey]
  );

  // 编辑模式：添加新筛选项
  const [showAddType, setShowAddType] = useState(false);
  const [newTypeLabel, setNewTypeLabel] = useState('');
  // 编辑模式：重命名筛选项
  const [renamingType, setRenamingType] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  const handleAddType = () => {
    const trimmed = newTypeLabel.trim();
    if (!trimmed) return;
    // 生成唯一 key
    const key = 'custom_' + Date.now();
    // 随机颜色
    const palette = ['#5EAD8C', '#4FBFC4', '#D4A44C', '#8B5CF6', '#EC4899', '#F59E0B', '#3B82F6', '#EF4444', '#10B981', '#6366F1'];
    const color = palette[docTypes.length % palette.length];
    updateFilterOptions({
      documentTypes: [...docTypes, { key, label: trimmed, color }],
    });
    setNewTypeLabel('');
    setShowAddType(false);
  };

  const handleRenameType = (typeKey) => {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    updateFilterOptions({
      documentTypes: docTypes.map((t) =>
        t.key === typeKey ? { ...t, label: trimmed } : t
      ),
    });
    setRenamingType(null);
    setRenameValue('');
  };

  const handleDeleteType = (typeKey) => {
    if (!window.confirm('确定要删除这个筛选分类吗？')) return;
    updateFilterOptions({
      documentTypes: docTypes.filter((t) => t.key !== typeKey),
    });
    if (selectedType === typeKey) setSelectedType('全部');
  };
  const [documents, setDocuments] = useState(() => {
    const userDocs = loadUserDocs();
    const base = filterTypes
      ? [...documentsData, ...userDocs].filter((d) => filterTypes.includes(d.type))
      : [...userDocs, ...documentsData];
    // 用户发布的在前
    return base.sort((a, b) => {
      const aIsUser = String(a.id).startsWith('doc-');
      const bIsUser = String(b.id).startsWith('doc-');
      if (aIsUser && !bIsUser) return -1;
      if (!aIsUser && bIsUser) return 1;
      return 0;
    });
  });

  // 刷新函数：重新合并 localStorage 里的数据（被新窗口发布时调用）
  const refreshDocs = useCallback(() => {
    const userDocs = loadUserDocs();
    const base = filterTypes
      ? [...documentsData, ...userDocs].filter((d) => filterTypes.includes(d.type))
      : [...userDocs, ...documentsData];
    setDocuments(
      base.sort((a, b) => {
        const aIsUser = String(a.id).startsWith('doc-');
        const bIsUser = String(b.id).startsWith('doc-');
        if (aIsUser && !bIsUser) return -1;
        if (!aIsUser && bIsUser) return 1;
        return 0;
      })
    );
  }, [filterTypes]);

  // 监听独立发布页（新窗口）发来的刷新消息
  useEffect(() => {
    const handler = (event) => {
      if (event?.data?.type === 'process-template-created') {
        refreshDocs();
      }
    };
    window.addEventListener('message', handler);
    // 兜底：窗口 focus 时也刷新一次（用户手动切回来时）
    const onFocus = () => refreshDocs();
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('message', handler);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshDocs]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('全部');
  const [showUpload, setShowUpload] = useState(false);
  const [newDoc, setNewDoc] = useState({ title: '', type: filterTypes ? filterTypes[0] : 'course', description: '' });
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const docContentRef = useRef(null);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const types = filterTypes
    ? ['全部', ...filterTypes.filter((ft) => docTypes.some((t) => t.key === ft) || defaultTypeLabels[ft])]
    : ['全部', ...docTypes.map((t) => t.key)];

  const filtered = documents.filter((doc) => {
    const matchesSearch =
      !searchTerm ||
      pinyinMatch(doc.title, searchTerm) ||
      pinyinMatch(doc.description, searchTerm);
    const matchesType = selectedType === '全部' || doc.type === selectedType;
    return matchesSearch && matchesType;
  });

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (!newDoc.title) {
        setNewDoc((prev) => ({ ...prev, title: file.name.replace(/\.[^.]+$/, '') }));
      }
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (!newDoc.title) {
        setNewDoc((prev) => ({ ...prev, title: file.name.replace(/\.[^.]+$/, '') }));
      }
      if (!showUpload) setShowUpload(true);
    }
  };

  const handleAddDocument = (e) => {
    e.preventDefault();
    if (!newDoc.title) return;

    const fileType = selectedFile ? inferFileType(selectedFile.name) : 'pdf';
    const fileUrl = selectedFile ? URL.createObjectURL(selectedFile) : null;

    const doc = {
      id: Date.now().toString(),
      title: newDoc.title,
      type: newDoc.type,
      fileType,
      fileUrl,
      description: newDoc.description,
      uploadedBy: user?.nickname || user?.name || 'Unknown',
      uploadedById: user?.id || null,
      date: new Date().toISOString().split('T')[0],
      size: selectedFile ? formatSize(selectedFile.size) : '—',
      viewCount: 0,
      _file: selectedFile,
    };
    setDocuments([doc, ...documents]);
    // 自动发送已读通知到通知中心
    addNotification({
      title: '新内部分享',
      message: `${doc.uploadedBy} 上传了文档「${doc.title}」（${typeLabels[doc.type]}）`,
      type: 'sharing',
      read: true, // 自动已读，不打扰成员
    });
    setNewDoc({ title: '', type: 'course', description: '' });
    setSelectedFile(null);
    setShowUpload(false);
  };

  const handleDelete = (id) => {
    if (window.confirm('确定要删除这个文档吗？')) {
      setDocuments(documents.filter((d) => d.id !== id));
      // 同步从 localStorage 移除（若是用户发布的文档）
      if (String(id).startsWith('doc-')) {
        const userDocs = loadUserDocs().filter((d) => d.id !== id);
        saveUserDocs(userDocs);
      }
    }
  };

  // 权限判断：管理员或上传者可删除/修改
  const canModify = (doc) => {
    if (isAdmin) return true;
    if (doc.uploadedById && doc.uploadedById === user?.id) return true;
    // 兼容旧数据：对比上传者名称
    if (doc.uploadedBy && doc.uploadedBy === user?.name) return true;
    return false;
  };

  // 点赞/取消点赞
  const handleLike = (docId, e) => {
    if (e) e.stopPropagation();
    if (!user) return;
    const likeData = {
      userId: user.id,
      userName: user.nickname || user.name || user.email,
      userAvatar: user.avatar || null,
    };
    setDocuments((prev) =>
      prev.map((d) => {
        if (d.id !== docId) return d;
        const likes = d.likes || [];
        const alreadyLiked = likes.some((l) => l.userId === user.id);
        return {
          ...d,
          likes: alreadyLiked
            ? likes.filter((l) => l.userId !== user.id)
            : [...likes, likeData],
        };
      })
    );
    // 同步更新 previewDoc
    if (previewDoc && previewDoc.id === docId) {
      setPreviewDoc((prev) => {
        if (!prev) return prev;
        const likes = prev.likes || [];
        const alreadyLiked = likes.some((l) => l.userId === user.id);
        return {
          ...prev,
          likes: alreadyLiked
            ? likes.filter((l) => l.userId !== user.id)
            : [...likes, likeData],
        };
      });
    }
  };

  // 检查当前用户是否已点赞
  const hasLiked = (doc) => {
    if (!user || !doc.likes) return false;
    return doc.likes.some((l) => l.userId === user.id);
  };

  const openPreview = (doc) => {
    // 增加浏览次数
    setDocuments((prev) =>
      prev.map((d) => (d.id === doc.id ? { ...d, viewCount: (d.viewCount || 0) + 1 } : d))
    );
    setPreviewDoc(doc);
  };

  const closePreview = () => {
    setPreviewDoc(null);
  };

  const canPreview = (doc) => {
    // 1) 外链文件（PDF/图片/Word）可在线预览
    if (doc.fileUrl && ['pdf', 'image', 'docx'].includes(doc.fileType)) return true;
    // 2) 以文本形式输入的文档（Word/HTML 或 Markdown）同样可在线预览
    if (doc.content && String(doc.content).trim().length > 0) return true;
    return false;
  };

  // 文本形式（content）的渲染：根据 format 决定 Markdown 解析还是原样 HTML
  const renderedTextContent = useMemo(() => {
    if (!previewDoc || !previewDoc.content) return '';
    if (previewDoc.format === 'markdown') {
      marked.setOptions({ breaks: true, gfm: true });
      return marked.parse(previewDoc.content);
    }
    // word 格式本身就是 HTML，原样返回
    return previewDoc.content;
  }, [previewDoc]);

  const FileIcon = ({ fileType, size = 24 }) => {
    const Icon = fileTypeIcons[fileType] || FileText;
    return <Icon size={size} />;
  };

  return (
    <div className="documents-page">
      <div className="container">
        <div className="documents-page__header">
          <div>
            <h1>
              <FolderOpen size={28} /> <EditableText
                value={customTitle || dc.pageTitle}
                onChange={(v) => updateDocs('pageTitle', v)}
                configKey={`${sectionKey}.pageTitle`}
                as="span"
              />
            </h1>
            <p><EditableText
              value={customDesc || dc.pageDesc}
              onChange={(v) => updateDocs('pageDesc', v)}
              configKey={`${sectionKey}.pageDesc`}
              as="span"
            /></p>
          </div>
          {configSection === 'processTemplates' ? (
            // 流程模板：新窗口打开独立发布页（支持 Markdown/Word/附件）
            <a
              href="/internal/process-templates/create"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary"
            >
              <Plus size={18} />
              <EditableText
                value={dc.uploadBtn}
                onChange={(v) => updateDocs('uploadBtn', v)}
                configKey="documents.uploadBtn"
                as="span"
              />
            </a>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => setShowUpload(!showUpload)}
            >
              {showUpload ? <X size={18} /> : <Plus size={18} />}
              {showUpload ? '取消' : <EditableText
                value={dc.uploadBtn}
                onChange={(v) => updateDocs('uploadBtn', v)}
                configKey="documents.uploadBtn"
                as="span"
              />}
            </button>
          )}
        </div>

        {/* Upload Form — 仅在行内上传模式下显示 */}
        {showUpload && configSection !== 'processTemplates' && (
          <div className="documents-upload card">
            <h3>
              <Upload size={18} /> 上传新文档
            </h3>
            <form onSubmit={handleAddDocument} className="documents-upload__form">
              {/* 拖拽上传区域 */}
              <div
                className={`documents-upload__dropzone ${isDragOver ? 'documents-upload__dropzone--active' : ''} ${selectedFile ? 'documents-upload__dropzone--has-file' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileSelect}
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp"
                  style={{ display: 'none' }}
                />
                {selectedFile ? (
                  <div className="documents-upload__file-info">
                    <FileIcon fileType={inferFileType(selectedFile.name)} size={32} />
                    <div>
                      <p className="documents-upload__file-name">{selectedFile.name}</p>
                      <p className="documents-upload__file-size">{formatSize(selectedFile.size)}</p>
                    </div>
                    <button
                      type="button"
                      className="documents-upload__file-remove"
                      onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="documents-upload__dropzone-content">
                    <UploadCloud size={36} />
                    <p>拖拽文件到此处，或点击选择文件</p>
                    <span>支持 PDF、Word、Excel、PPT、图片等格式</span>
                  </div>
                )}
              </div>

              <div className="documents-upload__row">
                <div className="documents-upload__field">
                  <label>文档标题</label>
                  <input
                    type="text"
                    value={newDoc.title}
                    onChange={(e) => setNewDoc({ ...newDoc, title: e.target.value })}
                    placeholder="请输入文档标题"
                    className="documents-upload__input"
                    required
                  />
                </div>
                <div className="documents-upload__field">
                  <label>文档类型</label>
                  <CustomSelect
                    value={newDoc.type}
                    onChange={(val) => setNewDoc({ ...newDoc, type: val })}
                    options={Object.entries(typeLabels)
                      .filter(([key]) => !filterTypes || filterTypes.includes(key))
                      .map(([key, label]) => ({
                        value: key,
                        label,
                      }))}
                  />
                </div>
              </div>
              <div className="documents-upload__field">
                <label>描述</label>
                <textarea
                  value={newDoc.description}
                  onChange={(e) => setNewDoc({ ...newDoc, description: e.target.value })}
                  placeholder="简要描述文档内容"
                  className="documents-upload__input documents-upload__textarea"
                  rows={3}
                />
              </div>
              <button type="submit" className="btn btn-primary">
                <Upload size={16} /> 确认上传
              </button>
            </form>
          </div>
        )}

        {/* Filters */}
        <div className="documents-filters">
          <div className="documents-filters__search">
            <Search size={18} className="documents-filters__icon" />
            <input
              type="text"
              placeholder="搜索文档..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="documents-filters__input"
            />
          </div>
          <div className="documents-filters__types">
            {types.map((type) => (
              <div key={type} className="documents-filters__type-wrapper">
                {editing && renamingType === type && type !== '全部' ? (
                  <div className="documents-filters__rename">
                    <input
                      type="text"
                      className="documents-filters__rename-input"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameType(type);
                        if (e.key === 'Escape') { setRenamingType(null); setRenameValue(''); }
                      }}
                      autoFocus
                    />
                    <button
                      className="documents-filters__rename-confirm"
                      onClick={() => handleRenameType(type)}
                      disabled={!renameValue.trim()}
                      title="确认"
                    >
                      <CheckCircle2 size={14} />
                    </button>
                    <button
                      className="documents-filters__rename-cancel"
                      onClick={() => { setRenamingType(null); setRenameValue(''); }}
                      title="取消"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    className={`documents-filters__type ${
                      selectedType === type ? 'documents-filters__type--active' : ''
                    }`}
                    onClick={() => setSelectedType(type)}
                  >
                    {type === '全部' ? '全部' : typeLabels[type] || type}
                  </button>
                )}
                {editing && type !== '全部' && renamingType !== type && (
                  <div className="documents-filters__type-actions">
                    <button
                      className="documents-filters__type-edit"
                      onClick={(e) => { e.stopPropagation(); setRenamingType(type); setRenameValue(typeLabels[type] || type); }}
                      title="重命名"
                    >
                      <Edit3 size={12} />
                    </button>
                    <button
                      className="documents-filters__type-delete"
                      onClick={(e) => { e.stopPropagation(); handleDeleteType(type); }}
                      title="删除分类"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {editing && (
              showAddType ? (
                <div className="documents-filters__add-type">
                  <input
                    type="text"
                    className="documents-filters__add-input"
                    placeholder="新分类名称"
                    value={newTypeLabel}
                    onChange={(e) => setNewTypeLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddType();
                      if (e.key === 'Escape') { setShowAddType(false); setNewTypeLabel(''); }
                    }}
                    autoFocus
                  />
                  <button
                    className="documents-filters__add-confirm"
                    onClick={handleAddType}
                    disabled={!newTypeLabel.trim()}
                    title="确认添加"
                  >
                    <CheckCircle2 size={14} />
                  </button>
                  <button
                    className="documents-filters__add-cancel"
                    onClick={() => { setShowAddType(false); setNewTypeLabel(''); }}
                    title="取消"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  className="documents-filters__type documents-filters__type--add"
                  onClick={() => setShowAddType(true)}
                  title="添加新分类"
                >
                  <Plus size={14} /> 添加分类
                </button>
              )
            )}
          </div>
        </div>

        {/* Documents Grid */}
        <div className="documents-grid">
          {filtered.map((doc) => (
            <div
              key={doc.id}
              className="doc-card card"
              onClick={() => openPreview(doc)}
            >
              {/* 顶部色条 */}
              <div
                className="doc-card__accent"
                style={{ background: typeColors[doc.type] }}
              />

              {/* 信息区 */}
              <div className="doc-card__body">
                <div className="doc-card__top">
                  <span
                    className="doc-card__type-badge"
                    style={{ color: typeColors[doc.type], background: `${typeColors[doc.type]}15` }}
                  >
                    {typeLabels[doc.type]}
                  </span>
                </div>

                <h4 className="doc-card__title">{doc.title}</h4>
                <p className="doc-card__desc">{doc.description}</p>

                <div className="doc-card__footer">
                  <span className="doc-card__author">
                    <User size={12} /> 贡献者：{doc.uploadedBy}
                  </span>
                  <span className="doc-card__stats">
                    <Eye size={12} /> {doc.viewCount || 0}
                  </span>
                </div>

                <div className="doc-card__meta">
                  <span className="doc-card__meta-item">
                    <Clock size={14} />
                    {doc.date}
                  </span>
                </div>
              </div>

              {/* 底部操作区：点赞 + 操作按钮 */}
              <div className="doc-card__bottom" onClick={(e) => e.stopPropagation()}>
                <div className="doc-card__bottom-left">
                  <button
                    className={`doc-card__like-btn ${hasLiked(doc) ? 'doc-card__like-btn--active' : ''}`}
                    onClick={(e) => handleLike(doc.id, e)}
                    title={hasLiked(doc) ? '取消点赞' : '点赞'}
                  >
                    <ThumbsUp size={14} />
                    <span>{(doc.likes || []).length}</span>
                  </button>
                  {(doc.likes || []).length > 0 && (
                    <div className="doc-card__like-names">
                      {(doc.likes || []).map((like, idx) => (
                        <span key={like.userId} className="doc-card__like-name">
                          {like.userName}{idx < (doc.likes || []).length - 1 ? '、' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="doc-card__bottom-right">
                  <button
                    className="doc-card__action-icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (doc.fileUrl) {
                        const a = document.createElement('a');
                        a.href = doc.fileUrl;
                        a.download = doc.title;
                        a.click();
                      }
                    }}
                    title="下载原文件"
                  >
                    <Download size={14} />
                  </button>
                  {canModify(doc) && (
                    <button
                      className="doc-card__action-icon doc-card__action-icon--danger"
                      onClick={(e) => { e.stopPropagation(); handleDelete(doc.id); }}
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="documents-list__empty">
            <File size={48} />
            <h3>暂无文档</h3>
            <p>点击"上传文档"按钮添加新文档</p>
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewDoc && (
        <div className="doc-preview-overlay" onClick={closePreview}>
          <div className="doc-preview" onClick={(e) => e.stopPropagation()}>
            {/* 预览头部 */}
            <div className="doc-preview__header">
              <button className="doc-preview__back" onClick={closePreview}>
                <ChevronLeft size={20} /> 返回列表
              </button>
              <div className="doc-preview__title-area">
                <h3>{previewDoc.title}</h3>
                <span className="doc-preview__meta">
                  贡献者：{previewDoc.uploadedBy} · {previewDoc.date} · {previewDoc.size}
                </span>
              </div>
              <div className="doc-preview__header-actions">
                {previewDoc.fileUrl && (
                  <button
                    className="doc-preview__download"
                    onClick={() => {
                      const a = document.createElement('a');
                      a.href = previewDoc.fileUrl;
                      a.download = previewDoc.title;
                      a.click();
                    }}
                    title="下载原文件"
                  >
                    <Download size={16} /> 下载
                  </button>
                )}
                <button className="doc-preview__close" onClick={closePreview}>
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* 预览内容区 */}
            <div className="doc-preview__content" ref={docContentRef}>
              {/* 优先：以文本形式输入的正文（Markdown / Word-HTML） */}
              {previewDoc.content && String(previewDoc.content).trim().length > 0 ? (
                <div className="doc-preview__text">
                  <div
                    className={`doc-preview__text-body ${
                      previewDoc.format === 'markdown'
                        ? 'doc-preview__text-body--markdown'
                        : 'doc-preview__text-body--word'
                    }`}
                    dangerouslySetInnerHTML={{ __html: renderedTextContent }}
                  />

                  {/* 附件列表（有附件时一并展示，仍可下载） */}
                  {Array.isArray(previewDoc.attachments) && previewDoc.attachments.length > 0 && (
                    <div className="doc-preview__attachments">
                      <div className="doc-preview__attachments-header">
                        <Paperclip size={16} />
                        <span>附件（{previewDoc.attachments.length}）</span>
                      </div>
                      <ul className="doc-preview__attachments-list">
                        {previewDoc.attachments.map((f) => (
                          <li key={f.id || f.name} className="doc-preview__attachments-item">
                            <FileText size={16} />
                            <span className="doc-preview__attachments-name">{f.name}</span>
                            {typeof f.size === 'number' && (
                              <span className="doc-preview__attachments-size">
                                {f.size < 1024
                                  ? `${f.size} B`
                                  : f.size < 1024 * 1024
                                    ? `${(f.size / 1024).toFixed(1)} KB`
                                    : `${(f.size / (1024 * 1024)).toFixed(1)} MB`}
                              </span>
                            )}
                            {f.dataUrl && (
                              <a
                                className="doc-preview__attachments-download"
                                href={f.dataUrl}
                                download={f.name}
                              >
                                <Download size={14} /> 下载
                              </a>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 文本型文档也提供整体评论 */}
                  <TextAnnotation
                    targetType="document"
                    targetId={previewDoc.id}
                    contentRef={docContentRef}
                    disabled
                  />
                </div>
              ) : canPreview(previewDoc) ? (
                previewDoc.fileType === 'pdf' ? (
                  <>
                    <iframe
                      src={previewDoc.fileUrl}
                      className="doc-preview__pdf"
                      title={previewDoc.title}
                    />
                    {/* PDF 内无法划词，提供整体评论 */}
                    <TextAnnotation
                      targetType="document"
                      targetId={previewDoc.id}
                      contentRef={docContentRef}
                      disabled
                    />
                  </>
                ) : previewDoc.fileType === 'image' ? (
                  <>
                    <div className="doc-preview__image-wrapper">
                      <img
                        src={previewDoc.fileUrl}
                        alt={previewDoc.title}
                        className="doc-preview__image"
                      />
                    </div>
                    {/* 图片无法划词，提供整体评论 */}
                    <TextAnnotation
                      targetType="document"
                      targetId={previewDoc.id}
                      contentRef={docContentRef}
                      disabled
                    />
                  </>
                ) : previewDoc.fileType === 'docx' ? (
                  /* Word 文档：mammoth 转 HTML，支持划词评论 */
                  <WordPreview
                    fileUrl={previewDoc.fileUrl}
                    docId={previewDoc.id}
                    title={previewDoc.title}
                  />
                ) : null
              ) : (
                <div className="doc-preview__no-preview">
                  <FileIcon fileType={previewDoc.fileType} size={64} />
                  <h3>{previewDoc.title}</h3>
                  <p className="doc-preview__no-preview-desc">{previewDoc.description}</p>
                  <div className="doc-preview__no-preview-info">
                    <span><Clock size={14} /> 上传日期: {previewDoc.date}</span>
                    <span><User size={14} /> 贡献者：{previewDoc.uploadedBy}</span>
                    <span><HardDrive size={14} /> 文件大小: {previewDoc.size}</span>
                    <span><BarChart3 size={14} /> 浏览次数: {previewDoc.viewCount || 0}</span>
                  </div>
                  {previewDoc.fileUrl ? (
                    <p className="doc-preview__no-preview-hint">
                      该文件格式暂不支持在线预览，请下载后使用本地应用打开。
                    </p>
                  ) : (
                    <p className="doc-preview__no-preview-hint">
                      该文档尚未关联文件，请重新上传以启用预览功能。
                    </p>
                  )}
                  {previewDoc.fileUrl && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        const a = document.createElement('a');
                        a.href = previewDoc.fileUrl;
                        a.download = previewDoc.title;
                        a.click();
                      }}
                    >
                      <Download size={16} /> 下载文件
                    </button>
                  )}
                  {/* 不可预览文档的评论 */}
                  <TextAnnotation
                    targetType="document"
                    targetId={previewDoc.id}
                    contentRef={docContentRef}
                    disabled
                  />
                </div>
              )}
            </div>

            {/* 预览弹窗底部点赞栏 */}
            <div className="doc-preview__footer">
              <button
                className={`doc-preview__like-btn ${hasLiked(previewDoc) ? 'doc-preview__like-btn--active' : ''}`}
                onClick={() => handleLike(previewDoc.id)}
              >
                <ThumbsUp size={16} />
                <span>{hasLiked(previewDoc) ? '已赞' : '点赞'}</span>
              </button>
              {(previewDoc.likes || []).length > 0 && (
                <div className="doc-preview__like-users">
                  <div className="doc-preview__like-names">
                    {(previewDoc.likes || []).map((like, idx) => (
                      <span key={like.userId} className="doc-preview__like-name">
                        {like.userName}{idx < (previewDoc.likes || []).length - 1 ? '、' : ''}
                      </span>
                    ))}
                  </div>
                  <span className="doc-preview__like-count">
                    {(previewDoc.likes || []).length} 人觉得有用
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
