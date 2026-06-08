import { Link } from 'react-router-dom';
import { ArrowRight, Clock, ExternalLink, FileText, Tag, X } from 'lucide-react';
import CoverImage from './CoverImage';
import './ArticlePreviewModal.css';

export default function ArticlePreviewModal({ article, onClose, onOpen, detailTo }) {
  if (!article) return null;

  // 站内详情链接：默认走公开路由 /article/:id，内部空间可传 /internal/article/:id
  const detailPath = detailTo || `/article/${article.id}`;

  const hasUrl = Boolean(article.url);
  const tags = Array.isArray(article.tags) ? article.tags.filter(Boolean) : [];

  const handleOpen = () => {
    onOpen?.(article, hasUrl ? 'wechat' : 'detail');
    if (hasUrl) {
      window.open(article.url, '_blank', 'noopener,noreferrer');
      onClose?.();
    }
  };

  return (
    <div className="article-preview__overlay" onClick={onClose}>
      <div
        className="article-preview"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="article-preview-title"
      >
        <button
          type="button"
          className="article-preview__close"
          onClick={onClose}
          aria-label="关闭"
        >
          <X size={18} />
        </button>

        <div className="article-preview__cover">
          {article.coverImage ? (
            <CoverImage
              src={article.coverImage}
              alt={article.title}
              className="article-preview__cover-img"
            />
          ) : (
            <div className="article-preview__cover-placeholder">
              <FileText size={34} />
            </div>
          )}
        </div>

        <div className="article-preview__body">
          <div className="article-preview__meta">
            {article.date && (
              <span className="article-preview__meta-item">
                <Clock size={14} /> {article.date}
              </span>
            )}
            {article.category && (
              <span className="article-preview__category">{article.category}</span>
            )}
          </div>

          <h3 id="article-preview-title" className="article-preview__title">
            {article.title}
          </h3>

          <p className="article-preview__excerpt">
            {article.excerpt || '暂无简介'}
          </p>

          {tags.length > 0 && (
            <div className="article-preview__tags">
              {tags.map((tag) => (
                <span key={tag} className="article-preview__tag">
                  <Tag size={12} /> {tag}
                </span>
              ))}
            </div>
          )}

          <div className="article-preview__actions">
            {hasUrl ? (
              <button
                type="button"
                className="btn btn-primary article-preview__primary"
                onClick={handleOpen}
              >
                <ExternalLink size={16} /> 打开公众号原文
              </button>
            ) : (
              <Link
                to={detailPath}
                className="btn btn-primary article-preview__primary"
                onClick={() => {
                  onOpen?.(article, 'detail');
                  onClose?.();
                }}
              >
                查看站内详情 <ArrowRight size={16} />
              </Link>
            )}
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              返回
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
