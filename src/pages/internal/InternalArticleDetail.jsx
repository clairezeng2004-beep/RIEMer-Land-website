import { useMemo, useRef } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { ArrowLeft, Calendar, Tag, Clock, ExternalLink } from 'lucide-react';
import { articlesData } from '../../data/siteData';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useAuth } from '../../contexts/AuthContext';
import TextAnnotation from '../../components/TextAnnotation';
import './InternalArticleDetail.css';

export default function InternalArticleDetail() {
  const { id } = useParams();
  const { userArticles } = useSiteContent();
  const { isAuthenticated } = useAuth();
  const contentRef = useRef(null);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const allArticles = useMemo(
    () => [...userArticles, ...articlesData],
    [userArticles]
  );

  const article = allArticles.find((a) => a.id === id);

  if (!article) {
    return <Navigate to="/internal/articles" replace />;
  }

  // Simple markdown-like rendering
  const renderContent = (content) => {
    return content.split('\n\n').map((block, i) => {
      if (block.startsWith('## ')) {
        return (
          <h2 key={i} className="ia-detail__h2">
            {block.replace('## ', '')}
          </h2>
        );
      }
      if (block.startsWith('### ')) {
        return (
          <h3 key={i} className="ia-detail__h3">
            {block.replace('### ', '')}
          </h3>
        );
      }
      return (
        <p key={i} className="ia-detail__paragraph">
          {block}
        </p>
      );
    });
  };

  const relatedArticles = allArticles
    .filter((a) => a.id !== id && a.category === article.category)
    .slice(0, 2);

  return (
    <div className="ia-detail-page">
      <div className="container">
        <Link to="/internal/articles" className="ia-detail__back">
          <ArrowLeft size={18} />
          返回文章列表
        </Link>

        <article className="ia-detail">
          <header className="ia-detail__header">
            <span className="badge badge-primary">{article.category}</span>
            <h1 className="ia-detail__title">{article.title}</h1>
            <div className="ia-detail__meta">
              <span className="ia-detail__meta-item">
                <Calendar size={16} /> {article.date}
              </span>
              <span className="ia-detail__meta-item">
                <Clock size={16} /> 约 {Math.ceil((article.content || '').length / 500)} 分钟阅读
              </span>
            </div>
            <div className="ia-detail__tags">
              {article.tags.map((tag) => (
                <span key={tag} className="ia-detail__tag">
                  <Tag size={12} /> {tag}
                </span>
              ))}
            </div>
            {article.url && (
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ia-detail__original-link"
              >
                <ExternalLink size={14} />
                阅读公众号原文
              </a>
            )}
          </header>

          {/* 文章内容区域 — contentRef 用于划词评论 */}
          <div className="ia-detail__content" ref={contentRef}>
            {article.content ? renderContent(article.content) : (
              <p className="ia-detail__paragraph">{article.excerpt}</p>
            )}
          </div>

          {/* 划词评论组件 */}
          <TextAnnotation
            targetType="article"
            targetId={article.id}
            contentRef={contentRef}
          />
        </article>

        {relatedArticles.length > 0 && (
          <section className="ia-detail__related">
            <h3>相关文章</h3>
            <div className="ia-detail__related-grid">
              {relatedArticles.map((a) => (
                <Link
                  key={a.id}
                  to={`/internal/article/${a.id}`}
                  className="ia-detail__related-card card"
                >
                  <span className="badge badge-primary">{a.category}</span>
                  <h4>{a.title}</h4>
                  <p>{a.excerpt}</p>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
