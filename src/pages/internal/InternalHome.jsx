import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationContext';
import {
  ArrowRight,
} from 'lucide-react';
import { documentsData, initialTasks } from '../../data/siteData';
import './InternalHome.css';

const typeConfig = {
  reminder: { color: '#F39C12' },
  info: { color: '#5EAD8C' },
  system: { color: '#8B5CF6' },
};

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}月${day}日`;
}

const ROLE_LABELS = { admin: '管理员', member: '成员' };

export default function InternalHome() {
  const { user, isAuthenticated, isAdmin } = useAuth();
  const { notifications, unreadCount } = useNotifications();
  const navigate = useNavigate();

  // 统计数据
  const stats = useMemo(() => {
    const todoTasks = initialTasks.filter((t) => t.status === '规划中' || t.status === '进行中').length;
    const totalDocs = documentsData.length;
    return { unreadCount, todoTasks, totalDocs };
  }, [unreadCount]);

  // 最近通知（取前 4 条）
  const recentNotifications = useMemo(() => {
    return notifications.slice(0, 4);
  }, [notifications]);

  if (!isAuthenticated) {
    return null;
  }

  const today = new Date();
  const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const weekday = weekdays[today.getDay()];

  const modules = [
    {
      name: '消息通知',
      desc: '查看团队通知、系统提醒和重要消息',
      path: '/internal/notifications',
      badge: unreadCount > 0 ? unreadCount : null,
    },
    {
      name: '文档管理',
      desc: '上传、查看和管理团队内部文档资料',
      path: '/internal/documents',
    },
    {
      name: '事项追踪',
      desc: '跟踪待办事项、分配任务和查看进度',
      path: '/internal/tasks',
    },
    {
      name: '成员相册',
      desc: '浏览和上传活动照片，记录每次相聚的美好瞬间',
      path: '/internal/gallery',
    },
    ...(isAdmin
      ? [
          {
            name: '用户管理',
            desc: '管理成员账号、授权与角色分配',
            path: '/internal/users',
            adminOnly: true,
          },
          {
            name: '内容管理',
            desc: '编辑网站首页、时间线等公开内容',
            path: '/internal/content',
            adminOnly: true,
          },
        ]
      : []),
  ];

  return (
    <div className="internal-home">
      <div className="container">
        {/* 欢迎区 */}
        <div className="internal-home__welcome">
          <div className="internal-home__welcome-card">
            <h1 className="internal-home__greeting">
              RIEMer Land
            </h1>
            <p className="internal-home__welcome-sub">
              {getGreeting()}，{user?.name}。欢迎回到内部空间 ✨
            </p>
            <div className="internal-home__welcome-meta">
              <span className="internal-home__welcome-meta-item">
                {dateStr} {weekday}
              </span>
              {unreadCount > 0 && (
                <span className="internal-home__welcome-meta-item internal-home__welcome-meta-item--unread">
                  {unreadCount} 条未读消息
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 快速统计 */}
        <div className="internal-home__stats">
          <div className="internal-home__stat-card" onClick={() => navigate('/internal/notifications')} style={{ cursor: 'pointer' }}>
            <div className="internal-home__stat-info">
              <div className="internal-home__stat-value">{stats.unreadCount}</div>
              <div className="internal-home__stat-label">未读消息</div>
            </div>
          </div>
          <div className="internal-home__stat-card" onClick={() => navigate('/internal/tasks')} style={{ cursor: 'pointer' }}>
            <div className="internal-home__stat-info">
              <div className="internal-home__stat-value">{stats.todoTasks}</div>
              <div className="internal-home__stat-label">待办事项</div>
            </div>
          </div>
          <div className="internal-home__stat-card" onClick={() => navigate('/internal/documents')} style={{ cursor: 'pointer' }}>
            <div className="internal-home__stat-info">
              <div className="internal-home__stat-value">{stats.totalDocs}</div>
              <div className="internal-home__stat-label">文档资料</div>
            </div>
          </div>
          <div className="internal-home__stat-card">
            <div className="internal-home__stat-info">
              <div className="internal-home__stat-value">{ROLE_LABELS[user?.role] || '成员'}</div>
              <div className="internal-home__stat-label">当前角色</div>
            </div>
          </div>
        </div>

        {/* 功能模块 */}
        <h2 className="internal-home__section-title">
          功能模块
        </h2>
        <div className="internal-home__modules">
          {modules.map((mod) => {
            return (
              <Link
                key={mod.path}
                to={mod.path}
                className="internal-home__module-card"
              >
                <div className="internal-home__module-content">
                  <div className="internal-home__module-name">
                    {mod.name}
                    {mod.badge && (
                      <span className="internal-home__module-badge">{mod.badge}</span>
                    )}
                    {mod.adminOnly && (
                      <span className="internal-home__module-admin">管理员</span>
                    )}
                  </div>
                  <div className="internal-home__module-desc">{mod.desc}</div>
                </div>
                <div className="internal-home__module-arrow">
                  <ArrowRight size={18} />
                </div>
              </Link>
            );
          })}
        </div>

        {/* 最近消息 */}
        <div className="internal-home__recent">
          <h2 className="internal-home__section-title">
            最近消息
          </h2>
          <div className="internal-home__recent-list">
            {recentNotifications.length > 0 ? (
              recentNotifications.map((notif) => {
                const config = typeConfig[notif.type] || typeConfig.info;
                return (
                  <div
                    key={notif.id}
                    className={`internal-home__recent-item ${!notif.read ? 'internal-home__recent-item--unread' : ''}`}
                  >
                    <div
                      className="internal-home__recent-dot"
                      style={{ background: config.color }}
                    />
                    <div className="internal-home__recent-body">
                      <div className="internal-home__recent-title">{notif.title}</div>
                      <div className="internal-home__recent-message">{notif.message}</div>
                    </div>
                    <span className="internal-home__recent-date">{formatDate(notif.date)}</span>
                  </div>
                );
              })
            ) : (
              <div className="internal-home__recent-empty">暂无消息</div>
            )}
          </div>
          {notifications.length > 0 && (
            <Link to="/internal/notifications" className="internal-home__view-all">
              查看全部消息 →
            </Link>
          )}
        </div>

        {/* 小提示 */}
        <div className="internal-home__tips">
          <div className="internal-home__tips-title">
            💡 小贴士
          </div>
          <div className="internal-home__tips-content">
            你可以通过顶部导航栏的「内部空间」随时回到这里。有新的消息或待办事项时，导航栏会显示提醒标记。
          </div>
        </div>
      </div>
    </div>
  );
}
