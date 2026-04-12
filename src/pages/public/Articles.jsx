import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Search,
  Filter,
  ArrowRight,
  FileText,
  Tag,
  Calendar,
  User,
} from 'lucide-react';
import { articlesData, teamMembers } from '../../data/siteData';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { pinyinMatch } from '../../utils/pinyinSearch';
import ArticleChat from '../../components/ArticleChat';
import './Articles.css';

export default function Articles() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const { userArticles } = useSiteContent();

  // 负责人映射
  const memberMap = useMemo(
    () => Object.fromEntries(teamMembers.map((m) => [m.id, m])),
    []
  );

  // 合并所有文章，按日期降序
  const allArticles = useMemo(
    () => [...userArticles, ...articlesData].sort((a, b) => b.date.localeCompare(a.date)),
    [userArticles]
  );

  const categories = useMemo(() => {
    const cats = [...new Set(allArticles.map((a) => a.category))];
    return ['全部', ...cats];
  }, [allArticles]);

  const filtered = useMemo(() => {
    return allArticles.filter((article) => {
      const matchesSearch =
        !searchTerm ||
        pinyinMatch(article.title, searchTerm) ||
        pinyinMatch(article.author, searchTerm) ||
        pinyinMatch(article.excerpt, searchTerm) ||
        pinyinMatch(article.category, searchTerm) ||
        article.tags.some((t) => pinyinMatch(t, searchTerm));
      const matchesCategory =
        selectedCategory === '全部' || article.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [searchTerm, selectedCategory]);

  return (
    <div className="articles-page">
      {/* Hero */}
      <section className="articles-hero">
        <div className="container">
          <div className="articles-hero__content">
            <h1>内容索引</h1>
            <p>
              汇聚 RIEMers 的真实经历与多元心得，在这里找到属于你的那份启发。
            </p>
          </div>
        </div>
      </section>

      {/* Filters */}
      <section className="articles-filters">
        <div className="container">
          <div className="articles-filters__bar">
            <div className="articles-filters__search">
              <Search size={18} className="articles-filters__search-icon" />
              <input
                type="text"
                placeholder="搜索文章标题、作者或关键词..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="articles-filters__input"
              />
            </div>
            <div className="articles-filters__categories">
              {categories.map((cat) => (
                <button
                  key={cat}
                  className={`articles-filters__cat ${
                    selectedCategory === cat ? 'articles-filters__cat--active' : ''
                  }`}
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Articles List */}
      <section className="articles-list section">
        <div className="container">
          <div className="articles-list__count">
            共 {filtered.length} 篇文章
          </div>
          <div className="articles-list__grid">
            {filtered.map((article) => (
              <Link
                key={article.id}
                to={`/article/${article.id}`}
                className="article-card card"
              >
                {/* 封面图 */}
                <div className="article-card__cover">
                  {article.coverImage ? (
                    <img
                      src={article.coverImage}
                      alt={article.title}
                      className="article-card__cover-img"
                      loading="lazy"
                    />
                  ) : (
                    <div className="article-card__cover-placeholder">
                      <FileText size={28} />
                    </div>
                  )}
                </div>
                <div className="article-card__body">
                  {/* 作者头像行 */}
                  <div className="article-card__author">
                    {article.avatar ? (
                      <img
                        src={article.avatar}
                        alt={article.author}
                        className="article-card__avatar"
                      />
                    ) : (
                      <span className="article-card__avatar article-card__avatar--default">
                        <User size={14} />
                      </span>
                    )}
                    <span className="article-card__author-name">{article.author}</span>
                  </div>
                  <h3 className="article-card__title">{article.title}</h3>
                  <p className="article-card__excerpt">{article.excerpt}</p>
                  <div className="article-card__tags">
                    {article.tags.map((tag) => (
                      <span key={tag} className="article-card__tag">
                        <Tag size={12} /> {tag}
                      </span>
                    ))}
                  </div>
                  <div className="article-card__bottom">
                    <span className="article-card__meta">
                      <Calendar size={14} />
                      <span>{article.date}</span>
                    </span>
                    {(() => {
                      const leader = article.leaderId ? memberMap[article.leaderId] : null;
                      return leader ? (
                        <Link
                          to={leader.profileUrl}
                          className="article-card__leader"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <img src={leader.avatar} alt={leader.name} className="article-card__leader-avatar" />
                          <span>{leader.name}</span>
                        </Link>
                      ) : null;
                    })()}
                    <span className="article-card__link">
                      阅读全文 <ArrowRight size={14} />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {filtered.length === 0 && (
            <div className="articles-list__empty">
              <FileText size={48} />
              <h3>未找到匹配的文章</h3>
              <p>请尝试调整搜索条件或筛选分类</p>
            </div>
          )}
        </div>
      </section>

      {/* 内容助手对话窗口 */}
      <ArticleChat />
    </div>
  );
}
