import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Search,
  Filter,
  ArrowRight,
  FileText,
  Tag,
  Calendar,
} from 'lucide-react';
import { articlesData } from '../../data/siteData';
import { pinyinMatch } from '../../utils/pinyinSearch';
import ArticleChat from '../../components/ArticleChat';
import './Articles.css';

export default function Articles() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');

  // 自动去掉标题中的系列名前缀
  const cleanTitle = (title) => {
    return title
      .replace(/^【[^】]+】\s*/, '')           // 【RIEMer Land】...
      .replace(/^听\s*RIEMer\s*说[｜|]\s*/, '') // 听 RIEMer 说｜...
      .replace(/^RIEMer\s*课程测评[｜|]\s*/, '') // RIEMer 课程测评｜...
      .replace(/^RIEMer['']?s?\s*Space\s*分享会[｜|]?\s*/, '') // RIEMer's Space 分享会...
      .replace(/^RIEMer\s*小记[｜|]\s*/, '')     // RIEMer 小记｜...
      .replace(/^RIEMer\s*Land[｜|]?\s*/, '');   // RIEMer Land...
  };

  const categories = useMemo(() => {
    const cats = [...new Set(articlesData.map((a) => a.category))];
    return ['全部', ...cats];
  }, []);

  const filtered = useMemo(() => {
    return articlesData.filter((article) => {
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
            <h1>文章索引</h1>
            <p>
              汇聚成员的学术思考与研究成果，覆盖多个学科领域。
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
                <div className="article-card__accent" />
                <div className="article-card__body">
                  <div className="article-card__top">
                    <div className="article-card__meta">
                      <Calendar size={14} />
                      <span>{article.date}</span>
                    </div>
                  </div>
                  <h3 className="article-card__title">{cleanTitle(article.title)}</h3>
                  <p className="article-card__excerpt">{article.excerpt}</p>
                  <div className="article-card__tags">
                    {article.tags.map((tag) => (
                      <span key={tag} className="article-card__tag">
                        <Tag size={12} /> {tag}
                      </span>
                    ))}
                  </div>
                  <div className="article-card__bottom">
                    <span className="article-card__link">
                      阅读 <ArrowRight size={14} />
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

      {/* 文章助手对话窗口 */}
      <ArticleChat />
    </div>
  );
}
