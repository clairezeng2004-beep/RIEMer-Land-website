import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { articlesData } from '../../data/siteData';
import { getCommentCount } from '../../services/commentService';
import {
  FileText, Search, MessageSquare, Calendar, ArrowRight,
} from 'lucide-react';
import './InternalArticles.css';

export default function InternalArticles() {
  const { isAuthenticated } = useAuth();
  const { userArticles, internalConfig } = useSiteContent();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const allArticles = useMemo(
    () => [...userArticles, ...articlesData],
    [userArticles]
  );

  const categories = useMemo(() => {
    const cats = new Set(allArticles.map((a) => a.category));
    return ['全部', ...cats];
  }, [allArticles]);

  const filtered = useMemo(() => {
    return allArticles.filter((a) => {
      const matchesSearch =
        !searchTerm ||
        a.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.excerpt.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.tags.some((t) => t.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesCat =
        selectedCategory === '全部' || a.category === selectedCategory;
      return matchesSearch && matchesCat;
    });
  }, [allArticles, searchTerm, selectedCategory]);

  return (
    <div className="ia-list-page">
      <div className="container">
        <div className="ia-list__header">
          <div>
            <h1>
              <FileText size={28} /> 公众号历史文章
            </h1>
            <p>浏览文章内容，划选文字添加评论，与团队成员交流</p>
          </div>
        </div>

        {/* 筛选 */}
        <div className="ia-list__filters">
          <div className="ia-list__search">
            <Search size={18} className="ia-list__search-icon" />
            <input
              type="text"
              placeholder="搜索文章…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="ia-list__categories">
            {categories.map((cat) => (
              <button
                key={cat}
                className={`ia-list__cat ${selectedCategory === cat ? 'ia-list__cat--active' : ''}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* 文章列表 */}
        <div className="ia-list__grid">
          {filtered.map((article) => {
            const commentCount = getCommentCount('article', article.id);
            return (
              <Link
                key={article.id}
                to={`/internal/article/${article.id}`}
                className="ia-card card"
              >
                <div className="ia-card__body">
                  <span className="ia-card__category">{article.category}</span>
                  <h3 className="ia-card__title">{article.title}</h3>
                  <p className="ia-card__excerpt">{article.excerpt}</p>
                  <div className="ia-card__footer">
                    <span className="ia-card__meta">
                      <Calendar size={13} /> {article.date}
                    </span>
                    {commentCount > 0 && (
                      <span className="ia-card__comments">
                        <MessageSquare size={13} /> {commentCount}
                      </span>
                    )}
                    <span className="ia-card__arrow">
                      <ArrowRight size={14} />
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="ia-list__empty">
            <FileText size={48} />
            <h3>未找到匹配的文章</h3>
            <p>尝试更换搜索关键词</p>
          </div>
        )}
      </div>
    </div>
  );
}
