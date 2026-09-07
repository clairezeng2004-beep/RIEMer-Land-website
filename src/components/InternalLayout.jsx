import { Suspense, useEffect, useState, useRef, useCallback } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { RotateCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import { useSiteContent } from '../contexts/SiteContentContext';
import { WysiwygProvider, useWysiwyg } from '../contexts/WysiwygContext';
import InternalSidebar from './InternalSidebar';
import WysiwygToolbar from './WysiwygToolbar';
import ErrorBoundary from './ErrorBoundary';
import {
  Bell, BellRing, FolderOpen, Share2, BookOpen, CheckSquare,
  Camera, BarChart3, MessageSquarePlus, MessageCircle, UserCircle, Contact,
  Users, Settings, CalendarRange, Activity,
  Trash2, HardDrive,
} from 'lucide-react';
import './InternalLayout.css';

function InternalPageFallback() {
  return (
    <div className="internal-page-fallback" aria-label="页面加载中">
      <div className="internal-page-fallback__header">
        <div>
          <div className="internal-page-fallback__title" />
          <div className="internal-page-fallback__desc" />
        </div>
        <div className="internal-page-fallback__button" />
      </div>
      <div className="internal-page-fallback__content">
        <div className="internal-page-fallback__bar" />
        <div className="internal-page-fallback__grid">
          <div />
          <div />
          <div />
          <div />
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   手机端「转盘导航」（MobileDialNav）
   ------------------------------------------------------------
   代替原先的横向滚动胶囊条：底部居中一颗小圆，点开后板块以弧形
   转盘（圆心在屏幕下方之外，只露出顶部一段弧）排开。手指左右拖动
   转动整个圆，带惯性甩动与吸附；顶部中央「焦点位」的板块被放大高亮，
   点任意板块即跳转并收起。因为是闭环，最后一个到第一个只需反向转一点，
   没有横条「划到头」的死角 —— 两个方向都是最短路径。
   ------------------------------------------------------------
   板块顺序仍必须与电脑端 InternalSidebar 保持一致（日常管理 / 成员 /
   管理 三段，段内严格 follow InternalSidebar.jsx 的 dailyItems /
   memberItems / adminItems）。修改侧边栏顺序时这里也要一并同步。
   ============================================================ */

// 转盘几何常量（单位 px / 角度）。圆心在 stage 顶部下方 CY 处、半径 R，
// 顶部一段弧露在 stage（高度 STAGE_H）里；R 调大弧更平缓/更铺开，
// 调小则弧更收紧、字块更聚拢。
const DIAL_R = 200;
const DIAL_CY = 212; // 圆心距 stage 顶的距离；焦点板块 y ≈ CY - R = 12
const DIAL_STAGE_H = 150;

// 角度归一到 (-180, 180]，用来判断某板块离「12 点焦点位」多远
function normDeg(d) {
  d %= 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

function MobileDialNav() {
  const { unreadCount } = useNotifications();
  const { internalConfig } = useSiteContent();
  const { isAdmin } = useAuth();
  const { editing } = useWysiwyg();
  const sc = internalConfig.sidebar || {};
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    // 日常管理（对齐 InternalSidebar.dailyItems）
    { to: '/internal/tasks', icon: CheckSquare, label: sc.labelTasks },
    { to: '/internal/notifications', icon: Bell, label: sc.labelNotifications, badge: unreadCount > 0 ? unreadCount : null },
    { to: '/internal/process-templates', icon: FolderOpen, label: sc.labelProcessTemplates },
    { to: '/internal/articles', icon: BookOpen, label: sc.labelArticles },
    { to: '/internal/event-publish', icon: CalendarRange, label: sc.labelEventPublish },
    { to: '/internal/contributions', icon: BarChart3, label: sc.labelContributions },
    { to: '/internal/guestbook', icon: MessageCircle, label: sc.labelGuestbook },
    // 成员（对齐 InternalSidebar.memberItems：内部分享 → 内部资料 → 通讯录 → 建设建议 → 互动相册 → 个人主页）
    { to: '/internal/member-sharing', icon: Share2, label: sc.labelMemberSharing },
    { to: '/internal/internal-files', icon: HardDrive, label: sc.labelInternalFiles },
    { to: '/internal/member-profiles', icon: Contact, label: sc.labelMemberProfiles },
    { to: '/internal/suggestions', icon: MessageSquarePlus, label: sc.labelSuggestions },
    { to: '/internal/gallery', icon: Camera, label: sc.labelGallery },
    { to: '/internal/profile', icon: UserCircle, label: sc.labelProfile },
    // 管理（对齐 InternalSidebar.adminItems）
    { to: '/internal/users', icon: Users, label: sc.labelUsers },
    { to: '/internal/content', icon: Settings, label: sc.labelContent },
    { to: '/internal/notification-management', icon: BellRing, label: sc.labelNotificationMgmt },
    { to: '/internal/recycle-bin', icon: Trash2, label: '回收站' },
    // 同步诊断：仅管理员可见
    ...(isAdmin ? [
      { to: '/internal/sync-diagnostic', icon: Activity, label: '同步诊断' },
    ] : []),
  ];

  const N = navItems.length;
  const STEP = 360 / N; // 相邻板块的角间距，能整除 360 => 闭环无缝、可无限循环

  // 当前路由对应的板块下标（找不到时落在 0，避免转盘空转）
  const activeIndex = Math.max(
    0,
    navItems.findIndex(
      (it) => location.pathname === it.to || location.pathname.startsWith(it.to + '/')
    )
  );

  const [open, setOpen] = useState(false);
  const [angle, setAngle] = useState(0); // 转盘整体旋转角（度）
  const angleRef = useRef(0);
  const stageRef = useRef(null);
  const dragRef = useRef(null); // 拖拽过程态：{startX,startAngle,lastX,lastT,vel,moved}
  const rafRef = useRef(0);
  const suppressClickRef = useRef(false); // 拖动后抑制误触发的 click 跳转

  const degPerPx = (180 / Math.PI) / DIAL_R; // 沿弧 1:1 手感：拖 dx px ↔ 转 dx*degPerPx 度

  const setAngleBoth = useCallback((a) => {
    angleRef.current = a;
    setAngle(a);
  }, []);

  // 打开转盘：先把当前板块转到焦点位（θ=0），让用户一眼看到「我在哪」
  const openDial = useCallback(() => {
    if (editing) return; // 编辑态下不劫持底部，交给编辑工具条
    const a = -(activeIndex * STEP);
    setAngleBoth(a);
    suppressClickRef.current = false;
    setOpen(true);
  }, [activeIndex, STEP, setAngleBoth, editing]);

  const closeDial = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setOpen(false);
  }, []);

  // 松手后吸附：把最接近焦点位的板块精确对齐到 12 点
  const snap = useCallback(() => {
    const target = Math.round(angleRef.current / STEP) * STEP;
    const start = angleRef.current;
    const t0 = performance.now();
    const dur = 220;
    const anim = () => {
      const p = Math.min(1, (performance.now() - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setAngleBoth(start + (target - start) * e);
      if (p < 1) rafRef.current = requestAnimationFrame(anim);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(anim);
  }, [STEP, setAngleBoth]);

  const onPointerDown = useCallback((e) => {
    cancelAnimationFrame(rafRef.current);
    stageRef.current?.setPointerCapture?.(e.pointerId);
    suppressClickRef.current = false;
    dragRef.current = {
      startX: e.clientX,
      startAngle: angleRef.current,
      lastX: e.clientX,
      lastT: performance.now(),
      vel: 0,
      moved: 0,
    };
  }, []);

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    d.moved = Math.max(d.moved, Math.abs(dx));
    const now = performance.now();
    const dxInst = e.clientX - d.lastX;
    const dt = now - d.lastT || 16;
    d.vel = (dxInst * degPerPx) / dt; // 瞬时角速度（度/ms），供惯性使用
    d.lastX = e.clientX;
    d.lastT = now;
    setAngleBoth(d.startAngle + dx * degPerPx);
  }, [degPerPx, setAngleBoth]);

  const onPointerUp = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    suppressClickRef.current = d.moved > 8; // 拖动过 => 这次抬手后的 click 不算点选
    let vel = d.vel;
    const decay = 0.95;
    let last = performance.now();
    const step = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      vel *= Math.pow(decay, dt / 16);
      if (Math.abs(vel) < 0.003) {
        snap();
        return;
      }
      setAngleBoth(angleRef.current + vel * dt);
      rafRef.current = requestAnimationFrame(step);
    };
    if (Math.abs(vel) > 0.01) {
      rafRef.current = requestAnimationFrame(step);
    } else {
      snap();
    }
  }, [snap, setAngleBoth]);

  const onChipClick = useCallback((item) => {
    if (suppressClickRef.current) return; // 刚才是拖动，不跳转
    navigate(item.to);
    closeDial();
  }, [navigate, closeDial]);

  // 打开时锁背景滚动 + 支持 Esc 关闭
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') closeDial(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      cancelAnimationFrame(rafRef.current);
    };
  }, [open, closeDial]);

  const activeItem = navItems[activeIndex];
  const ActiveIcon = activeItem?.icon || RotateCw;

  return (
    <div className="mdial">
      {/* 入口小圆：显示当前板块图标 + 名称 */}
      <button
        type="button"
        className="mdial-trigger"
        onClick={openDial}
        aria-label="打开板块转盘"
        aria-expanded={open}
      >
        <span className="mdial-trigger__ring">
          <ActiveIcon size={22} />
          {unreadCount > 0 && activeItem?.to !== '/internal/notifications' && (
            <span className="mdial-trigger__dot" />
          )}
        </span>
        <span className="mdial-trigger__label">{activeItem?.label || '板块'}</span>
      </button>

      {open && (
        <div className="mdial-overlay" onPointerDown={closeDial}>
          <div
            className="mdial-panel"
            onPointerDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="板块转盘"
          >
            {/* 关闭方式：点转盘外的空白处 / 点任意板块 / 按 Esc，无需专门按钮 */}
            <div
              className="mdial-stage"
              ref={stageRef}
              style={{ height: DIAL_STAGE_H }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {/* 焦点指针（12 点方向），标记「转到这里即选中」 */}
              <span className="mdial-stage__pointer" />

              {navItems.map((item, i) => {
                const theta = normDeg(i * STEP + angle); // 该板块当前相对焦点位的角度
                const rad = (theta * Math.PI) / 180;
                const cos = Math.cos(rad);
                if (cos <= 0.04) return null; // 转到圆背面，不渲染
                const x = DIAL_R * Math.sin(rad);
                const y = DIAL_CY - DIAL_R * cos; // 距 stage 顶的 y
                const opacity = Math.max(0, Math.min(1, (cos - 0.26) / 0.74));
                const scale = 0.72 + 0.28 * cos;
                const isFocus = Math.abs(theta) < STEP / 2; // 落在焦点位
                const isCurrent = i === activeIndex; // 当前所在板块
                const Icon = item.icon;
                return (
                  <button
                    type="button"
                    key={item.to}
                    className={
                      'mdial-chip' +
                      (isFocus ? ' mdial-chip--focus' : '') +
                      (isCurrent ? ' mdial-chip--current' : '')
                    }
                    style={{
                      transform: `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale})`,
                      opacity,
                      zIndex: Math.round(cos * 100),
                    }}
                    onClick={() => onChipClick(item)}
                  >
                    <Icon size={16} className="mdial-chip__icon" />
                    <span className="mdial-chip__label">{item.label}</span>
                    {item.badge && <span className="mdial-chip__badge">{item.badge}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function InternalLayout() {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();
  const [loadingTimeout, setLoadingTimeout] = useState(false);

  // 每次路由变化时立即跳到页面顶部（覆盖 CSS smooth 滚动）
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname]);

  // loading 超时保护：15 秒后强制结束等待
  // initSession 内部有独立超时（getSession 5s + refreshSession 5s + 健康检查 3s ≈ 13s），
  // 这里留 15s 作为最终兜底
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => {
      console.warn('[InternalLayout] Loading 超时（15s），结束等待');
      setLoadingTimeout(true);
    }, 15000);
    return () => clearTimeout(timer);
  }, [loading]);

  if (loading && !loadingTimeout) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        gap: '16px',
        color: 'var(--color-text-muted, #888)',
      }}>
        <div style={{
          width: '32px',
          height: '32px',
          border: '3px solid var(--color-border-light, #e5e5e5)',
          borderTop: '3px solid var(--color-primary, #5B8C3E)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <span style={{ fontSize: '14px' }}>正在验证登录状态…</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <WysiwygProvider>
      <div className="internal-layout">
        <InternalSidebar />
        <MobileDialNav />
        <div className="internal-layout__content">
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<InternalPageFallback />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </div>
        <WysiwygToolbar />
      </div>
    </WysiwygProvider>
  );
}
