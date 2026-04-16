import { useState, useRef, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useWysiwyg } from '../../contexts/WysiwygContext';
import EditableText from '../../components/EditableText';
import {
  Camera,
  Plus,
  X,
  Upload,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Image as ImageIcon,
  Trash2,
  FolderPlus,
  Images,
  Download,
} from 'lucide-react';
import './Gallery.css';

/* ---------- 工具函数：从 URL 生成压缩版和原图版 ---------- */
const getThumbUrl = (url) => {
  // 如果已经带有 ?w= 参数，直接作为压缩版；否则追加 ?w=640
  if (/[?&]w=\d+/.test(url)) return url;
  return url + (url.includes('?') ? '&' : '?') + 'w=640&q=75';
};

const getOriginalUrl = (url) => {
  // 去掉 w= 和 q= 参数以获取原图
  return url.replace(/[?&](w|q)=\d+/g, '').replace(/\?$/, '');
};

/* ---------- 工具函数：格式化日期显示 ---------- */
const formatAlbumDate = (dateStr) => {
  if (!dateStr) return '';
  // 支持 "2025-03" 或 "2025-03-22" 格式
  const parts = dateStr.split('-');
  const y = parts[0];
  const m = parts[1] ? parseInt(parts[1], 10) : null;
  return m ? `${y} 年 ${m} 月` : `${y} 年`;
};

/* ---------- 示例相册数据 ---------- */
const initialAlbums = [
  {
    id: '1',
    title: '春季聚会',
    description: '成员线下春季见面会，烧烤与户外活动',
    coverIndex: 0,
    date: '2025-03',
    photos: [
      { id: 'p1', url: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=640&q=75', caption: '合照' },
      { id: 'p2', url: 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?w=640&q=75', caption: '烧烤现场' },
      { id: 'p3', url: 'https://images.unsplash.com/photo-1511632765486-a01980e01a18?w=640&q=75', caption: '户外游戏' },
      { id: 'p4', url: 'https://images.unsplash.com/photo-1523301343968-6a6ebf63c672?w=640&q=75', caption: '傍晚合影' },
    ],
  },
  {
    id: '2',
    title: '线上读书分享会',
    description: '第三期线上读书会，分享近期阅读心得',
    coverIndex: 0,
    date: '2025-02',
    photos: [
      { id: 'p5', url: 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?w=640&q=75', caption: '读书会截图' },
      { id: 'p6', url: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=640&q=75', caption: '推荐书单' },
    ],
  },
  {
    id: '3',
    title: '年末总结会',
    description: '回顾这一年的成长与收获，展望新年计划',
    coverIndex: 0,
    date: '2024-12',
    photos: [
      { id: 'p7', url: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=640&q=75', caption: '总结会现场' },
      { id: 'p8', url: 'https://images.unsplash.com/photo-1517486808906-6ca8b3f04846?w=640&q=75', caption: '颁奖环节' },
      { id: 'p9', url: 'https://images.unsplash.com/photo-1528605248644-14dd04022da1?w=640&q=75', caption: '聚餐时光' },
    ],
  },
];

export default function Gallery() {
  const { isAuthenticated, isAdmin, user } = useAuth();
  const { internalConfig, updateInternalConfig } = useSiteContent();
  const { editing } = useWysiwyg();
  const gc = internalConfig.gallery || {};

  const updateGallery = useCallback(
    (key, val) => updateInternalConfig({ gallery: { [key]: val } }),
    [updateInternalConfig]
  );
  const [albums, setAlbums] = useState(initialAlbums);
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [showCreateAlbum, setShowCreateAlbum] = useState(false);
  const [showAddPhoto, setShowAddPhoto] = useState(false);
  const now = new Date();
  const [newAlbum, setNewAlbum] = useState({
    title: '',
    description: '',
    year: now.getFullYear().toString(),
    month: (now.getMonth() + 1).toString(),
  });
  const [selectedFiles, setSelectedFiles] = useState([]);
  const fileInputRef = useRef(null);
  const albumFileInputRef = useRef(null);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  /* ---- 创建相册 ---- */
  const handleCreateAlbum = (e) => {
    e.preventDefault();
    if (!newAlbum.title.trim()) return;
    const y = newAlbum.year || now.getFullYear().toString();
    const m = (newAlbum.month || '1').padStart(2, '0');
    const album = {
      id: Date.now().toString(),
      title: newAlbum.title,
      description: newAlbum.description,
      coverIndex: 0,
      date: `${y}-${m}`,
      createdById: user?.id || null,
      createdBy: user?.nickname || user?.name || 'Unknown',
      photos: [],
    };
    setAlbums([album, ...albums]);
    const resetNow = new Date();
    setNewAlbum({
      title: '',
      description: '',
      year: resetNow.getFullYear().toString(),
      month: (resetNow.getMonth() + 1).toString(),
    });
    setShowCreateAlbum(false);
  };

  /* ---- 添加照片到相册 ---- */
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    const previews = files.map((file) => ({
      file,
      url: URL.createObjectURL(file),
      caption: file.name.replace(/\.[^.]+$/, ''),
    }));
    setSelectedFiles((prev) => [...prev, ...previews]);
  };

  const handleAddPhotos = () => {
    if (!selectedAlbum || selectedFiles.length === 0) return;
    const newPhotos = selectedFiles.map((f, i) => {
      const defaultCaption = f.file.name.replace(/\.[^.]+$/, '');
      return {
        id: `upload-${Date.now()}-${i}`,
        url: f.url,
        caption: f.caption === defaultCaption ? '' : f.caption,
        uploadedById: user?.id || null,
      };
    });
    setAlbums((prev) =>
      prev.map((a) =>
        a.id === selectedAlbum.id
          ? { ...a, photos: [...a.photos, ...newPhotos] }
          : a
      )
    );
    setSelectedAlbum((prev) => ({
      ...prev,
      photos: [...prev.photos, ...newPhotos],
    }));
    setSelectedFiles([]);
    setShowAddPhoto(false);
  };

  /* ---- 删除照片 ---- */
  const handleDeletePhoto = (photoId) => {
    if (!window.confirm('确定要删除这张照片吗？')) return;
    setAlbums((prev) =>
      prev.map((a) =>
        a.id === selectedAlbum.id
          ? { ...a, photos: a.photos.filter((p) => p.id !== photoId) }
          : a
      )
    );
    setSelectedAlbum((prev) => ({
      ...prev,
      photos: prev.photos.filter((p) => p.id !== photoId),
    }));
  };

  /* ---- 删除相册 ---- */
  const handleDeleteAlbum = (albumId) => {
    if (!window.confirm('确定要删除整个相册吗？所有照片将一并删除。')) return;
    setAlbums((prev) => prev.filter((a) => a.id !== albumId));
    if (selectedAlbum?.id === albumId) setSelectedAlbum(null);
  };

  // 权限判断：管理员或创建者/上传者可删除
  const canModifyAlbum = (album) => {
    if (isAdmin) return true;
    if (album.createdById && album.createdById === user?.id) return true;
    if (album.createdBy && album.createdBy === user?.name) return true;
    return false;
  };

  const canModifyPhoto = (photo) => {
    if (isAdmin) return true;
    // 照片上传者可删除
    if (photo.uploadedById && photo.uploadedById === user?.id) return true;
    // 相册创建者也可删除相册内的照片
    if (selectedAlbum?.createdById && selectedAlbum.createdById === user?.id) return true;
    return false;
  };

  /* ---- Lightbox ---- */
  const openLightbox = (index) => setLightboxIndex(index);
  const closeLightbox = () => setLightboxIndex(null);

  /* ---- 下载原图 ---- */
  const handleDownloadOriginal = async (photo) => {
    try {
      const originalUrl = getOriginalUrl(photo.url);
      const response = await fetch(originalUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = (photo.caption || 'photo') + '.jpg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      // fallback: 直接在新标签页打开原图
      window.open(getOriginalUrl(photo.url), '_blank');
    }
  };

  const lightboxPrev = () => {
    if (lightboxIndex === null || !selectedAlbum) return;
    setLightboxIndex(
      (lightboxIndex - 1 + selectedAlbum.photos.length) % selectedAlbum.photos.length
    );
  };

  const lightboxNext = () => {
    if (lightboxIndex === null || !selectedAlbum) return;
    setLightboxIndex((lightboxIndex + 1) % selectedAlbum.photos.length);
  };

  /* ========================================
     VIEW: 相册列表
     ======================================== */
  if (!selectedAlbum) {
    return (
      <div className="gallery-page">
        <div className="container">
          {/* Header */}
          <div className="gallery-page__header">
            <div>
              <h1>
                <Camera size={28} /> <EditableText
                  value={gc.pageTitle}
                  onChange={(v) => updateGallery('pageTitle', v)}
                  configKey="gallery.pageTitle"
                  as="span"
                />
              </h1>
              <p><EditableText
                value={gc.pageDesc}
                onChange={(v) => updateGallery('pageDesc', v)}
                configKey="gallery.pageDesc"
                as="span"
              /></p>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => setShowCreateAlbum(!showCreateAlbum)}
            >
              {showCreateAlbum ? <X size={18} /> : <FolderPlus size={18} />}
              {showCreateAlbum ? '取消' : <EditableText
                value={gc.newAlbumBtn}
                onChange={(v) => updateGallery('newAlbumBtn', v)}
                configKey="gallery.newAlbumBtn"
                as="span"
              />}
            </button>
          </div>

          {/* 新建相册表单 */}
          {showCreateAlbum && (
            <div className="gallery-create card">
              <h3>
                <FolderPlus size={18} /> 新建相册
              </h3>
              <form onSubmit={handleCreateAlbum} className="gallery-create__form">
                <div className="gallery-create__field">
                  <label>相册主题</label>
                  <input
                    type="text"
                    value={newAlbum.title}
                    onChange={(e) => setNewAlbum({ ...newAlbum, title: e.target.value })}
                    placeholder="例如：招新聚会"
                    className="gallery-create__input"
                    required
                  />
                </div>
                <div className="gallery-create__field">
                  <label>时间</label>
                  <div className="gallery-create__date-row">
                    <select
                      value={newAlbum.year}
                      onChange={(e) => setNewAlbum({ ...newAlbum, year: e.target.value })}
                      className="gallery-create__input gallery-create__select"
                    >
                      {Array.from({ length: 10 }, (_, i) => {
                        const y = new Date().getFullYear() - i;
                        return <option key={y} value={y}>{y} 年</option>;
                      })}
                    </select>
                    <select
                      value={newAlbum.month}
                      onChange={(e) => setNewAlbum({ ...newAlbum, month: e.target.value })}
                      className="gallery-create__input gallery-create__select"
                    >
                      {Array.from({ length: 12 }, (_, i) => (
                        <option key={i + 1} value={i + 1}>{i + 1} 月</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="gallery-create__field">
                  <label>描述（选填）</label>
                  <textarea
                    value={newAlbum.description}
                    onChange={(e) => setNewAlbum({ ...newAlbum, description: e.target.value })}
                    placeholder="简要描述这次活动"
                    className="gallery-create__input gallery-create__textarea"
                    rows={3}
                  />
                </div>
                <button type="submit" className="btn btn-primary">
                  <Plus size={16} /> 创建
                </button>
              </form>
            </div>
          )}

          {/* 相册列表 */}
          {albums.length > 0 ? (
            <div className="gallery-grid">
              {[...albums].sort((a, b) => b.date.localeCompare(a.date)).map((album) => {
                const cover = album.photos[album.coverIndex] || album.photos[0];
                return (
                  <div
                    key={album.id}
                    className="album-card card"
                    onClick={() => setSelectedAlbum(album)}
                  >
                    <div className="album-card__cover">
                      {cover ? (
                        <img src={getThumbUrl(cover.url)} alt={album.title} loading="lazy" />
                      ) : (
                        <div className="album-card__cover-empty">
                          <Images size={40} />
                          <span>暂无照片</span>
                        </div>
                      )}
                      <div className="album-card__cover-overlay">
                        <span className="album-card__photo-count">
                          <ImageIcon size={14} /> {album.photos.length} 张
                        </span>
                      </div>
                    </div>
                    <div className="album-card__body">
                      <h3 className="album-card__title">{album.title}</h3>
                      {album.description && (
                        <p className="album-card__desc">{album.description}</p>
                      )}
                      <div className="album-card__meta">
                        <span>
                          <Calendar size={12} /> {formatAlbumDate(album.date)}
                        </span>
                      </div>
                    </div>
                    {/* 删除按钮 */}
                    {canModifyAlbum(album) && (
                      <button
                        className="album-card__delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteAlbum(album.id);
                        }}
                        title="删除相册"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="gallery-empty">
              <Images size={48} />
              <h3>还没有相册</h3>
              <p>点击「新建相册」开始记录美好瞬间</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ========================================
     VIEW: 相册详情（照片网格）
     ======================================== */
  return (
    <div className="gallery-page">
      <div className="container">
        {/* 详情 Header */}
        <div className="gallery-detail__header">
          <button
            className="gallery-detail__back"
            onClick={() => {
              setSelectedAlbum(null);
              setShowAddPhoto(false);
              setSelectedFiles([]);
            }}
          >
            <ChevronLeft size={20} /> 返回相册
          </button>
          <div className="gallery-detail__info">
            <h1>{selectedAlbum.title}</h1>
            {selectedAlbum.description && (
              <p className="gallery-detail__desc">{selectedAlbum.description}</p>
            )}
            <span className="gallery-detail__meta">
              <Calendar size={14} /> {formatAlbumDate(selectedAlbum.date)} · {selectedAlbum.photos.length} 张照片
            </span>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setShowAddPhoto(!showAddPhoto)}
          >
            {showAddPhoto ? <X size={18} /> : <Upload size={18} />}
            {showAddPhoto ? '取消' : '上传照片'}
          </button>
        </div>

        {/* 上传照片区域 */}
        {showAddPhoto && (
          <div className="gallery-upload card">
            <div
              className="gallery-upload__dropzone"
              onClick={() => albumFileInputRef.current?.click()}
            >
              <input
                ref={albumFileInputRef}
                type="file"
                multiple
                accept="image/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              <Upload size={32} />
              <p>点击选择照片，支持多选</p>
              <span>JPG、PNG、WebP 等图片格式</span>
            </div>

            {selectedFiles.length > 0 && (
              <>
                <div className="gallery-upload__preview">
                  {selectedFiles.map((f, i) => (
                    <div key={i} className="gallery-upload__preview-item">
                      <div className="gallery-upload__preview-img-wrapper">
                        <img src={f.url} alt={f.caption} />
                        <button
                          className="gallery-upload__preview-remove"
                          onClick={() =>
                            setSelectedFiles((prev) => prev.filter((_, idx) => idx !== i))
                          }
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <input
                        type="text"
                        className="gallery-upload__caption-input"
                        placeholder="添加注释（选填）"
                        value={f.caption === f.file.name.replace(/\.[^.]+$/, '') ? '' : f.caption}
                        onChange={(e) => {
                          setSelectedFiles((prev) =>
                            prev.map((item, idx) =>
                              idx === i ? { ...item, caption: e.target.value } : item
                            )
                          );
                        }}
                      />
                    </div>
                  ))}
                </div>
                <button className="btn btn-primary" onClick={handleAddPhotos}>
                  <Upload size={16} /> 确认上传 {selectedFiles.length} 张照片
                </button>
              </>
            )}
          </div>
        )}

        {/* 照片网格 */}
        {selectedAlbum.photos.length > 0 ? (
          <div className="photo-grid">
            {selectedAlbum.photos.map((photo, index) => (
              <div
                key={photo.id}
                className="photo-card"
                onClick={() => openLightbox(index)}
              >
                <img src={getThumbUrl(photo.url)} alt={photo.caption} loading="lazy" />
                <div className="photo-card__overlay">
                  {photo.caption && (
                    <span className="photo-card__caption">{photo.caption}</span>
                  )}
                  <div className="photo-card__actions">
                    <button
                      className="photo-card__download"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownloadOriginal(photo);
                      }}
                      title="下载原图"
                    >
                      <Download size={14} />
                    </button>
                    {canModifyPhoto(photo) && (
                      <button
                        className="photo-card__delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePhoto(photo.id);
                        }}
                        title="删除照片"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="gallery-empty">
            <ImageIcon size={48} />
            <h3>这个相册还没有照片</h3>
            <p>点击「上传照片」添加第一张照片吧</p>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && selectedAlbum.photos[lightboxIndex] && (
        <div className="lightbox" onClick={closeLightbox}>
          <div className="lightbox__content" onClick={(e) => e.stopPropagation()}>
            <img
              src={getThumbUrl(selectedAlbum.photos[lightboxIndex].url)}
              alt={selectedAlbum.photos[lightboxIndex].caption}
            />
            {selectedAlbum.photos[lightboxIndex].caption && (
              <div className="lightbox__caption">
                {selectedAlbum.photos[lightboxIndex].caption}
              </div>
            )}
          </div>

          <button
            className="lightbox__download"
            onClick={(e) => {
              e.stopPropagation();
              handleDownloadOriginal(selectedAlbum.photos[lightboxIndex]);
            }}
            title="下载原图"
          >
            <Download size={20} /> 下载原图
          </button>

          <button className="lightbox__close" onClick={closeLightbox}>
            <X size={24} />
          </button>

          {selectedAlbum.photos.length > 1 && (
            <>
              <button
                className="lightbox__nav lightbox__nav--prev"
                onClick={(e) => {
                  e.stopPropagation();
                  lightboxPrev();
                }}
              >
                <ChevronLeft size={28} />
              </button>
              <button
                className="lightbox__nav lightbox__nav--next"
                onClick={(e) => {
                  e.stopPropagation();
                  lightboxNext();
                }}
              >
                <ChevronRight size={28} />
              </button>
            </>
          )}

          <div className="lightbox__counter">
            {lightboxIndex + 1} / {selectedAlbum.photos.length}
          </div>
        </div>
      )}
    </div>
  );
}
