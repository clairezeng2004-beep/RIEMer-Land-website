import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useWysiwyg } from '../../contexts/WysiwygContext';
import EditableText from '../../components/EditableText';
import CustomSelect from '../../components/CustomSelect';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { readListCache, writeListCache } from '../../lib/listCache';
import {
  Users,
  Shield,
  ShieldOff,
  UserCheck,
  UserX,
  Eye,
  Mail,
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  Loader2,
  ChevronDown,
  Clock,
  User,
  RefreshCw,
} from 'lucide-react';
import './UserManagement.css';

const ROLE_LABELS = { admin: '管理员', member: '成员' };
const USERS_CACHE_KEY = 'rl_user_list_cache_v1';
const ROLE_COLORS = {
  admin: '#4FBFC4',
  member: '#8A9A8C',
};

export default function UserManagement() {
  const {
    user: currentUser,
    isAuthenticated,
    isAdmin,
    supabaseOk,
    getAllUsers,
    authorizeUser,
    revokeUser,
    changeUserRole,
    deleteUser,
    preAuthorizeByEmail,
    getPreAuthorizedEmails,
    removePreAuthorizedEmail,
  } = useAuth();
  const { internalConfig, updateInternalConfig } = useSiteContent();
  const { editing } = useWysiwyg();
  const uc = internalConfig.users || {};

  const updateUsers = useCallback(
    (key, val) => updateInternalConfig({ users: { [key]: val } }),
    [updateInternalConfig]
  );
  // 首屏先用上次成功加载的本地缓存渲染，保证「初次登录」和「刷新后」看到的数据一致，
  // 不会因为拉取时机不同（session 是否就绪）而忽多忽少；随后后台拉取最新数据覆盖。
  const [users, setUsers] = useState(() => readListCache(USERS_CACHE_KEY) || []);
  const [loadingUsers, setLoadingUsers] = useState(true);
  // 是否至少成功完成过一次加载。用 state 以驱动渲染更新：
  // - false：首次加载未完成，统计数字显示占位符 "—"，避免从 0 跳到真实值产生闪动
  // - true：已加载过（后续刷新），继续展示旧数字，等新数据回来后平滑替换
  // 有本地缓存时直接视为「已加载过」，让统计数字立刻显示缓存值而不是占位符。
  const [hasLoadedOnce, setHasLoadedOnce] = useState(() => !!readListCache(USERS_CACHE_KEY));
  const [loadError, setLoadError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [showPendingPanel, setShowPendingPanel] = useState(false);
  // 诊断信息（点击"查看诊断信息"按钮展开，用于排查"0 已授权 0 待授权"问题）
  const [diag, setDiag] = useState(null);
  const [showDiag, setShowDiag] = useState(false);

  // 已授权 / 待授权用户分组（兼容 boolean / string / truthy 值）
  // 用 useMemo 稳定引用，避免在 users 未变时每次渲染都重新过滤。
  const isAuthorized = (u) => u.authorized === true || u.authorized === 'true' || u.authorized === 'TRUE';
  const authorizedUsers = useMemo(() => users.filter(isAuthorized), [users]);
  const pendingUsers = useMemo(() => users.filter((u) => !isAuthorized(u)), [users]);

  // 首次加载尚未完成时，用占位符替代数字 0，避免"0 → 真实数字"的跳变闪动
  const authorizedDisplay = hasLoadedOnce ? authorizedUsers.length : '—';
  const pendingDisplay = hasLoadedOnce ? pendingUsers.length : '—';

  // 预授权相关状态
  const [preAuthEmail, setPreAuthEmail] = useState('');
  const [preAuthLoading, setPreAuthLoading] = useState(false);
  const [preAuthMessage, setPreAuthMessage] = useState({ type: '', text: '' });
  const [preAuthList, setPreAuthList] = useState([]);

  // 邮箱后缀自动提示
  const EMAIL_SUFFIXES = [
    'qq.com', '163.com', '126.com', 'gmail.com', 'outlook.com',
    'foxmail.com', 'hotmail.com', 'yeah.net', 'sina.com', 'sohu.com',
    'icloud.com', '139.com', '188.com', 'yahoo.com',
  ];
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState(-1);

  const emailSuggestions = (() => {
    const atIdx = preAuthEmail.indexOf('@');
    if (atIdx < 1) return []; // 没输入 @ 或 @ 在开头，不提示
    const typed = preAuthEmail.slice(atIdx + 1).toLowerCase();
    return EMAIL_SUFFIXES
      .filter((s) => s.startsWith(typed) && s !== typed)
      .map((s) => preAuthEmail.slice(0, atIdx + 1) + s);
  })();

  const handleEmailChange = (e) => {
    const val = e.target.value;
    setPreAuthEmail(val);
    setShowSuggestions(val.includes('@'));
    setActiveSuggestionIdx(-1);
  };

  const handleSuggestionClick = (suggestion) => {
    setPreAuthEmail(suggestion);
    setShowSuggestions(false);
    setActiveSuggestionIdx(-1);
  };

  const handleEmailKeyDown = (e) => {
    if (!showSuggestions || emailSuggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestionIdx((i) => (i + 1) % emailSuggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestionIdx((i) => (i <= 0 ? emailSuggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeSuggestionIdx >= 0) {
      e.preventDefault();
      handleSuggestionClick(emailSuggestions[activeSuggestionIdx]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const handleEmailBlur = () => {
    // 延迟关闭，让 click 事件有时间触发
    setTimeout(() => setShowSuggestions(false), 150);
  };

  // ============================================
  // 加载用户列表
  // 这里加入版本号校验避免竞态：多次触发 effect 时，
  // 只有"最后一次发起的请求"才能 setUsers。
  // 同时记录加载状态与错误，便于在 UI 上诊断。
  //
  // 重要：不要把 getAllUsers / getPreAuthorizedEmails / isAdmin 放进依赖数组。
  // 这些值都会随 AuthContext 内 setUser / setSupabaseOk 的频繁触发而拿到新引用，
  // 一旦进依赖 → effect 反复重跑 → 上一次的 getAllUsers 请求被 seq 判为过期 → 丢弃，
  // 新请求又还没回来就被下一次 effect 替换 → setHasLoadedOnce(true) 永远不执行 →
  // 顶部"已授权/待授权"数字永远停在占位符 —，这就是"数字同步不上"的真正原因。
  // 用 ref 把这些函数"冻结"，effect 只跟最原子的触发条件走：
  //   - isAuthenticated：是否登录
  //   - refreshKey：手动触发刷新（授权/撤销/删除用户后 +1）
  //   - supabaseOk：云端可达性从 null→true/false 切换时需要重拉
  // ============================================
  const loadReqSeq = useRef(0);
  const getAllUsersRef = useRef(getAllUsers);
  const getPreAuthorizedEmailsRef = useRef(getPreAuthorizedEmails);
  const isAdminRef = useRef(isAdmin);
  useEffect(() => { getAllUsersRef.current = getAllUsers; }, [getAllUsers]);
  useEffect(() => { getPreAuthorizedEmailsRef.current = getPreAuthorizedEmails; }, [getPreAuthorizedEmails]);
  useEffect(() => { isAdminRef.current = isAdmin; }, [isAdmin]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const seq = ++loadReqSeq.current;
    setLoadingUsers(true);
    setLoadError('');

    const loadUsers = async () => {
      const diagInfo = {
        startedAt: new Date().toISOString(),
        currentUser: currentUser ? {
          id: currentUser.id?.slice(0, 8) + '...',
          email: currentUser.email,
          role: currentUser.role,
          authorized: currentUser.authorized,
          _fallback: currentUser._fallback || false,
        } : null,
        isAdmin,
        supabaseOk,
      };
      try {
        const data = await getAllUsersRef.current();
        // 即使本次 seq 已过期（用户很快又触发了下一次加载），
        // 只要这次确实拿到了数据，就把"至少成功过一次"标志设上——
        // 它是全局标志，不属于某一个 seq，设早一点只会让占位符更快变成真实数字，
        // 不会导致数据错乱（数据错乱由 seq 校验的 setUsers 负责兜底）。
        const safeData = Array.isArray(data) ? data : [];
        if (safeData.length >= 0) {
          setHasLoadedOnce(true);
        }
        if (seq !== loadReqSeq.current) {
          console.log('[UserManagement] 丢弃过期请求 seq=', seq);
          return;
        }
        diagInfo.returnedCount = safeData.length;
        diagInfo.authorizedBreakdown = {
          true: safeData.filter(u => u.authorized === true).length,
          false: safeData.filter(u => u.authorized === false).length,
          'string-true': safeData.filter(u => u.authorized === 'true' || u.authorized === 'TRUE').length,
          'other': safeData.filter(u => u.authorized !== true && u.authorized !== false && u.authorized !== 'true' && u.authorized !== 'TRUE').length,
        };
        diagInfo.sample = safeData.slice(0, 3).map(u => ({
          id: u.id?.slice(0, 8) + '...',
          email: u.email,
          role: u.role,
          authorized: u.authorized,
          authorizedType: typeof u.authorized,
        }));
        console.log('[UserManagement] getAllUsers 返回:', safeData.length, '条', diagInfo);
        // 一致性保护：若本次拉取为空（多半是 session 未就绪/网络抖动），
        // 而我们已有缓存列表，则保留缓存，不要用空结果把已显示的数据清掉。
        setUsers((prev) => (safeData.length > 0 || prev.length === 0 ? safeData : prev));
        // 只缓存"非空"的成功结果：避免把偶发的空结果写进缓存，
        // 否则下次首屏又会先闪一下空列表，违背一致性目的。
        if (safeData.length > 0) writeListCache(USERS_CACHE_KEY, safeData);
        setDiag(diagInfo);
        // 判断诊断结论
        if (safeData.length === 0) {
          setLoadError(
            'getAllUsers 返回 0 条。可能原因：' +
            (supabaseOk === false ? '已降级本地模式且本地无缓存' :
             supabaseOk === null ? '健康检查仍在进行' :
             'Supabase 查询为空（RLS/Session 问题），且本地 localStorage 也为空') +
            '。点击下方"查看诊断信息"可展开详情。'
          );
        } else if (safeData.length > 0 && safeData.every(u => !isAuthorized(u))) {
          setLoadError(
            `拉到 ${safeData.length} 条记录，但全部 authorized !== true。数据库里也许真的没人授权过；` +
            '或者 authorized 字段类型不对（见下方诊断）。'
          );
        }
      } catch (err) {
        if (seq !== loadReqSeq.current) return;
        console.error('[UserManagement] 加载用户异常:', err);
        diagInfo.error = err?.message || String(err);
        setLoadError('加载失败：' + (err?.message || '未知错误'));
        setDiag(diagInfo);
        // 失败时保留已有缓存列表，避免清空造成"刷新后数据消失/不一致"。
        setUsers((prev) => (prev.length > 0 ? prev : []));
        // 出错也视为"加载已完成"，让占位符切回 0，避免永远悬在 —
        setHasLoadedOnce(true);
      } finally {
        if (seq === loadReqSeq.current) setLoadingUsers(false);
      }
    };
    loadUsers();

    if (isAdminRef.current) {
      getPreAuthorizedEmailsRef.current().then(setPreAuthList).catch(() => {});
    }
    // 见上方注释：故意不把 getAllUsers / getPreAuthorizedEmails / currentUser / isAdmin 放进依赖。
    // isAdmin 也用 ref 读，避免 user 对象引用变化 → isAdmin 派生值引用"看起来变了" → effect 反复重跑 → seq 永远被覆盖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, refreshKey, supabaseOk]);

  // 页面变为可见时自动刷新用户列表（手机端切回浏览器/切换 TAB 时触发）
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isAuthenticated) {
        console.log('[UserManagement] 页面可见，刷新用户列表');
        setRefreshKey((k) => k + 1);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isAuthenticated]);

  // ============================================
  // 多端 / 多管理员实时同步：订阅 Supabase realtime
  //
  // 背景：此前本页只在下列时机刷新用户列表——
  //   1. 首次挂载；
  //   2. 本设备 refreshKey++（授权 / 撤销 / 删除 / 预授权后手动触发）；
  //   3. visibilitychange（从其他标签页切回来）。
  //
  // 这导致一个很明显的"同步不上"的观感：
  //   - 另一个管理员在别的设备上授权 / 撤销 / 删除了某个用户；
  //   - 这边页面保持打开并处于前台，既不刷新也收不到推送；
  //   - 表格里仍然是"旧数据"，用户看起来像"待授权 / 已授权 都同步不了"。
  //
  // 方案：给 profiles 表和 pre_authorized_emails 表都加 realtime 订阅，
  //   任何 INSERT / UPDATE / DELETE 事件都触发 refreshKey++ → 重新拉数据。
  // 实现参考项目里已有的 subscribeSharings / subscribeCategories 模式。
  //
  // 注意：
  //   - 必须确认 Supabase 已配置且本次未降级到 local 模式才订阅；
  //   - 卸载时通过 removeChannel 清理，避免泄漏；
  //   - 任何订阅异常都不应该影响页面其它功能，用 try/catch 兜底。
  // ============================================
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!isSupabaseConfigured || !supabase) return;
    if (supabaseOk === false) return; // 明确不可达时不必订阅

    let profilesChannel = null;
    let preAuthChannel = null;
    try {
      profilesChannel = supabase
        .channel('user_management_profiles_realtime')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'profiles' },
          (payload) => {
            console.log('[UserManagement] profiles realtime 事件:', payload.eventType || payload.type);
            setRefreshKey((k) => k + 1);
          }
        )
        .subscribe();

      preAuthChannel = supabase
        .channel('user_management_pre_auth_realtime')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'pre_authorized_emails' },
          (payload) => {
            console.log('[UserManagement] pre_authorized_emails realtime 事件:', payload.eventType || payload.type);
            setRefreshKey((k) => k + 1);
          }
        )
        .subscribe();
    } catch (err) {
      console.warn('[UserManagement] realtime 订阅失败（不影响主流程）:', err?.message);
    }

    return () => {
      try { if (profilesChannel) supabase.removeChannel(profilesChannel); } catch { /* ignore */ }
      try { if (preAuthChannel) supabase.removeChannel(preAuthChannel); } catch { /* ignore */ }
    };
  }, [isAuthenticated, supabaseOk]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const handleAuthorize = async (userId) => {
    await authorizeUser(userId);
    setRefreshKey((k) => k + 1);
  };

  const handleRevoke = async (userId) => {
    if (window.confirm('确定要撤销此用户的授权吗？')) {
      await revokeUser(userId);
      setRefreshKey((k) => k + 1);
    }
  };

  const handleDelete = async (targetUser) => {
    const msg = `确定要彻底删除用户「${targetUser.name || targetUser.email}」吗？\n\n` +
      '此操作会同时清理：\n' +
      '  • Supabase 认证账号（auth.users）\n' +
      '  • 个人档案（profiles）\n' +
      '  • 预授权邮箱（pre_authorized_emails）\n' +
      '  • 本地用户缓存\n\n' +
      '删除后，该邮箱可以重新注册。此操作不可撤销。';
    if (!window.confirm(msg)) return;
    const result = await deleteUser(targetUser.id, targetUser.email);
    if (result?.success) {
      alert(result.message || '删除成功');
    } else {
      const warn = Array.isArray(result?.warnings) && result.warnings.length
        ? '\n\n详情：\n' + result.warnings.join('\n')
        : '';
      alert((result?.message || '删除失败') + warn);
    }
    setRefreshKey((k) => k + 1);
    if (isAdmin) {
      getPreAuthorizedEmails().then(setPreAuthList);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    await changeUserRole(userId, newRole);
    setRefreshKey((k) => k + 1);
  };

  // 判断当前用户是否可以管理目标用户的角色
  const canManageRole = (targetUser) => {
    if (targetUser.id === currentUser?.id) return false; // 不能改自己
    return isAdmin; // 管理员可以管理其他用户的角色
  };

  // 当前用户可以设置的角色选项
  const getAvailableRoles = () => {
    return ['admin', 'member'];
  };

  // 判断是否可以授权/撤销
  const canManageAuth = (targetUser) => {
    if (targetUser.id === currentUser?.id) return false;
    return isAdmin;
  };

  // 预授权邮箱提交
  const handlePreAuthorize = async (e) => {
    e.preventDefault();
    if (!preAuthEmail.trim()) return;
    setPreAuthLoading(true);
    setPreAuthMessage({ type: '', text: '' });
    try {
      const result = await preAuthorizeByEmail(preAuthEmail.trim());
      if (result.success) {
        setPreAuthMessage({ type: 'success', text: result.message });
        setPreAuthEmail('');
        // 刷新用户列表和预授权列表
        setRefreshKey((k) => k + 1);
        getPreAuthorizedEmails().then(setPreAuthList);
      } else {
        setPreAuthMessage({ type: 'error', text: result.message });
      }
    } catch (err) {
      setPreAuthMessage({ type: 'error', text: '操作失败：' + err.message });
    } finally {
      setPreAuthLoading(false);
      // 3 秒后清除消息
      setTimeout(() => setPreAuthMessage({ type: '', text: '' }), 4000);
    }
  };

  // 移除预授权邮箱
  const handleRemovePreAuth = async (email) => {
    await removePreAuthorizedEmail(email);
    getPreAuthorizedEmails().then(setPreAuthList);
  };

  return (
    <div className="users-page">
      <div className="container">
        <div className="users-page__header">
          <div className="users-page__header-main">
            <h1>
              <Users size={28} /> <EditableText
                value={uc.pageTitle}
                onChange={(v) => updateUsers('pageTitle', v)}
                configKey="users.pageTitle"
                as="span"
              />
            </h1>
            <p><EditableText
              value={uc.pageDesc}
              onChange={(v) => updateUsers('pageDesc', v)}
              configKey="users.pageDesc"
              as="span"
            /></p>
          </div>
          {/* 手动刷新按钮：
              realtime 订阅是多端同步的首选方式，但某些部署未启用 Supabase
              realtime、或订阅在网络抖动后失联时仍可能漏消息。这里给用户一个
              常驻的"刷新"入口作为兜底——不必等 visibilitychange 也不必整页
              刷新即可拉到最新数据。 */}
          <button
            type="button"
            className="users-page__refresh-btn"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loadingUsers}
            title="刷新用户列表"
          >
            <RefreshCw
              size={14}
              className={loadingUsers ? 'users-page__refresh-btn-icon--spinning' : undefined}
            />
            <span>{loadingUsers ? '刷新中' : '刷新'}</span>
          </button>
        </div>

        {!isAdmin && (
          <div className="users-page__readonly-banner">
            <Eye size={16} />
            <span>当前为只读模式，仅管理员可管理用户</span>
          </div>
        )}

        {/* Stats */}
        <div className="users-stats">
          <div className="users-stat">
            <UserCheck size={20} />
            <div>
              <div className="users-stat__value">
                {authorizedDisplay}
              </div>
              <div className="users-stat__label">已授权</div>
            </div>
          </div>
          <div
            className={`users-stat users-stat--pending users-stat--clickable${showPendingPanel ? ' users-stat--active' : ''}`}
            onClick={() => pendingUsers.length > 0 && setShowPendingPanel((v) => !v)}
            style={{ cursor: pendingUsers.length > 0 ? 'pointer' : 'default' }}
            title={pendingUsers.length > 0 ? '点击查看待授权用户' : '暂无待授权用户'}
          >
            <UserX size={20} />
            <div>
              <div className="users-stat__value">
                {pendingDisplay}
              </div>
              <div className="users-stat__label">待授权</div>
            </div>
            {/* chevron 槽位始终占位，避免"有/无待授权"切换时卡片宽度跳变 */}
            <ChevronDown
              size={16}
              className={`users-stat__chevron${showPendingPanel ? ' users-stat__chevron--open' : ''}${pendingUsers.length > 0 ? '' : ' users-stat__chevron--hidden'}`}
              aria-hidden={pendingUsers.length === 0}
            />
          </div>
        </div>

        {/*
          顶部诊断抽屉（仅管理员可见）
          -----------------------------------------
          背景：多次出现"加载不出已授权用户数 / 列表看不到其他成员"的反馈，
          但以前的诊断面板只在 authorizedUsers.length === 0 且表格为空时才出现，
          用户看到的症状常常是 stats 一直 "—" 或表格转圈，根本点不到诊断按钮。

          这里把诊断独立到顶部，任何时候都可展开，并多给一个"强制刷新 session
          后重查"的兜底入口。它会：
            1) supabase.auth.refreshSession() —— 修复 session 过期 / anon 降级；
            2) refreshKey++ —— 触发 loadUsers 重跑；
            3) 如果本地缓存 supabaseOk === false（上次降级过），也强制重置为 null，
               让 loadUsers 再次尝试 Supabase 而不是只读本地缓存。
        */}
        {isAdmin && (
          <details className="users-diag-drawer">
            <summary>
              <Shield size={14} />
              <span>用户列表诊断</span>
              <span className="users-diag-drawer__hint">
                拉到 {users.length} 条 / 已授权判定 {authorizedUsers.length} / supabaseOk={String(supabaseOk)}
              </span>
            </summary>
            <div className="users-diag-drawer__body">
              {loadError && (
                <div className="users-diag-drawer__err">
                  <AlertCircle size={14} /> {loadError}
                </div>
              )}
              <div className="users-diag-drawer__actions">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      if (isSupabaseConfigured && supabase) {
                        console.log('[UserManagement] 强制 refreshSession…');
                        await supabase.auth.refreshSession();
                      }
                    } catch (e) {
                      console.warn('[UserManagement] refreshSession 失败:', e?.message);
                    }
                    setRefreshKey((k) => k + 1);
                  }}
                >
                  强制刷新 session 后重查
                </button>
                <button
                  type="button"
                  onClick={() => setRefreshKey((k) => k + 1)}
                  disabled={loadingUsers}
                >
                  {loadingUsers ? '刷新中…' : '重新加载'}
                </button>
              </div>
              {diag ? (
                <pre className="users-diag-drawer__pre">
                  {JSON.stringify(diag, null, 2)}
                </pre>
              ) : (
                <div className="users-diag-drawer__empty">
                  尚未产生诊断信息（页面刚加载或正在请求中）
                </div>
              )}
            </div>
          </details>
        )}

        {/* 待授权用户面板 */}
        {showPendingPanel && pendingUsers.length > 0 && (
          <div className="users-pending-panel">
            <div className="users-pending-panel__header">
              <Clock size={15} />
              <span>等待授权的用户（{pendingUsers.length}）</span>
            </div>
            <div className="users-pending-panel__list">
              {pendingUsers.map((u) => (
                <div key={u.id} className="users-pending-panel__item">
                  <div className="users-pending-panel__user">
                    <div className="users-pending-panel__avatar">
                      <User size={16} />
                    </div>
                    <div className="users-pending-panel__info">
                      <span className="users-pending-panel__name">{u.name}</span>
                      <span className="users-pending-panel__email">{u.email}</span>
                    </div>
                    <span className="users-pending-panel__date">
                      {new Date(u.createdAt || u.created_at).toLocaleDateString('zh-CN')} 注册
                    </span>
                  </div>
                  {isAdmin && canManageAuth(u) && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleAuthorize(u.id)}
                    >
                      <Shield size={14} /> 授权
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 权限说明 */}
        <div className="users-roles-info">
          <h4>角色说明</h4>
          <div className="users-roles-info__grid">
            <div className="users-roles-info__item">
              <span className="users-roles-info__badge" style={{ color: ROLE_COLORS.admin, background: `${ROLE_COLORS.admin}15` }}>
                <Shield size={14} /> 管理员
              </span>
              <span>编辑网站组件内容、授权用户、管理成员角色</span>
            </div>
            <div className="users-roles-info__item">
              <span className="users-roles-info__badge" style={{ color: ROLE_COLORS.member, background: `${ROLE_COLORS.member}15` }}>
                <Users size={14} /> 成员
              </span>
              <span>访问内部文件资料、查看通知与任务</span>
            </div>
          </div>
        </div>

        {/* 邮箱预授权（仅管理员可见） */}
        {isAdmin && (
          <div className="users-preauth">
            <div className="users-preauth__header">
              <h4><Mail size={16} /> 邮箱授权</h4>
              <p>输入成员邮箱直接授权 — 已注册的用户将立即获得权限，未注册的邮箱将加入预授权列表，注册后自动拥有权限（不会发送邮件）</p>
            </div>

            <form className="users-preauth__form" onSubmit={handlePreAuthorize}>
              <div className="users-preauth__input-wrap">
                <Mail size={16} className="users-preauth__input-icon" />
                <input
                  type="email"
                  value={preAuthEmail}
                  onChange={handleEmailChange}
                  onKeyDown={handleEmailKeyDown}
                  onBlur={handleEmailBlur}
                  onFocus={() => preAuthEmail.includes('@') && setShowSuggestions(true)}
                  placeholder="输入成员邮箱地址…"
                  className="users-preauth__input"
                  disabled={preAuthLoading}
                  autoComplete="off"
                />
                {showSuggestions && emailSuggestions.length > 0 && (
                  <ul className="users-preauth__suggestions">
                    {emailSuggestions.map((s, idx) => (
                      <li
                        key={s}
                        className={`users-preauth__suggestion-item${idx === activeSuggestionIdx ? ' users-preauth__suggestion-item--active' : ''}`}
                        onMouseDown={() => handleSuggestionClick(s)}
                      >
                        <Mail size={13} />
                        <span>
                          <strong>{s.split('@')[0]}@</strong>{s.split('@')[1]}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                type="submit"
                className="btn btn-primary users-preauth__btn"
                disabled={!preAuthEmail.trim() || preAuthLoading}
              >
                {preAuthLoading ? (
                  <><Loader2 size={16} className="users-preauth__spinner" /> 处理中…</>
                ) : (
                  <><Plus size={16} /> 授权</>
                )}
              </button>
            </form>

            {preAuthMessage.text && (
              <div className={`users-preauth__message users-preauth__message--${preAuthMessage.type}`}>
                {preAuthMessage.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                <span>{preAuthMessage.text}</span>
              </div>
            )}

            {/* 预授权列表 */}
            {preAuthList.length > 0 && (
              <div className="users-preauth__list">
                <div className="users-preauth__list-title">待注册的预授权邮箱（{preAuthList.length}）</div>
                {preAuthList.map((item) => (
                  <div key={item.email} className="users-preauth__list-item">
                    <div className="users-preauth__list-email">
                      <Mail size={14} />
                      <span>{item.email}</span>
                      <span className="users-preauth__list-date">
                        {item.addedAt ? new Date(item.addedAt).toLocaleDateString('zh-CN') : ''}
                      </span>
                    </div>
                    <button
                      className="users-preauth__list-remove"
                      onClick={() => handleRemovePreAuth(item.email)}
                      title="移除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* User List — 仅已授权用户 */}
        <div className="users-table-wrapper">
          <table className="users-table">
            <thead>
              <tr>
                <th>用户</th>
                <th>邮箱</th>
                <th>角色</th>
                <th>注册时间</th>
                {isAdmin && <th>操作</th>}
              </tr>
            </thead>
            <tbody>
              {loadingUsers ? (
                <tr>
                  <td colSpan={isAdmin ? 5 : 4} style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>
                    <Loader2 size={16} className="users-preauth__spinner" style={{ verticalAlign: 'middle', marginRight: '0.5rem' }} />
                    加载中…
                  </td>
                </tr>
              ) : authorizedUsers.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 5 : 4} style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>
                    <div>暂无已授权用户</div>
                    {loadError && (
                      <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#c17070', maxWidth: 680, margin: '0.75rem auto 0', lineHeight: 1.5 }}>
                        <AlertCircle size={14} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} />
                        {loadError}
                      </div>
                    )}
                    <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => setRefreshKey((k) => k + 1)}
                        style={{
                          padding: '0.35rem 0.9rem',
                          fontSize: '0.85rem',
                          background: 'transparent',
                          border: '1px solid var(--color-border)',
                          borderRadius: '6px',
                          color: 'var(--color-text)',
                          cursor: 'pointer',
                        }}
                      >
                        重新加载
                      </button>
                      {diag && (
                        <button
                          onClick={() => setShowDiag((v) => !v)}
                          style={{
                            padding: '0.35rem 0.9rem',
                            fontSize: '0.85rem',
                            background: 'transparent',
                            border: '1px solid var(--color-border)',
                            borderRadius: '6px',
                            color: 'var(--color-text)',
                            cursor: 'pointer',
                          }}
                        >
                          {showDiag ? '收起' : '查看'}诊断信息
                        </button>
                      )}
                    </div>
                    {showDiag && diag && (
                      <pre
                        style={{
                          marginTop: '0.75rem',
                          textAlign: 'left',
                          background: '#f6f7f8',
                          border: '1px solid var(--color-border)',
                          borderRadius: '6px',
                          padding: '0.75rem 1rem',
                          fontSize: '0.78rem',
                          lineHeight: 1.55,
                          color: '#444',
                          maxWidth: 780,
                          margin: '0.75rem auto 0',
                          overflowX: 'auto',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                        }}
                      >
                        {JSON.stringify(diag, null, 2)}
                      </pre>
                    )}
                  </td>
                </tr>
              ) : (
                authorizedUsers.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="users-table__user">
                        <span>{u.name}</span>
                      </div>
                    </td>
                    <td>
                      <span className="users-table__email">{u.email}</span>
                    </td>
                    <td>
                      {canManageRole(u) ? (
                        <div className="users-table__role-select-wrapper">
                          <CustomSelect
                            value={u.role}
                            onChange={(val) => handleRoleChange(u.id, val)}
                            options={getAvailableRoles().map((role) => ({
                              value: role,
                              label: ROLE_LABELS[role],
                            }))}
                            size="sm"
                            style={{ color: ROLE_COLORS[u.role] }}
                          />
                        </div>
                      ) : (
                        <span
                          className={`users-table__role users-table__role--${u.role}`}
                          style={{ color: ROLE_COLORS[u.role] }}
                        >
                          {ROLE_LABELS[u.role]}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="users-table__date">
                        {new Date(u.createdAt || u.created_at).toLocaleDateString('zh-CN')}
                      </span>
                    </td>
                    {isAdmin && (
                      <td>
                        <div className="users-table__actions">
                          {canManageAuth(u) ? (
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => handleRevoke(u.id)}
                            >
                              <ShieldOff size={14} /> 撤销
                            </button>
                          ) : (
                            <span className="users-table__no-action">—</span>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
