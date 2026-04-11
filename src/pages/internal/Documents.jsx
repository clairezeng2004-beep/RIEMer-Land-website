import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  FileText,
  Upload,
  Search,
  Download,
  Trash2,
  Plus,
  File,
  FolderOpen,
  Filter,
  X,
} from 'lucide-react';
import { documentsData } from '../../data/siteData';
import './Documents.css';

const typeLabels = {
  plan: '工作计划',
  regulation: '规章制度',
  minutes: '会议纪要',
  guide: '培训手册',
  finance: '财务报告',
};

const typeColors = {
  plan: '#5B8C3E',
  regulation: '#4FBFC4',
  minutes: '#D4A44C',
  guide: '#8B5CF6',
  finance: '#EC4899',
};

export default function Documents() {
  const { isAuthenticated, user } = useAuth();
  const [documents, setDocuments] = useState(documentsData);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('全部');
  const [showUpload, setShowUpload] = useState(false);
  const [newDoc, setNewDoc] = useState({ title: '', type: 'plan', description: '' });

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const types = ['全部', ...Object.keys(typeLabels)];

  const filtered = documents.filter((doc) => {
    const matchesSearch =
      doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = selectedType === '全部' || doc.type === selectedType;
    return matchesSearch && matchesType;
  });

  const handleAddDocument = (e) => {
    e.preventDefault();
    if (!newDoc.title) return;
    const doc = {
      id: Date.now().toString(),
      title: newDoc.title,
      type: newDoc.type,
      description: newDoc.description,
      uploadedBy: user?.name || 'Unknown',
      date: new Date().toISOString().split('T')[0],
      size: '—',
    };
    setDocuments([doc, ...documents]);
    setNewDoc({ title: '', type: 'plan', description: '' });
    setShowUpload(false);
  };

  const handleDelete = (id) => {
    if (window.confirm('确定要删除这个文档吗？')) {
      setDocuments(documents.filter((d) => d.id !== id));
    }
  };

  return (
    <div className="documents-page">
      <div className="container">
        <div className="documents-page__header">
          <div>
            <h1>
              <FolderOpen size={28} /> 文档管理
            </h1>
            <p>管理和浏览社团内部文档与资料</p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setShowUpload(!showUpload)}
          >
            {showUpload ? <X size={18} /> : <Plus size={18} />}
            {showUpload ? '取消' : '上传文档'}
          </button>
        </div>

        {/* Upload Form */}
        {showUpload && (
          <div className="documents-upload card">
            <h3>
              <Upload size={18} /> 上传新文档
            </h3>
            <form onSubmit={handleAddDocument} className="documents-upload__form">
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
                  <select
                    value={newDoc.type}
                    onChange={(e) => setNewDoc({ ...newDoc, type: e.target.value })}
                    className="documents-upload__input"
                  >
                    {Object.entries(typeLabels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
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
              <button
                key={type}
                className={`documents-filters__type ${
                  selectedType === type ? 'documents-filters__type--active' : ''
                }`}
                onClick={() => setSelectedType(type)}
              >
                {type === '全部' ? '全部' : typeLabels[type]}
              </button>
            ))}
          </div>
        </div>

        {/* Documents List */}
        <div className="documents-list">
          {filtered.map((doc) => (
            <div key={doc.id} className="document-item card">
              <div
                className="document-item__icon"
                style={{ background: `${typeColors[doc.type]}15`, color: typeColors[doc.type] }}
              >
                <FileText size={24} />
              </div>
              <div className="document-item__info">
                <h4 className="document-item__title">{doc.title}</h4>
                <p className="document-item__desc">{doc.description}</p>
                <div className="document-item__meta">
                  <span
                    className="document-item__type"
                    style={{ color: typeColors[doc.type], background: `${typeColors[doc.type]}12` }}
                  >
                    {typeLabels[doc.type]}
                  </span>
                  <span className="document-item__date">{doc.date}</span>
                  <span className="document-item__author">上传者: {doc.uploadedBy}</span>
                  <span className="document-item__size">{doc.size}</span>
                </div>
              </div>
              <div className="document-item__actions">
                <button className="btn btn-ghost btn-sm" title="下载">
                  <Download size={16} />
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleDelete(doc.id)}
                  title="删除"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="documents-list__empty">
              <File size={48} />
              <h3>暂无文档</h3>
              <p>点击"上传文档"按钮添加新文档</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
