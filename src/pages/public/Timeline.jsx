import { useState } from 'react';
import { Clock, Star, ChevronDown } from 'lucide-react';
import { timelineData } from '../../data/siteData';
import './Timeline.css';

export default function Timeline() {
  const [expandedYear, setExpandedYear] = useState(null);

  // Group by year
  const groupedByYear = timelineData.reduce((acc, item) => {
    if (!acc[item.year]) acc[item.year] = [];
    acc[item.year].push(item);
    return acc;
  }, {});

  const years = Object.keys(groupedByYear).sort((a, b) => b - a);

  return (
    <div className="timeline-page">
      {/* Hero */}
      <section className="timeline-hero">
        <div className="container">
          <div className="timeline-hero__content">
            <span className="badge badge-primary">
              <Clock size={12} /> 社团历史
            </span>
            <h1>时间轴</h1>
            <p>
              从一个读书小组到跨学科学术社区，
              回顾 RIEMer Land 走过的每一个重要时刻。
            </p>
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="timeline section">
        <div className="container">
          <div className="timeline__track">
            {timelineData.map((item, index) => {
              const isLeft = index % 2 === 0;
              return (
                <div
                  key={index}
                  className={`timeline__item ${isLeft ? 'timeline__item--left' : 'timeline__item--right'} ${
                    item.highlight ? 'timeline__item--highlight' : ''
                  }`}
                >
                  <div className="timeline__dot">
                    {item.highlight ? (
                      <Star size={14} className="timeline__star" />
                    ) : (
                      <div className="timeline__dot-inner" />
                    )}
                  </div>
                  <div className="timeline__card card">
                    <div className="timeline__year">{item.year}</div>
                    <h3 className="timeline__title">{item.title}</h3>
                    <p className="timeline__desc">{item.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
