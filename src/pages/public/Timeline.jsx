import { useRef, useState, useEffect, useCallback } from 'react';
import { Star, ChevronLeft, ChevronRight, User } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useSiteContent } from '../../contexts/SiteContentContext';
import './Timeline.css';

export default function Timeline() {
  const { timeline: timelineData } = useSiteContent();
  const trackRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const dragState = useRef({ startX: 0, scrollLeft: 0 });
  const [members, setMembers] = useState([]);

  // 加载成员数据
  useEffect(() => {
    const loadMembers = async () => {
      if (isSupabaseConfigured && supabase) {
        try {
          // 从 Supabase 获取所有已授权成员
          const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('id, name, nickname, avatar, signature, authorized')
            .eq('authorized', true);

          if (profilesError) {
            console.warn('[Timeline] profiles 查询失败:', profilesError.message);
          }

          const { data: memberProfiles, error: mpError } = await supabase
            .from('member_profiles')
            .select('user_id, enrollment_year');

          if (mpError) {
            console.warn('[Timeline] member_profiles 查询失败:', mpError.message);
          }

          if (profiles && profiles.length > 0) {
            const enrollmentMap = {};
            (memberProfiles || []).forEach((mp) => {
              enrollmentMap[mp.user_id] = mp.enrollment_year;
            });

            const formatted = profiles.map((p) => ({
              id: p.id,
              nickname: p.nickname || p.name || '匿名成员',
              avatar: p.avatar || null,
              signature: p.signature || '',
              enrollment_year: enrollmentMap[p.id] || '',
            }));
            setMembers(formatted);
            return;
          }
        } catch (err) {
          console.warn('[Timeline] Supabase 加载成员失败，回退本地:', err);
        }
      }

      // 本地模式
      const USERS_DB_KEY = 'riemer_users';
      const MEMBER_PROFILES_KEY = 'riemer_member_profiles';
      try {
        const usersRaw = localStorage.getItem(USERS_DB_KEY);
        const users = usersRaw ? JSON.parse(usersRaw) : [];
        const profilesRaw = localStorage.getItem(MEMBER_PROFILES_KEY);
        const localProfiles = profilesRaw ? JSON.parse(profilesRaw) : [];

        const enrollmentMap = {};
        localProfiles.forEach((p) => {
          enrollmentMap[p.user_id] = p.enrollment_year;
        });

        const authorizedUsers = users.filter((u) => u.authorized);
        const formatted = authorizedUsers.map((u) => ({
          id: u.id,
          nickname: u.nickname || u.name || '匿名成员',
          avatar: u.avatar || null,
          signature: u.signature || '',
          enrollment_year: enrollmentMap[u.id] || '',
        }));
        setMembers(formatted);
      } catch {
        setMembers([]);
      }
    };

    loadMembers();
  }, []);

  const checkScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 10);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener('scroll', checkScroll, { passive: true });
    window.addEventListener('resize', checkScroll);
    return () => {
      el.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [checkScroll]);

  const scroll = (direction) => {
    const el = trackRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.6;
    el.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  // 鼠标拖拽
  const handleMouseDown = (e) => {
    const el = trackRef.current;
    if (!el) return;
    setIsDragging(true);
    dragState.current = { startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft };
    el.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const el = trackRef.current;
    const x = e.pageX - el.offsetLeft;
    const walk = (x - dragState.current.startX) * 1.2;
    el.scrollLeft = dragState.current.scrollLeft - walk;
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    if (trackRef.current) trackRef.current.style.cursor = 'grab';
    document.body.style.userSelect = '';
    document.body.style.webkitUserSelect = '';
  };

  // 滚轮横向滚动 — 仅在明确的水平滚动意图时才拦截
  const handleWheel = (e) => {
    const el = trackRef.current;
    if (!el) return;

    const absX = Math.abs(e.deltaX);
    const absY = Math.abs(e.deltaY);

    // 触控板原生水平滑动：直接放行，浏览器会自动横向滚动
    if (absX > absY) return;

    // 垂直滚动占绝对主导（比例 > 3:1），视为正常上下滚页面，不拦截
    if (absY > absX * 3) return;

    // 介于两者之间的模糊地带（deltaY 与 deltaX 比较接近），
    // 且有一定幅度时才转为横向滚动
    if (absY > 4) {
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    }
  };

  return (
    <div className="timeline-page">
      {/* Hero */}
      <section className="timeline-hero">
        <div className="container">
          <div className="timeline-hero__content">
            <h1>关于我们</h1>
            <p>
              一个由学生自主创办的经验互助平台，
              回顾 RIEMer Land 走过的每一个重要时刻。
            </p>
          </div>
        </div>
      </section>

      {/* Horizontal Timeline */}
      <section className="timeline section">
        <div className="container timeline__container">
          {/* 左箭头 */}
          <button
            className={`timeline__arrow timeline__arrow--left ${canScrollLeft ? '' : 'timeline__arrow--hidden'}`}
            onClick={() => scroll('left')}
            aria-label="向左滚动"
          >
            <ChevronLeft size={24} />
          </button>

          {/* 时间轴轨道 */}
          <div
            className={`timeline__track ${isDragging ? 'timeline__track--dragging' : ''}`}
            ref={trackRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          >
            {/* 横线 */}
            <div className="timeline__line" />

            {timelineData.map((item, index) => (
              <div
                key={index}
                className={`timeline__item ${item.highlight ? 'timeline__item--highlight' : ''}`}
              >
                {/* 上方卡片（偶数）或下方卡片（奇数）*/}
                <div className={`timeline__card-wrapper ${index % 2 === 0 ? 'timeline__card-wrapper--top' : 'timeline__card-wrapper--bottom'}`}>
                  <div className="timeline__connector" />
                  <div className="timeline__card card">
                    <div className="timeline__year">{item.year}.{item.month.padStart(2, '0')}</div>
                    <h3 className="timeline__title">{item.title}</h3>
                    <p className="timeline__desc">{item.description}</p>
                  </div>
                </div>

                {/* 节点 */}
                <div className="timeline__dot">
                  {item.highlight ? (
                    <Star size={14} className="timeline__star" />
                  ) : (
                    <div className="timeline__dot-inner" />
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 右箭头 */}
          <button
            className={`timeline__arrow timeline__arrow--right ${canScrollRight ? '' : 'timeline__arrow--hidden'}`}
            onClick={() => scroll('right')}
            aria-label="向右滚动"
          >
            <ChevronRight size={24} />
          </button>

          {/* 滑动提示 */}
          <div className="timeline__hint">
            ← 左右滑动查看更多 →
          </div>
        </div>
      </section>

      {/* Members Section */}
      <section className="members section">
        <div className="container">
          {members.length > 0 ? (
            <div className="members__grid">
              {members.map((member) => (
                <div key={member.id} className="member-card card">
                  <div className="member-card__avatar">
                    {member.avatar ? (
                      <img src={member.avatar} alt={member.nickname} />
                    ) : (
                      <div className="member-card__avatar-placeholder">
                        <User size={32} />
                      </div>
                    )}
                  </div>
                  <div className="member-card__info">
                    <h3 className="member-card__name">{member.nickname}</h3>
                    {member.enrollment_year && (
                      <span className="member-card__year">{member.enrollment_year}级</span>
                    )}
                    {member.signature && (
                      <p className="member-card__signature">{member.signature}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="members__empty">
              <User size={40} />
              <p>暂无成员信息</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
