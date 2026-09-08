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
   代替原先的横向滚动胶囊条：屏幕边缘一颗小圆，点开后板块以弧形
   转盘（圆心在屏幕之外，只露出朝向页面内侧的一段弧）排开。手指沿
   弧的切线方向拖动即转动整个圆，带惯性甩动与吸附；「焦点位」的板块
   被放大高亮，点任意板块即跳转并收起。因为是闭环，最后一个到第一个
   只需反向转一点，没有横条「划到头」的死角 —— 两个方向都是最短路径。

   小圆本身可以按住拖走：松手后吸附到最近的一条屏幕边（左 / 右 / 上 /
   下），位置记在 localStorage 里。转盘的朝向跟着停靠边走：
     停左边 → 露右半圆，  停右边 → 露左半圆，
     停上边 → 露下半圆，  停下边 → 露上半圆。
   ------------------------------------------------------------
   板块顺序仍必须与电脑端 InternalSidebar 保持一致（日常管理 / 成员 /
   管理 三段，段内严格 follow InternalSidebar.jsx 的 dailyItems /
   memberItems / adminItems）。修改侧边栏顺序时这里也要一并同步。
   ============================================================ */

// 转盘几何常量（单位 px / 角度）。圆心在屏幕外，半径 R，只露出朝页面
// 内侧的一段弧。R 调大弧更平缓/更铺开，调小则更收紧。
const DIAL_R = 190;
// 焦点板块（弧正中、放大高亮那一个）中心距小圆中心的距离，沿「向内」方向
const DIAL_FOCUS_GAP = 66;
// 焦点位沿「弧的走向」离屏幕两端至少留这么多：小圆停在靠近某个角时，
// 弧不至于一半糊在屏幕外（小圆本身仍停在用户放的位置，只有弧稍微往里挪）
const DIAL_ARC_PAD = 96;

// 小圆几何：直径 54，离边 12 => 停靠时圆心距边 39
const TRIG_RADIUS = 27;
const TRIG_EDGE_GAP = 12;
const TRIG_INSET = TRIG_EDGE_GAP + TRIG_RADIUS;
// 沿边方向再多留一点，避免小圆正好卡在屏幕四角
const TRIG_CORNER_PAD = TRIG_INSET + 24;

const DOCK_KEY = 'riemer.mdial.dock';

// 每条停靠边对应的「向内」单位向量（屏幕坐标系，y 轴向下）：
// 焦点位在小圆的这个方向上，圆心则在反方向（屏幕外）。
const SIDE_INWARD = {
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
  top: { x: 0, y: 1 },
  bottom: { x: 0, y: -1 },
};

// 浮层的极轻渐隐从哪一侧起（把转盘那半边稍微压暗一点托住字块）
const SIDE_FADE = {
  left: 'to right',
  right: 'to left',
  top: 'to bottom',
  bottom: 'to top',
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 角度归一到 (-180, 180]，用来判断某板块离焦点位多远
function normDeg(d) {
  d %= 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

function loadDock() {
  try {
    const raw = localStorage.getItem(DOCK_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (SIDE_INWARD[d?.side] && Number.isFinite(d?.t)) {
        return { side: d.side, t: clamp(d.t, 0, 1) };
      }
    }
  } catch {
    /* localStorage 不可用（隐私模式等）时用默认停靠即可 */
  }
  return { side: 'left', t: 0.5 };
}

// 停靠描述（边 + 沿边比例）=> 小圆圆心的视口坐标
function dockToPoint(dock, vp) {
  if (dock.side === 'left' || dock.side === 'right') {
    const span = Math.max(0, vp.h - TRIG_CORNER_PAD * 2);
    return {
      x: dock.side === 'left' ? TRIG_INSET : vp.w - TRIG_INSET,
      y: TRIG_CORNER_PAD + dock.t * span,
    };
  }
  const span = Math.max(0, vp.w - TRIG_CORNER_PAD * 2);
  return {
    x: TRIG_CORNER_PAD + dock.t * span,
    y: dock.side === 'top' ? TRIG_INSET : vp.h - TRIG_INSET,
  };
}

// 松手位置 => 最近的一条边（四边里取距离最小的），并记下沿边比例
function pointToDock(p, vp) {
  const dists = [
    ['left', p.x],
    ['right', vp.w - p.x],
    ['top', p.y],
    ['bottom', vp.h - p.y],
  ];
  const side = dists.reduce((a, b) => (b[1] < a[1] ? b : a))[0];
  if (side === 'left' || side === 'right') {
    const span = Math.max(1, vp.h - TRIG_CORNER_PAD * 2);
    return { side, t: clamp((p.y - TRIG_CORNER_PAD) / span, 0, 1) };
  }
  const span = Math.max(1, vp.w - TRIG_CORNER_PAD * 2);
  return { side, t: clamp((p.x - TRIG_CORNER_PAD) / span, 0, 1) };
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
  const dragRef = useRef(null); // 转盘拖拽过程态：{start*,startAngle,last*,lastT,vel,moved,onEmpty}
  const rafRef = useRef(0);
  const suppressClickRef = useRef(false); // 拖动后抑制误触发的 click 跳转

  // ---- 小圆的停靠位置（可拖动，落点吸附到最近的边并记住） ----
  const [vp, setVp] = useState(() => ({
    w: typeof window === 'undefined' ? 375 : window.innerWidth,
    h: typeof window === 'undefined' ? 667 : window.innerHeight,
  }));
  const [dock, setDock] = useState(loadDock);
  const [dragPos, setDragPos] = useState(null); // 拖动小圆时的自由位置；null = 已停靠
  const dragPosRef = useRef(null);
  const trigDragRef = useRef(null);
  const suppressTrigClickRef = useRef(false);

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  const anchor = dragPos || dockToPoint(dock, vp);
  const inward = SIDE_INWARD[dock.side];
  const isVerticalArc = dock.side === 'left' || dock.side === 'right';
  // 焦点位（弧正中）：从小圆位置沿「向内」推出去，再沿弧的走向往屏幕里收一点
  const focusX = isVerticalArc
    ? anchor.x + inward.x * DIAL_FOCUS_GAP
    : clamp(anchor.x, DIAL_ARC_PAD, Math.max(DIAL_ARC_PAD, vp.w - DIAL_ARC_PAD));
  const focusY = isVerticalArc
    ? clamp(anchor.y, DIAL_ARC_PAD, Math.max(DIAL_ARC_PAD, vp.h - DIAL_ARC_PAD))
    : anchor.y + inward.y * DIAL_FOCUS_GAP;
  // 圆心：焦点位沿「向外」再推一个半径，落在屏幕外
  const cx = focusX - inward.x * DIAL_R;
  const cy = focusY - inward.y * DIAL_R;
  // 焦点位处的切线方向（θ 变大时板块移动的方向）= 向内向量转 90°
  const tanX = -inward.y;
  const tanY = inward.x;

  const degPerPx = (180 / Math.PI) / DIAL_R; // 沿弧 1:1 手感：拖 d px ↔ 转 d*degPerPx 度

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

  // ---- 拖动小圆本体：按住拖到任意位置，松手吸附到最近的一条边 ----
  const onTrigPointerDown = useCallback((e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    suppressTrigClickRef.current = false;
    trigDragRef.current = {
      x0: e.clientX,
      y0: e.clientY,
      base: dragPos || dockToPoint(dock, vp),
      moved: false,
    };
  }, [dock, vp, dragPos]);

  const onTrigPointerMove = useCallback((e) => {
    const d = trigDragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.moved && Math.hypot(dx, dy) < 8) return; // 阈值内当作「点一下」，不算拖
    d.moved = true;
    const p = {
      x: clamp(d.base.x + dx, TRIG_INSET, vp.w - TRIG_INSET),
      y: clamp(d.base.y + dy, TRIG_INSET, vp.h - TRIG_INSET),
    };
    dragPosRef.current = p;
    setDragPos(p);
  }, [vp]);

  const onTrigPointerUp = useCallback(() => {
    const d = trigDragRef.current;
    trigDragRef.current = null;
    if (!d || !d.moved) return; // 没动 => 交给 click 打开转盘
    suppressTrigClickRef.current = true; // 刚拖过，这次抬手后的 click 不算点击
    const next = pointToDock(dragPosRef.current || d.base, vp);
    setDock(next);
    setDragPos(null); // 回到停靠位（CSS transition 负责吸附动画）
    dragPosRef.current = null;
    try {
      localStorage.setItem(DOCK_KEY, JSON.stringify(next));
    } catch {
      /* 存不下就算了，本次会话内仍然生效 */
    }
  }, [vp]);

  const onTrigClick = useCallback(() => {
    if (suppressTrigClickRef.current) {
      suppressTrigClickRef.current = false;
      return;
    }
    openDial();
  }, [openDial]);

  // 松手后吸附：把最接近焦点位的板块精确对齐到焦点位
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
      startY: e.clientY,
      startAngle: angleRef.current,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: performance.now(),
      vel: 0,
      moved: 0,
      // 按在空白处（不是某个板块）=> 抬手时算「点外面」，收起转盘
      onEmpty: e.target === stageRef.current,
    };
  }, []);

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d) return;
    // 沿弧的切线方向取位移：左右停靠时是纵向拖，上下停靠时是横向拖
    const along = (e.clientX - d.startX) * tanX + (e.clientY - d.startY) * tanY;
    d.moved = Math.max(d.moved, Math.abs(along));
    const now = performance.now();
    const inst = (e.clientX - d.lastX) * tanX + (e.clientY - d.lastY) * tanY;
    const dt = now - d.lastT || 16;
    d.vel = (inst * degPerPx) / dt; // 瞬时角速度（度/ms），供惯性使用
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    d.lastT = now;
    setAngleBoth(d.startAngle + along * degPerPx);
  }, [degPerPx, setAngleBoth, tanX, tanY]);

  const onPointerUp = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    suppressClickRef.current = d.moved > 8; // 拖动过 => 这次抬手后的 click 不算点选
    if (d.onEmpty && d.moved <= 8) {
      closeDial(); // 点转盘外的空白处 => 收起
      return;
    }
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
  }, [snap, setAngleBoth, closeDial]);

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
      {/* 入口小圆：显示当前板块图标 + 名称；可按住拖到任意一条边；打开转盘时隐藏。
          编辑态下整体隐藏：那时点它也不会展开（底部让给编辑工具条），
          留着反而会和停在下边时的工具条叠在一起。 */}
      {!open && !editing && (
        <button
          type="button"
          className={
            'mdial-trigger mdial-trigger--' + dock.side +
            (dragPos ? ' mdial-trigger--dragging' : '')
          }
          style={{ left: anchor.x, top: anchor.y }}
          onPointerDown={onTrigPointerDown}
          onPointerMove={onTrigPointerMove}
          onPointerUp={onTrigPointerUp}
          onPointerCancel={onTrigPointerUp}
          onClick={onTrigClick}
          aria-label="打开板块转盘（可按住拖到屏幕任意一边）"
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
      )}

      {open && (
        <div
          className="mdial-overlay"
          style={{ '--mdial-fade': SIDE_FADE[dock.side] }}
          role="dialog"
          aria-label="板块转盘"
        >
          {/* 关闭方式：点转盘外的空白处 / 点任意板块 / 按 Esc，无需专门按钮 */}
          <div
            className={'mdial-stage mdial-stage--' + dock.side}
            ref={stageRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {navItems.map((item, i) => {
              const theta = normDeg(i * STEP + angle); // 该板块当前相对焦点位的角度
              const rad = (theta * Math.PI) / 180;
              const cos = Math.cos(rad); // 「靠近焦点」程度：1=焦点，0=弧的两端
              if (cos <= 0.04) return null; // 转到圆背面（屏幕外那半圆），不渲染
              const sin = Math.sin(rad);
              // 「向内」向量绕圆心转 theta 度后的落点（屏幕坐标系，y 向下）
              const x = cx + DIAL_R * (inward.x * cos - inward.y * sin);
              const y = cy + DIAL_R * (inward.x * sin + inward.y * cos);
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
