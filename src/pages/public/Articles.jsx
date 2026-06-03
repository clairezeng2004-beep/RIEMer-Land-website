import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Search,
  Filter,
  ArrowRight,
  FileText,
  Tag,
  Clock,
} from 'lucide-react';
import { trackEvent } from '../../lib/analytics';
import { articlesData, teamMembers } from '../../data/siteData';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { pinyinMatch } from '../../utils/pinyinSearch';
import ArticleChat from '../../components/ArticleChat';
import CoverImage from '../../components/CoverImage';
import './Articles.css';

export default function Articles() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [selectedTag, setSelectedTag] = useState('全部');
  const { userArticles } = useSiteContent();

  // 合并所有文章，按日期降序
  const allArticles = useMemo(
    () => [...userArticles, ...articlesData].sort((a, b) => b.date.localeCompare(a.date)),
    [userArticles]
  );

  const categories = useMemo(() => {
    // 过滤掉空/未命名系列：没有归类的文章不应生成一个空白的系列按钮
    const cats = [...new Set(
      allArticles
        .map((a) => (a.category || '').trim())
        .filter(Boolean)
    )];
    return ['全部', ...cats];
  }, [allArticles]);

  // 筛选标签 = 系列 + 标签；系列放在前面，便于优先按文章系列浏览。
  const allTags = useMemo(() => {
    const tagCount = {};
    allArticles.forEach((a) => {
      (a.tags || []).forEach((t) => {
        tagCount[t] = (tagCount[t] || 0) + 1;
      });
    });
    const tags = Object.entries(tagCount)
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);
    return [...new Set([...categories.filter((cat) => cat && cat !== '全部'), ...tags])];
  }, [allArticles, categories]);

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
      const matchesTag =
        selectedTag === '全部' ||
        article.category === selectedTag ||
        (article.tags || []).includes(selectedTag);
      return matchesSearch && matchesCategory && matchesTag;
    });
  }, [searchTerm, selectedCategory, selectedTag]);

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
            {allTags.length > 0 && (
              <div className="articles-filters__tags">
                <button
                  className={`articles-filters__tag ${selectedTag === '全部' ? 'articles-filters__tag--active' : ''}`}
                  onClick={() => setSelectedTag('全部')}
                >
                  全部标签
                </button>
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    className={`articles-filters__tag ${selectedTag === tag ? 'articles-filters__tag--active' : ''}`}
                    onClick={() => setSelectedTag(tag)}
                  >
                    <Tag size={12} /> {tag}
                  </button>
                ))}
              </div>
            )}
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
            {filtered.map((article) => {
              const hasUrl = !!article.url;
              const trackClick = () =>
                trackEvent('article_click', {
                  article_id: article.id,
                  article_title: article.title,
                  article_category: article.category,
                  source: 'articles_list',
                  target: hasUrl ? 'wechat' : 'detail',
                });

              const cardInner = (
                <>
                  {/* 封面图 */}
                  <div className="article-card__cover">
                    {article.coverImage ? (
                      <CoverImage
                        src={article.coverImage}
                        alt={article.title}
                        className="article-card__cover-img"
                      />
                    ) : (
                      <div className="article-card__cover-placeholder">
                        <FileText size={28} />
                      </div>
                    )}
                  </div>
                  <div className="article-card__body">
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
                        <Clock size={14} />
                        <span>{article.date}</span>
                      </span>
                      <span className="article-card__link">
                        阅读全文 <ArrowRight size={14} />
                      </span>
                    </div>
                  </div>
                </>
              );

              return hasUrl ? (
                <a
                  key={article.id}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="article-card card"
                  onClick={trackClick}
                >
                  {cardInner}
                </a>
              ) : (
                <Link
                  key={article.id}
                  to={`/article/${article.id}`}
                  className="article-card card"
                  onClick={trackClick}
                >
                  {cardInner}
                </Link>
              );
            })}
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

      {/* 查询助手对话窗口 */}
      <ArticleChat />
    </div>
  );
}
