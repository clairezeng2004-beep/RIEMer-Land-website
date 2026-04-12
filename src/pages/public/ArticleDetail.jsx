import { useMemo } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { ArrowLeft, Calendar, User, Tag, Clock, ExternalLink } from 'lucide-react';
import { articlesData, teamMembers } from '../../data/siteData';
import { useSiteContent } from '../../contexts/SiteContentContext';
import './ArticleDetail.css';

export default function ArticleDetail() {
  const { id } = useParams();
  const { userArticles } = useSiteContent();

  // 负责人映射
  const memberMap = useMemo(
    () => Object.fromEntries(teamMembers.map((m) => [m.id, m])),
    []
  );

  const allArticles = useMemo(
    () => [...userArticles, ...articlesData],
    [userArticles]
  );

  const article = allArticles.find((a) => a.id === id);

  if (!article) {
    return <Navigate to="/articles" replace />;
  }

  const leader = article.leaderId ? memberMap[article.leaderId] : null;

  // Simple markdown-like rendering
  const renderContent = (content) => {
    return content.split('\n\n').map((block, i) => {
      if (block.startsWith('## ')) {
        return (
          <h2 key={i} className="article-detail__h2">
            {block.replace('## ', '')}
          </h2>
        );
      }
      if (block.startsWith('### ')) {
        return (
          <h3 key={i} className="article-detail__h3">
            {block.replace('### ', '')}
          </h3>
        );
      }
      return (
        <p key={i} className="article-detail__paragraph">
          {block}
        </p>
      );
    });
  };

  const relatedArticles = allArticles
    .filter((a) => a.id !== id && a.category === article.category)
    .slice(0, 2);

  return (
    <div className="article-detail-page">
      <div className="container">
        <Link to="/articles" className="article-detail__back">
          <ArrowLeft size={18} />
          返回文章列表
        </Link>

        <article className="article-detail">
          <header className="article-detail__header">
            <span className="badge badge-primary">{article.category}</span>
            <h1 className="article-detail__title">{article.title}</h1>
            <div className="article-detail__meta">
              <span className="article-detail__meta-item">
                <User size={16} /> {article.author}
              </span>
              <span className="article-detail__meta-item">
                <Calendar size={16} /> {article.date}
              </span>
              <span className="article-detail__meta-item">
                <Clock size={16} /> 约 {Math.ceil((article.content || '').length / 500)} 分钟阅读
              </span>
            </div>
            {leader && (
              <Link to={leader.profileUrl} className="article-detail__leader">
                <img src={leader.avatar} alt={leader.name} className="article-detail__leader-avatar" />
                <span>负责人：{leader.name}</span>
              </Link>
            )}
            <div className="article-detail__tags">
              {article.tags.map((tag) => (
                <span key={tag} className="article-detail__tag">
                  <Tag size={12} /> {tag}
                </span>
              ))}
            </div>
            {article.url && (
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="article-detail__original-link"
              >
                <ExternalLink size={14} />
                阅读公众号原文
              </a>
            )}
          </header>

          <div className="article-detail__content">
            {article.content ? renderContent(article.content) : (
              <p className="article-detail__paragraph">{article.excerpt}</p>
            )}
          </div>
        </article>

        {relatedArticles.length > 0 && (
          <section className="article-detail__related">
            <h3>相关文章</h3>
            <div className="article-detail__related-grid">
              {relatedArticles.map((a) => (
                <Link
                  key={a.id}
                  to={`/article/${a.id}`}
                  className="article-detail__related-card card"
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
