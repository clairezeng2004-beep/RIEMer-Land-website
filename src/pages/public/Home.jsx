import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Clock,
  MapPin,
  Calendar,
} from 'lucide-react';
import { articlesData, eventsData } from '../../data/siteData';
import { useSiteContent } from '../../contexts/SiteContentContext';
import './Home.css';

export default function Home() {
  const { content, userArticles } = useSiteContent();

  // 合并硬编码文章和用户添加的文章，按日期降序排列
  const allArticles = [...userArticles, ...articlesData]
    .sort((a, b) => b.date.localeCompare(a.date));
  const recentArticles = allArticles.slice(0, 4);
  const recentEvents = eventsData.slice(0, 4);

  return (
    <div className="home">
      {/* Hero Section — 与 Articles / Timeline 保持一致的简洁风格 */}
      <section className="hero">
        <div className="hero__content container">
          <h1 className="hero__title">
            <span className="hero__title-accent">{content.heroTitle}</span>
          </h1>
          <p className="hero__subtitle">{content.heroDescription}</p>
        </div>
      </section>


      {/* Stats Section */}
      <section className="stats section">
        <div className="container">
          <div className="stats__grid">
            {content.stats.map((stat, i) => (
              <div key={i} className="stats__item">
                <div className="stats__value">{stat.value}</div>
                <div className="stats__label">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Articles */}
      <section className="featured section">
        <div className="container">
          <div className="featured__header">
            <h2 className="section-title">{content.articlesSectionTitle}</h2>
          </div>
          <div className="featured__grid">
            {recentArticles.map((article) => (
              <Link
                key={article.id}
                to={`/article/${article.id}`}
                className="featured__card"
              >
                <div className="featured__card-accent" />
                <div className="featured__card-body">
                  <div className="featured__card-top">
                    <span className="featured__category">{article.category}</span>
                  </div>
                  <h3 className="featured__title">{article.title}</h3>
                  <p className="featured__excerpt">{article.excerpt}</p>
                  <div className="featured__meta">
                    <span className="featured__meta-item">
                      <Clock size={14} />
                      {article.date}
                    </span>
                  </div>
                  <div className="featured__read-more">
                    阅读全文 <ArrowRight size={14} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <div className="featured__more">
            <Link to="/articles" className="btn btn-secondary">
              查看全部文章 <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* Latest Events */}
      <section className="featured section section--compact">
        <div className="container">
          <div className="featured__header">
            <h2 className="section-title">最新活动</h2>
          </div>
          <div className="featured__grid">
            {recentEvents.map((event) => (
              <div key={event.id} className="featured__card">
                <div className="featured__card-accent" />
                <div className="featured__card-body">
                  <div className="featured__card-top">
                    <span className="featured__category">{event.category}</span>
                  </div>
                  <h3 className="featured__title">{event.title}</h3>
                  <p className="featured__excerpt">{event.excerpt}</p>
                  <div className="featured__meta">
                    <span className="featured__meta-item">
                      <Calendar size={14} />
                      {event.date}
                    </span>

                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>


    </div>
  );
}
