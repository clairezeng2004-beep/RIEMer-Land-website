import { useState, useRef, useCallback, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useWysiwyg } from '../../contexts/WysiwygContext';
import EditableText from '../../components/EditableText';
import CustomSelect from '../../components/CustomSelect';
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
import {
  fetchAllAlbums,
  createAlbum as svcCreateAlbum,
  deleteAlbum as svcDeleteAlbum,
  addPhotosToAlbum as svcAddPhotos,
  deletePhoto as svcDeletePhoto,
} from '../../services/albumService';
import './Gallery.css';

/* ---------- 工具函数：选择缩略图 / 原图 URL ---------- */
// 展示优先用上传时生成的缩略图；老数据没有缩略图时降级回原图。
const getDisplayUrl = (photo) => photo?.thumbUrl || photo?.url || '';
// 下载始终走原图。
const getOriginalUrl = (photo) => photo?.url || '';

/* ---------- 工具函数：下载时推断合适的文件名 ----------
 * 优先级：caption(若无扩展名则补 ext) → originalName → storagePath 文件名 → 'photo.jpg'
 */
const guessDownloadFilename = (photo, blob) => {
  const pickExt = () => {
    const fromPath = (photo?.storagePath || '').split('/').pop() || '';
    const m1 = fromPath.match(/\.([a-z0-9]+)$/i);
    if (m1) return m1[1].toLowerCase();
    const fromName = photo?.originalName || '';
    const m2 = fromName.match(/\.([a-z0-9]+)$/i);
    if (m2) return m2[1].toLowerCase();
    const m3 = (blob?.type || '').match(/^image\/([a-z0-9+]+)$/i);
    if (m3) return m3[1].toLowerCase().replace('jpeg', 'jpg');
    return 'jpg';
  };
  const ext = pickExt();

  // 1) caption 有值就用 caption（若 caption 自带扩展名则不重复追加）
  if (photo?.caption && photo.caption.trim()) {
    const c = photo.caption.trim();
    return /\.[a-z0-9]+$/i.test(c) ? c : `${c}.${ext}`;
  }
  // 2) 用户上传时的原始文件名
  if (photo?.originalName) return photo.originalName;
  // 3) storage path 的文件名
  const fromPath = (photo?.storagePath || '').split('/').pop();
  if (fromPath) return fromPath;
  // 4) 兜底
  return `photo.${ext}`;
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

/* ---------- 空状态由接口/本地缓存提供，不再 seed 示例数据 ---------- */


export default function Gallery() {
  const { isAuthenticated, isAdmin, user } = useAuth();
  const { internalConfig, updateInternalConfig } = useSiteContent();
  const { editing } = useWysiwyg();
  const gc = internalConfig.gallery || {};

  const updateGallery = useCallback(
    (key, val) => updateInternalConfig({ gallery: { [key]: val } }),
    [updateInternalConfig]
  );
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
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
  // 新建相册时预选的照片（与 selectedFiles 结构一致）
  const [createAlbumFiles, setCreateAlbumFiles] = useState([]);
  const fileInputRef = useRef(null);
  const albumFileInputRef = useRef(null);
  const createAlbumFileRef = useRef(null);

  /* ---- 初次加载：从 Supabase 拉取相册（失败时本地缓存兜底） ---- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await fetchAllAlbums();
        if (alive) setAlbums(list);
      } catch (err) {
        console.warn('[Gallery] 加载相册失败：', err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  /* ---- 创建相册（上传到 Storage + 写入 DB） ---- */
  const handleCreateAlbum = async (e) => {
    e.preventDefault();
    if (!newAlbum.title.trim() || submitting) return;
    const y = newAlbum.year || now.getFullYear().toString();
    const m = (newAlbum.month || '1').padStart(2, '0');

    setSubmitting(true);
    try {
      const filesPayload = createAlbumFiles.map((f) => {
        const defaultCaption = f.file.name.replace(/\.[^.]+$/, '');
        return {
          file: f.file,
          caption: f.caption === defaultCaption ? '' : f.caption,
        };
      });
      const album = await svcCreateAlbum(
        {
          title: newAlbum.title,
          description: newAlbum.description,
          date: `${y}-${m}`,
        },
        filesPayload,
        user
      );
      setAlbums((prev) => [album, ...prev]);

      const resetNow = new Date();
      setNewAlbum({
        title: '',
        description: '',
        year: resetNow.getFullYear().toString(),
        month: (resetNow.getMonth() + 1).toString(),
      });
      // 释放 blob URL
      createAlbumFiles.forEach((f) => URL.revokeObjectURL(f.url));
      setCreateAlbumFiles([]);
      setShowCreateAlbum(false);
    } catch (err) {
      console.error('[Gallery] 创建相册失败：', err);
      alert('创建相册失败：' + (err.message || '未知错误'));
    } finally {
      setSubmitting(false);
    }
  };

  /* ---- 新建相册表单中选择图片 ---- */
  const handleCreateAlbumFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    const previews = files.map((file) => ({
      file,
      url: URL.createObjectURL(file),
      caption: file.name.replace(/\.[^.]+$/, ''),
    }));
    setCreateAlbumFiles((prev) => [...prev, ...previews]);
    // 清空 input，避免同一文件无法再次选中
    if (e.target) e.target.value = '';
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

  const handleAddPhotos = async () => {
    if (!selectedAlbum || selectedFiles.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const filesPayload = selectedFiles.map((f) => {
        const defaultCaption = f.file.name.replace(/\.[^.]+$/, '');
        return {
          file: f.file,
          caption: f.caption === defaultCaption ? '' : f.caption,
        };
      });
      const newPhotos = await svcAddPhotos(selectedAlbum, filesPayload, user);
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
      // 释放 blob URL
      selectedFiles.forEach((f) => URL.revokeObjectURL(f.url));
      setSelectedFiles([]);
      setShowAddPhoto(false);
    } catch (err) {
      console.error('[Gallery] 上传照片失败：', err);
      alert('上传照片失败：' + (err.message || '未知错误'));
    } finally {
      setSubmitting(false);
    }
  };

  /* ---- 删除照片 ---- */
  const handleDeletePhoto = async (photoId) => {
    if (!window.confirm('确定要删除这张照片吗？')) return;
    const photo = selectedAlbum.photos.find((p) => p.id === photoId);
    if (!photo) return;
    try {
      await svcDeletePhoto(selectedAlbum, photo);
    } catch (err) {
      console.error('[Gallery] 删除照片失败：', err);
      alert('删除照片失败：' + (err.message || '未知错误'));
      return;
    }
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
  const handleDeleteAlbum = async (albumId) => {
    if (!window.confirm('确定要删除整个相册吗？所有照片将一并删除。')) return;
    const album = albums.find((a) => a.id === albumId);
    if (!album) return;
    try {
      await svcDeleteAlbum(album);
    } catch (err) {
      console.error('[Gallery] 删除相册失败：', err);
      alert('删除相册失败：' + (err.message || '未知错误'));
      return;
    }
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
    const originalUrl = getOriginalUrl(photo);
    if (!originalUrl) return;
    try {
      const response = await fetch(originalUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = guessDownloadFilename(photo, blob);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      // fallback: 直接在新标签页打开原图
      window.open(originalUrl, '_blank');
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
              onClick={() => {
                const next = !showCreateAlbum;
                if (!next) {
                  // 关闭/取消时清空已选图片
                  setCreateAlbumFiles([]);
                }
                setShowCreateAlbum(next);
              }}
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
                    <CustomSelect
                      size="sm"
                      className="gallery-create__select"
                      value={String(newAlbum.year)}
                      onChange={(v) => setNewAlbum({ ...newAlbum, year: v })}
                      options={Array.from({ length: 10 }, (_, i) => {
                        const y = new Date().getFullYear() - i;
                        return { value: String(y), label: `${y} 年` };
                      })}
                    />
                    <CustomSelect
                      size="sm"
                      className="gallery-create__select"
                      value={String(newAlbum.month)}
                      onChange={(v) => setNewAlbum({ ...newAlbum, month: v })}
                      options={Array.from({ length: 12 }, (_, i) => ({
                        value: String(i + 1),
                        label: `${i + 1} 月`,
                      }))}
                    />
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
                <div className="gallery-create__field">
                  <label>照片（选填）</label>
                  <div
                    className="gallery-upload__dropzone gallery-create__dropzone"
                    onClick={() => createAlbumFileRef.current?.click()}
                  >
                    <input
                      ref={createAlbumFileRef}
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={handleCreateAlbumFileSelect}
                      style={{ display: 'none' }}
                    />
                    <Upload size={28} />
                    <p>点击选择照片，支持多选</p>
                    <span>创建后可以继续添加更多照片</span>
                  </div>
                  {createAlbumFiles.length > 0 && (
                    <div className="gallery-upload__preview gallery-create__preview">
                      {createAlbumFiles.map((f, i) => (
                        <div key={i} className="gallery-upload__preview-item">
                          <div className="gallery-upload__preview-img-wrapper">
                            <img src={f.url} alt={f.caption} />
                            <button
                              type="button"
                              className="gallery-upload__preview-remove"
                              onClick={() =>
                                setCreateAlbumFiles((prev) => prev.filter((_, idx) => idx !== i))
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
                              setCreateAlbumFiles((prev) =>
                                prev.map((item, idx) =>
                                  idx === i ? { ...item, caption: e.target.value } : item
                                )
                              );
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button type="submit" className="btn btn-primary">
                  <Plus size={16} /> 创建{createAlbumFiles.length > 0 ? `（含 ${createAlbumFiles.length} 张照片）` : ''}
                </button>
              </form>
            </div>
          )}

          {/* 相册列表 */}
          {loading ? (
            <div className="gallery-empty">
              <Images size={48} />
              <h3>加载中...</h3>
            </div>
          ) : albums.length > 0 ? (
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
                        <img src={getDisplayUrl(cover)} alt={album.title} loading="lazy" />
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
                <img src={getDisplayUrl(photo)} alt={photo.caption} loading="lazy" />
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
                      <span>下载原图</span>
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
              src={getDisplayUrl(selectedAlbum.photos[lightboxIndex])}
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
