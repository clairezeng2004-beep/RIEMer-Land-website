import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useWysiwyg } from '../../contexts/WysiwygContext';
import EditableText from '../../components/EditableText';
import CustomSelect from '../../components/CustomSelect';
import {
  Users,
  Pencil,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import './MemberProfiles.css';

// ============================================
// 表格列定义
// ============================================
const COLUMNS = [
  { key: 'name', label: '姓名', width: '90px', editable: false },
  { key: 'enrollment_year', label: '入学年份', width: '72px', editable: true, placeholder: '如 2023' },
  { key: 'joined_at_display', label: '加入时间', width: '100px', editable: true, inputType: 'yearMonth' },
  { key: 'bio', label: '一句话概括自己', width: '220px', editable: true, placeholder: '用一句话介绍自己' },
  { key: 'further_education', label: '升学去向', width: '170px', editable: true, placeholder: '如 XX大学XX专业' },
  { key: 'career', label: '工作去向', width: '180px', editable: true, placeholder: '如 XX公司XX岗位 当前base地' },
  { key: 'willing_to_share', label: '我愿意分享什么', width: '320px', editable: true, placeholder: '你愿意和大家分享的内容' },
  { key: 'want_to_learn', label: '我想和大家请教什么', width: '320px', editable: true, placeholder: '你想请教大家的问题' },
  { key: 'career_interest', label: '感兴趣的职业方向/生活模式', width: '220px', editable: true, placeholder: '如 产品经理、数字游民、慢生活' },
  { key: 'hometown', label: '家乡', width: '130px', editable: true, placeholder: '如 广东广州' },
  { key: 'dream_city', label: '喜爱向往的城市与地区', width: '190px', editable: true, placeholder: '如 北京、上海、川西' },
  { key: 'hobbies', label: '爱好', width: '260px', editable: true, placeholder: '如 摄影、阅读、运动' },
  { key: 'favorites', label: '喜欢的音乐/作家/UP主/书籍/演员/影视剧等', width: '240px', editable: true, placeholder: '如 周杰伦、村上春树、老番茄、《三体》...' },
  { key: 'other', label: '其他', width: '220px', editable: true, placeholder: '任何想补充的内容' },
];

// 生成年份选项（从 2015 到当前年份 +1）
const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: currentYear - 2015 + 2 }, (_, i) => 2015 + i);
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

// 安全解析各种后端可能返回的时间字符串（兼容 Edge / Safari）：
//   - '2024-01-01T10:00:00+00:00'  ✅（标准 ISO）
//   - '2024-01-01T10:00:00+00'      Edge 旧版会认不出 `+00` 单段时区
//   - '2024-01-01 10:00:00+00'      Postgres 默认格式（带空格，Edge/Safari 早期版本 Invalid Date）
//   - '2024-01-01 10:00:00'         无时区
// 统一修正为浏览器都能解析的 ISO 8601。
function safeParseDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  // 把中间的空格替换为 'T'（Postgres TIMESTAMPTZ 输出常见格式）
  s = s.replace(' ', 'T');
  // 处理 '+00' / '-05' 这类单段时区（需补成 '+00:00'）
  s = s.replace(/([+-])(\d{2})$/, '$1$2:00');
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// 将 ISO 日期转为 { year, month }
function dateToYearMonth(dateStr) {
  const d = safeParseDate(dateStr);
  if (!d) return { year: '', month: '' };
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

// 将 year+month 转为 ISO 日期字符串（月初）
function yearMonthToDate(year, month) {
  if (!year || !month) return '';
  return new Date(year, month - 1, 1).toISOString();
}

// localStorage key
const MEMBER_PROFILES_KEY = 'riemer_member_profiles';

// ============================================
// localStorage 工具函数
// ============================================
function getLocalProfiles() {
  const stored = localStorage.getItem(MEMBER_PROFILES_KEY);
  return stored ? JSON.parse(stored) : [];
}

function saveLocalProfiles(profiles) {
  localStorage.setItem(MEMBER_PROFILES_KEY, JSON.stringify(profiles));
}

// ============================================
// 把 Supabase 返回的行统一转成前端需要的格式
// （抽出来避免主路径和后台拉取两处写两遍）
//
// 注意：为兼容 Edge 等对 PostgREST 嵌入查询返回不稳定的浏览器
// （实测 Edge 在某些场景下会让 p.profiles 为 null），
// 我们同时支持：
//   - 嵌入 JOIN 返回（p.profiles）
//   - 显式合入的 profile map（extraProfiles[p.user_id]）
// 两种数据源；并提供 fallbackName / fallbackCreatedAt 作为最终兜底。
// ============================================
function formatProfilesFromSupabase(rows, {
  extraProfiles = {},
  fallbackNameById = {},
  fallbackCreatedAtById = {},
} = {}) {
  return (rows || []).map((p) => {
    const joined = p.profiles || extraProfiles[p.user_id] || null;
    const name =
      joined?.name ||
      fallbackNameById[p.user_id] ||
      '未知用户';
    const createdAt =
      joined?.created_at ||
      fallbackCreatedAtById[p.user_id] ||
      '';
    return {
      id: p.user_id,
      user_id: p.user_id,
      name,
      enrollment_year: p.enrollment_year || '',
      joined_at: p.joined_at || createdAt || '',
      joined_at_display: (() => {
        const raw = p.joined_at || createdAt;
        const d = safeParseDate(raw);
        return d ? `${d.getFullYear()}年${d.getMonth() + 1}月` : '';
      })(),
      bio: p.bio || '',
      further_education: p.further_education || '',
      career: p.career || '',
      willing_to_share: p.willing_to_share || '',
      want_to_learn: p.want_to_learn || '',
      career_interest: p.career_interest || '',
      hometown: p.hometown || '',
      dream_city: p.dream_city || '',
      hobbies: p.hobbies || '',
      favorites: p.favorites || '',
      other: p.other || '',
    };
  });
}

// ============================================
// MemberProfiles 组件
// ============================================
export default function MemberProfiles() {
  const { user, isAuthenticated, isAdmin, getAllUsers, supabaseOk } = useAuth();
  const { internalConfig, updateInternalConfig } = useSiteContent();
  const { editing } = useWysiwyg();
  const mp = internalConfig.memberProfiles || {};
  const updateMP = useCallback((key, val) => updateInternalConfig({ memberProfiles: { [key]: val } }), [updateInternalConfig]);
  // 同步从 localStorage 读取缓存，避免切换 tab 时闪现空状态
  const [profiles, setProfiles] = useState(() => {
    try {
      const cached = getLocalProfiles();
      if (cached.length > 0) {
        return cached.map((p) => ({
          ...p,
          id: p.user_id,
          name: p.name || '未知用户',
          joined_at_display: (() => {
            const d = safeParseDate(p.joined_at);
            return d ? `${d.getFullYear()}年${d.getMonth() + 1}月` : '';
          })(),
        })).sort((a, b) => {
          const da = safeParseDate(a.joined_at);
          const db = safeParseDate(b.joined_at);
          return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
        });
      }
    } catch { /* ignore */ }
    return [];
  });
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  // 行内保存反馈（不用 alert，alert 可能被浏览器/扩展拦截导致"没反应"假象）
  // 形如 { type: 'error'|'warning'|'success', text: '...' }
  const [saveMsg, setSaveMsg] = useState(null);
  // 云端数据加载状态，用来给用户明确反馈，而不是静默失败
  //   idle:    初始/空闲
  //   loading: 正在从 Supabase 拉取
  //   ok:      云端数据已成功加载（隐藏横幅）
  //   partial: 云端暂时拿不到，当前显示的是本地缓存
  //   error:   云端查询失败，提供重试
  const [cloudStatus, setCloudStatus] = useState('idle');
  const tableRef = useRef(null);

  // 动态列宽覆盖：{ [colKey]: widthPx }
  // 当某一列内容行数 > 4 时，自动增大该列最小宽度，直到所有行都能在 4 行内显示完（或达到上限）
  const [colWidthOverrides, setColWidthOverrides] = useState({});
  // 记录上一次测量后得到的"每列合适宽度"，避免 useLayoutEffect 自循环
  const lastMeasuredRef = useRef({});

  // 本地模式加载成员信息
  const loadLocalFallback = useCallback(async () => {
    const allUsers = await getAllUsers();
    let localProfiles = getLocalProfiles();

    // 确保每个已授权用户都有对应记录
    const authorizedUsers = allUsers.filter((u) => u.authorized);
    let updated = false;

    authorizedUsers.forEach((u) => {
      const exists = localProfiles.find((p) => p.user_id === u.id);
      if (!exists) {
        localProfiles.push({
          user_id: u.id,
          name: u.name,
          enrollment_year: '',
          joined_at: u.createdAt || u.created_at || new Date().toISOString(),
          bio: '',
          further_education: '',
          career: '',
          willing_to_share: '',
          want_to_learn: '',
          career_interest: '',
          hometown: '',
          dream_city: '',
          hobbies: '',
          favorites: '',
          other: '',
        });
        updated = true;
      }
    });

    if (updated) saveLocalProfiles(localProfiles);

    // 补全 name 并排序
    const formatted = localProfiles
      .map((p) => {
        const u = allUsers.find((u) => u.id === p.user_id);
        return {
          ...p,
          id: p.user_id,
          name: u?.name || p.name || '未知用户',
          joined_at_display: (() => {
            const d = safeParseDate(p.joined_at);
            return d ? `${d.getFullYear()}年${d.getMonth() + 1}月` : '';
          })(),
        };
      })
      .sort((a, b) => {
        const da = safeParseDate(a.joined_at);
        const db = safeParseDate(b.joined_at);
        return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
      });

    setProfiles(formatted);
  }, [getAllUsers]);

  // ============================================
  // 真正从 Supabase 拉一次成员列表
  // 返回：{ ok: boolean, data?: formatted[], error?: string }
  //
  // 兼容性说明（重点：Edge 浏览器）：
  //   PostgREST 的嵌入 JOIN（`*, profiles(name, created_at)`）在 Edge
  //   上偶发返回 p.profiles = null（Microsoft 跟踪保护/Cookie 分区 策略
  //   影响 Authorization 头传递，RLS 降级到 anon，authorized=false 的
  //   行被挡掉，导致 JOIN 为 null —— 多次刷新也无法恢复）。
  //   因此：
  //     1. 先尝试带 JOIN 的查询（Chrome/Safari/Firefox 上一切正常）；
  //     2. 失败时或 JOIN 为空的行补一次**显式**的 profiles 查询
  //        （`.from('profiles').in('id', userIds)`），这是纯粹的主键
  //        查询，不依赖外键关系推断，所有浏览器都稳定；
  //     3. 还失败则回退 getAllUsers / localStorage 兜底姓名。
  //   失败时尝试一次 refreshSession 再重试，再失败才算 ok=false。
  // ============================================
  const fetchFromSupabase = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      return { ok: false, error: 'Supabase 未配置' };
    }

    // --- Step 1: 带 JOIN 的主查询 ---
    let { data, error } = await supabase
      .from('member_profiles')
      .select('*, profiles(name, created_at)')
      .order('joined_at', { ascending: true });

    if (error) {
      console.warn('[MemberProfiles] Supabase 查询失败:', error.message, '，尝试刷新 session...');
      try {
        const { data: refreshData } = await supabase.auth.refreshSession();
        if (refreshData?.session) {
          const retry = await supabase
            .from('member_profiles')
            .select('*, profiles(name, created_at)')
            .order('joined_at', { ascending: true });
          data = retry.data;
          error = retry.error;
        }
      } catch (refreshErr) {
        console.warn('[MemberProfiles] Session 刷新异常:', refreshErr?.message);
      }
    }

    // 如果带 JOIN 的查询整体失败，再做一次"裸"查询（不带 JOIN），
    // 某些浏览器 + 代理会在 select 含外键嵌入时直接返回 406/400。
    if (error) {
      const bareRetry = await supabase
        .from('member_profiles')
        .select('*')
        .order('joined_at', { ascending: true });
      if (!bareRetry.error) {
        data = bareRetry.data;
        error = null;
      }
    }

    if (error) {
      return { ok: false, error: error.message || '未知错误' };
    }

    const rows = data || [];

    // --- Step 2: 找出 JOIN 缺失姓名的行，显式查 profiles 补齐 ---
    const missingIds = rows
      .filter((r) => !r.profiles || !r.profiles.name)
      .map((r) => r.user_id)
      .filter(Boolean);

    const extraProfiles = {};
    if (missingIds.length > 0) {
      try {
        const { data: profRows, error: profErr } = await supabase
          .from('profiles')
          .select('id, name, created_at')
          .in('id', missingIds);
        if (!profErr && profRows) {
          profRows.forEach((pr) => {
            if (pr?.id) extraProfiles[pr.id] = { name: pr.name, created_at: pr.created_at };
          });
        } else if (profErr) {
          console.warn('[MemberProfiles] 显式补查 profiles 失败（将继续用其它兜底）:', profErr.message);
        }
      } catch (e) {
        console.warn('[MemberProfiles] 显式补查 profiles 异常:', e?.message);
      }
    }

    // --- Step 3: 如果仍有姓名缺失，用 getAllUsers / localStorage 兜底 ---
    const stillMissingIds = rows
      .filter((r) => {
        const joined = r.profiles || extraProfiles[r.user_id];
        return !joined || !joined.name;
      })
      .map((r) => r.user_id)
      .filter(Boolean);

    const fallbackNameById = {};
    const fallbackCreatedAtById = {};
    if (stillMissingIds.length > 0) {
      try {
        const allUsers = await getAllUsers();
        allUsers.forEach((u) => {
          if (!u?.id) return;
          if (stillMissingIds.includes(u.id)) {
            fallbackNameById[u.id] = u.name || u.email?.split('@')[0] || '';
            fallbackCreatedAtById[u.id] = u.createdAt || u.created_at || '';
          }
        });
      } catch (e) {
        console.warn('[MemberProfiles] getAllUsers 兜底失败:', e?.message);
      }
      // 再尝试从 localStorage 里拿上次的姓名
      try {
        const cachedRows = getLocalProfiles();
        cachedRows.forEach((c) => {
          if (c?.user_id && stillMissingIds.includes(c.user_id) && !fallbackNameById[c.user_id]) {
            fallbackNameById[c.user_id] = c.name || '';
          }
        });
      } catch { /* ignore */ }
    }

    return {
      ok: true,
      data: formatProfilesFromSupabase(rows, {
        extraProfiles,
        fallbackNameById,
        fallbackCreatedAtById,
      }),
    };
  }, [getAllUsers]);

  // 加载成员信息
  //   force=true：即便 supabaseOk !== true，也强行尝试一次真实查询（用于"重试"按钮）
  const loadProfiles = useCallback(async ({ force = false } = {}) => {
    if (!isAuthenticated) return;

    // 没配 Supabase：纯本地模式，不需要任何云端状态
    if (!isSupabaseConfigured) {
      await loadLocalFallback();
      setCloudStatus('idle');
      return;
    }

    // 配了 Supabase 就应该走云端；健康检查失败时也**同步**尝试一次真实查询，
    // 因为 health ping 可能被广告/代理拦截，但 REST 查询其实能通。
    setCloudStatus('loading');
    const result = await fetchFromSupabase();

    if (result.ok) {
      const data = result.data;

      // 检查当前用户是否有记录，没有则自动创建，然后再拉一遍
      const currentProfile = data?.find((p) => p.user_id === user?.id);
      if (!currentProfile && user) {
        const newProfile = {
          user_id: user.id,
          enrollment_year: '',
          bio: '',
          further_education: '',
          career: '',
          willing_to_share: '',
          want_to_learn: '',
          career_interest: '',
          hometown: '',
          dream_city: '',
          hobbies: '',
          favorites: '',
          other: '',
          joined_at: user.created_at || new Date().toISOString(),
        };
        const { error: insertError } = await supabase
          .from('member_profiles')
          .insert(newProfile);
        if (!insertError) {
          // 重新加载一次（不再进入创建分支）
          const retryAfterInsert = await fetchFromSupabase();
          if (retryAfterInsert.ok) {
            setProfiles(retryAfterInsert.data);
            // 顺手把云端数据缓存到本地，下次离线/失败兜底能看到更多行
            saveLocalProfiles(
              retryAfterInsert.data.map(({ id: _id, joined_at_display: _d, ...rest }) => rest)
            );
            setCloudStatus('ok');
            return;
          }
        }
      }

      setProfiles(data);
      // 把云端数据缓存到本地，方便离线/健康检查失败时兜底显示更完整
      saveLocalProfiles(
        data.map(({ id: _id, joined_at_display: _d, ...rest }) => rest)
      );
      setCloudStatus('ok');
      return;
    }

    // 云端查询失败：先用本地兜底撑起来，UI 上给出明确提示
    console.warn('[MemberProfiles] Supabase 查询失败，降级本地:', result.error);
    await loadLocalFallback();

    // 如果是"健康检查未通过 + 首次进入"，至少提示这是本地缓存
    // force 重试后仍然失败，则提升成 error（附带重试按钮）
    setCloudStatus(force || supabaseOk === false ? 'error' : 'partial');
  }, [isAuthenticated, user, supabaseOk, loadLocalFallback, fetchFromSupabase]);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  // 开始编辑
  const startEdit = (profile) => {
    setEditingId(profile.user_id);
    setSaveMsg(null);
    const ym = dateToYearMonth(profile.joined_at);
    setEditData({
      ...profile,
      _joined_year: ym.year,
      _joined_month: ym.month,
    });
  };

  // 取消编辑
  const cancelEdit = () => {
    setEditingId(null);
    setEditData({});
    setSaveMsg(null);
  };

  // 保存编辑
  //
  // 关键修复 (v2)：
  //   * 不再用 alert（可能被浏览器/扩展/iframe 沙箱静默拦截，造成"点保存没反应"的假象）；
  //     改为在行内显示 saveMsg（error / warning / success）。
  //   * 给云端请求加 10s 超时保护，避免网络挂起时 saving 永远停在 true 而按钮被禁用。
  //   * 把每一步的日志都串起来（[MemberProfiles:save] 前缀），便于用户把 console 截图反馈。
  //   * 云端失败时容忍"数据库缺少新列"的场景：PostgREST 会抛 PGRST204 /
  //     "Could not find the 'xxx' column"，我们把这类提示在界面上给出可操作建议
  //     （请管理员执行 supabase-members-and-albums.sql）。
  //   * 云端成功 / 本地成功都会退出编辑态；保留之前 "supabaseOk 三态" 的优先云端逻辑。
  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    setSaveMsg(null);

    // 帮助函数：给 Promise 加超时，避免永远 pending 导致 saving 卡死。
    //
    // ⚠ 这个外层超时要比 src/lib/supabase.js 里的 global.fetch 超时（10s）
    //    明显更长，否则两层 10s 超时会同时触发，把"云端响应稍慢"也误判为
    //    "网络不通"。Supabase fetch 自己到 10s 就会 AbortError，本层 25s
    //    只是兜底防止"promise 永远 pending 卡住 saving 状态"。
    const withTimeout = (promise, ms, label) =>
      Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`${label} 超时（${ms / 1000}s）`)), ms)
        ),
      ]);

    try {
      console.log('[MemberProfiles:save] 开始保存', {
        editingId,
        isSupabaseConfigured,
        supabaseOk,
      });

      // 计算加入时间
      const newJoinedAt = yearMonthToDate(editData._joined_year, editData._joined_month);

      // 收集可编辑字段
      const updateData = {};
      COLUMNS.forEach((col) => {
        if (col.editable && col.key !== 'joined_at_display' && editData[col.key] !== undefined) {
          updateData[col.key] = editData[col.key];
        }
      });
      if (newJoinedAt) {
        updateData.joined_at = newJoinedAt;
      }

      console.log('[MemberProfiles:save] 将要写入的字段:', Object.keys(updateData));

      let savedToCloud = false;
      let cloudErrMsg = '';

      // --- 优先走云端（配置了 Supabase 就试一次，不看 supabaseOk 三态）---
      if (isSupabaseConfigured && supabase) {
        try {
          const firstAttempt = await withTimeout(
            supabase
              .from('member_profiles')
              .update(updateData)
              .eq('user_id', editingId)
              .select('user_id'),
            25000,
            '云端保存'
          );
          let error = firstAttempt.error;
          let data = firstAttempt.data;

          // 401 / session 过期 → 刷新后重试一次
          if (error) {
            console.warn('[MemberProfiles:save] 首次云端保存失败，尝试刷新 session:', error.message, error.code);
            try {
              await supabase.auth.refreshSession();
            } catch { /* ignore */ }
            const retry = await withTimeout(
              supabase
                .from('member_profiles')
                .update(updateData)
                .eq('user_id', editingId)
                .select('user_id'),
              25000,
              '云端保存重试'
            );
            error = retry.error;
            data = retry.data;
          }

          if (error) {
            cloudErrMsg = error.message || String(error);
            console.error('[MemberProfiles:save] 云端保存最终失败:', error);
          } else if (!data || data.length === 0) {
            // RLS 挡掉更新（用户没有权限改这一行），update 不报错但返回空
            cloudErrMsg = '没有权限修改该行（可能是 RLS 策略拒绝了，请确认你是本行所属人或管理员）';
            console.error('[MemberProfiles:save] update 返回 0 行，疑似 RLS 拒绝');
          } else {
            savedToCloud = true;
            console.log('[MemberProfiles:save] 云端保存成功，影响行数:', data.length);
          }
        } catch (netErr) {
          cloudErrMsg = netErr?.message || String(netErr);
          console.error('[MemberProfiles:save] 云端保存异常:', netErr);
        }
      }

      // --- 云端没保存成功，才写本地；并给出明确提示 ---
      if (!savedToCloud) {
        // 写本地兜底（即使云端失败，先保留用户刚填的内容）
        const localProfiles = getLocalProfiles();
        let idx = localProfiles.findIndex((p) => p.user_id === editingId);
        if (idx < 0) {
          const existing = profiles.find((p) => p.user_id === editingId);
          if (existing) {
            const { id: _id, joined_at_display: _d, ...rest } = existing;
            localProfiles.push({ ...rest });
            idx = localProfiles.length - 1;
          }
        }
        if (idx >= 0) {
          Object.keys(updateData).forEach((k) => {
            localProfiles[idx][k] = updateData[k];
          });
          saveLocalProfiles(localProfiles);
        }

        if (isSupabaseConfigured) {
          // 根据错误信息给出针对性建议
          let hint = '';
          if (/Could not find the .* column|PGRST204|schema cache/i.test(cloudErrMsg)) {
            hint = '（疑似数据库缺少新字段，请联系管理员在 Supabase 后台执行 supabase-members-and-albums.sql 完成升级）';
          } else if (/row-level security|RLS|没有权限/i.test(cloudErrMsg)) {
            hint = '（疑似权限不足，请确认你是该行所属人或管理员）';
          } else if (/超时|timeout|Failed to fetch|NetworkError|AbortError|aborted/i.test(cloudErrMsg)) {
            // 之前这里直接断言"网络不通"，但实际上更常见的原因是：
            //   - Supabase 免费层冷启动 / 当前并发高，单次请求耗时较长
            //   - 浏览器正在刷新 token 或 session 同步进行中
            //   - 本地 DNS / 路由抖动一小段时间
            // 用中性措辞，避免让网络其实正常的用户陷入"以为自己网络坏了"。
            hint = '（云端响应较慢或暂时不可达；稍等几秒再点"保存"通常即可恢复。若持续失败可检查代理 / 广告拦截插件）';
          }

          setSaveMsg({
            type: 'error',
            text: `保存到云端失败：${cloudErrMsg || '未知错误'}${hint}。改动已暂存到本地，刷新后仍可见；点"取消"或再次点"保存"可重试。`,
          });
          setSaving(false);
          return; // 保持在编辑态让用户重试
        }
      }

      // --- 成功（云端或本地模式）---
      await loadProfiles();
      setEditingId(null);
      setEditData({});
      setSaveMsg({
        type: 'success',
        text: savedToCloud ? '已保存到云端 ✓' : '已保存到本地 ✓',
      });
      // 3 秒后自动清除成功提示
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (err) {
      console.error('[MemberProfiles:save] Save error:', err);
      setSaveMsg({
        type: 'error',
        text: '保存失败：' + (err?.message || '未知错误') + '。请把浏览器 Console 日志（[MemberProfiles:save] 开头）截图发给管理员。',
      });
    } finally {
      setSaving(false);
    }
  };

  // 横向滚动
  const scrollTable = (direction) => {
    if (tableRef.current) {
      const scrollAmount = 300;
      tableRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
    }
  };

  // ============================================
  // 列宽自适应：文本超过 4 行时自动加宽所在列（而不是省略）
  // ============================================
  // 从 COLUMNS 的初始 width 里解析出数字，作为每列的"默认最小宽度"
  const parsePx = (v) => {
    if (typeof v !== 'string') return 0;
    const m = v.match(/(\d+)/);
    return m ? Number(m[1]) : 0;
  };
  const MAX_COL_WIDTH = 640; // 自动加宽的上限，避免极端情况下把列撑得过宽
  const MAX_LINES = 4;        // 目标：每格最多 4 行

  useLayoutEffect(() => {
    if (!tableRef.current) return;
    if (!profiles || profiles.length === 0) return;

    // 编辑态下的那一行是 textarea，不计入测量
    const cells = tableRef.current.querySelectorAll('td[data-col-key] .member-profiles-table__cell');
    if (!cells.length) return;

    // 每列期望的最小宽度：从现有覆盖 / 默认宽度出发
    const desired = {};
    COLUMNS.forEach((c) => {
      desired[c.key] = Math.max(
        parsePx(c.width),
        colWidthOverrides[c.key] || 0
      );
    });

    cells.forEach((el) => {
      const td = el.closest('td[data-col-key]');
      if (!td) return;
      const key = td.getAttribute('data-col-key');
      if (!key) return;
      // 编号、姓名、入学年份、加入时间这些固定短列不做自动加宽
      if (key === 'name' || key === 'enrollment_year' || key === 'joined_at_display') return;

      // 计算实际行数
      const cs = getComputedStyle(el);
      const lineHeight = parseFloat(cs.lineHeight) || 22;
      const height = el.scrollHeight;
      const lines = Math.round(height / lineHeight);
      if (lines <= MAX_LINES) return;

      // 超过 4 行：按"当前宽度 × (lines / MAX_LINES)"放大列宽
      const currentW = td.getBoundingClientRect().width || parsePx(
        (COLUMNS.find((c) => c.key === key) || {}).width
      ) || 200;
      const scaled = Math.ceil((currentW * lines) / MAX_LINES);
      const next = Math.min(MAX_COL_WIDTH, Math.max(desired[key], scaled));
      if (next > desired[key]) desired[key] = next;
    });

    // 只有在结果与上次不同时才 setState，避免死循环
    const prev = lastMeasuredRef.current;
    let changed = false;
    for (const k in desired) {
      if ((prev[k] || 0) !== desired[k]) { changed = true; break; }
    }
    if (changed) {
      lastMeasuredRef.current = desired;
      // 只把"大于默认宽度"的那些 key 放进 overrides
      const overrides = {};
      COLUMNS.forEach((c) => {
        const base = parsePx(c.width);
        if ((desired[c.key] || 0) > base) overrides[c.key] = desired[c.key];
      });
      setColWidthOverrides(overrides);
    }
  }, [profiles, editingId, colWidthOverrides]);

  /** 取某列的最终最小宽度（字符串形式，供 style.minWidth 使用） */
  const getColMinWidth = (col) => {
    const override = colWidthOverrides[col.key];
    if (override) return `${override}px`;
    return col.width;
  };

  const isOwnRow = (profile) => profile.user_id === user?.id;

  return (
    <div className="member-profiles-page">
      <div className="container">
        <div className="member-profiles-page__header">
          <div>
            <h1>
              <Users size={28} /> <EditableText as="span" value={(mp.pageTitle && mp.pageTitle !== '成员信息') ? mp.pageTitle : '成员通讯录'} configKey="memberProfiles.pageTitle" onChange={v => updateMP('pageTitle', v)} />
            </h1>
            <EditableText as="p" value={mp.pageDesc || '了解每位成员的基本信息、去向与兴趣，促进彼此交流。可以直接在养老院校友群内添加具体校友'} configKey="memberProfiles.pageDesc" onChange={v => updateMP('pageDesc', v)} />
          </div>
          <div className="member-profiles-page__stats">
            <span className="member-profiles-page__stat">
              共 <strong>{profiles.length}</strong> 位成员
            </span>
          </div>
        </div>

        <div className="member-profiles-page__hint">
          💡 {isAdmin
            ? '管理员模式：你可以编辑所有成员的信息。表格可左右滚动查看更多列。'
            : '点击你那一行右侧的编辑按钮即可修改自己的信息。表格可左右滚动查看更多列。'
          }
        </div>

        {/* 云端加载状态横幅：partial / error / loading 三态 */}
        {cloudStatus === 'loading' && profiles.length === 0 && (
          <div className="member-profiles-cloud-banner member-profiles-cloud-banner--loading">
            <Loader2 size={16} className="member-profiles-cloud-banner__spin" />
            <span>正在加载成员列表…</span>
          </div>
        )}
        {cloudStatus === 'partial' && (
          <div className="member-profiles-cloud-banner member-profiles-cloud-banner--warn">
            <AlertCircle size={16} />
            <span>
              暂时无法连接云端，当前显示的是本地缓存，可能不完整。
            </span>
            <button
              type="button"
              className="member-profiles-cloud-banner__btn"
              onClick={() => loadProfiles({ force: true })}
              disabled={cloudStatus === 'loading'}
            >
              <RefreshCw size={14} />
              <span>重试</span>
            </button>
          </div>
        )}
        {cloudStatus === 'error' && (
          <div className="member-profiles-cloud-banner member-profiles-cloud-banner--error">
            <AlertCircle size={16} />
            <span>
              未能加载云端成员列表。请检查网络/代理/广告拦截插件后重试。
            </span>
            <button
              type="button"
              className="member-profiles-cloud-banner__btn"
              onClick={() => loadProfiles({ force: true })}
              disabled={cloudStatus === 'loading'}
            >
              <RefreshCw size={14} />
              <span>重试</span>
            </button>
          </div>
        )}

        {/* 滚动控制 */}
        <div className="member-profiles-table-controls">
          <button
            className="member-profiles-table-controls__btn"
            onClick={() => scrollTable('left')}
            title="向左滚动"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="member-profiles-table-controls__btn"
            onClick={() => scrollTable('right')}
            title="向右滚动"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="member-profiles-table-wrapper" ref={tableRef}>
          <table className="member-profiles-table">
            <thead>
              <tr>
                <th className="member-profiles-table__sticky-col">#</th>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    style={{ minWidth: getColMinWidth(col) }}
                    className={col.key === 'name' ? 'member-profiles-table__name-col' : undefined}
                  >
                    {col.label}
                  </th>
                ))}
                <th className="member-profiles-table__action-col">操作</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile, idx) => {
                const isEditing = editingId === profile.user_id;
                const isSelf = isOwnRow(profile);

                return (
                  <tr
                    key={profile.user_id}
                    className={`
                      ${isSelf ? 'member-profiles-table__row--self' : ''}
                      ${isEditing ? 'member-profiles-table__row--editing' : ''}
                    `}
                  >
                    <td className="member-profiles-table__sticky-col member-profiles-table__index">
                      {idx + 1}
                    </td>
                    {COLUMNS.map((col) => (
                      <td
                        key={col.key}
                        data-col-key={col.key}
                        style={{ minWidth: getColMinWidth(col) }}
                        className={col.key === 'name' ? 'member-profiles-table__name-col' : undefined}
                      >
                        {isEditing && col.editable ? (
                          col.inputType === 'yearMonth' ? (
                            <div className="member-profiles-table__year-month">
                              <CustomSelect
                                size="sm"
                                className="member-profiles-table__select"
                                placeholder="年"
                                value={editData._joined_year ? String(editData._joined_year) : ''}
                                onChange={(v) =>
                                  setEditData({ ...editData, _joined_year: v ? Number(v) : '' })
                                }
                                options={[
                                  { value: '', label: '年' },
                                  ...YEAR_OPTIONS.map((y) => ({ value: String(y), label: String(y) })),
                                ]}
                              />
                              <span className="member-profiles-table__year-month-sep">年</span>
                              <CustomSelect
                                size="sm"
                                className="member-profiles-table__select"
                                placeholder="月"
                                value={editData._joined_month ? String(editData._joined_month) : ''}
                                onChange={(v) =>
                                  setEditData({ ...editData, _joined_month: v ? Number(v) : '' })
                                }
                                options={[
                                  { value: '', label: '月' },
                                  ...MONTH_OPTIONS.map((m) => ({ value: String(m), label: String(m) })),
                                ]}
                              />
                              <span className="member-profiles-table__year-month-sep">月</span>
                            </div>
                          ) : (
                            <textarea
                              className="member-profiles-table__input member-profiles-table__input--textarea"
                              rows={1}
                              value={editData[col.key] || ''}
                              onChange={(e) => {
                                setEditData({ ...editData, [col.key]: e.target.value });
                                // 内容变化时自适应高度
                                const el = e.target;
                                el.style.height = 'auto';
                                el.style.height = `${el.scrollHeight}px`;
                              }}
                              onFocus={(e) => {
                                // 进入编辑时也按内容撑开一次
                                const el = e.target;
                                el.style.height = 'auto';
                                el.style.height = `${el.scrollHeight}px`;
                              }}
                              ref={(el) => {
                                // 每次渲染后根据当前内容撑开高度
                                if (el) {
                                  el.style.height = 'auto';
                                  el.style.height = `${el.scrollHeight}px`;
                                }
                              }}
                              placeholder={col.placeholder}
                              autoFocus={col.key === 'enrollment_year'}
                            />
                          )
                        ) : (
                          <span
                            className={`member-profiles-table__cell ${
                              !profile[col.key] ? 'member-profiles-table__cell--empty' : ''
                            }${
                              (col.key === 'joined_at_display' || col.key === 'enrollment_year') ? ' member-profiles-table__cell--nowrap' : ''
                            }`}
                          >
                            {col.key === 'name' && isSelf ? (
                              <span className="member-profiles-table__name-cell">
                                <span className="member-profiles-table__name-text">{profile[col.key]}</span>
                                <span className="member-profiles-table__self-badge">我</span>
                              </span>
                            ) : (
                              profile[col.key] || '—'
                            )}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="member-profiles-table__action-col">
                      {(isSelf || isAdmin) && !isEditing && (
                        <button
                          className="member-profiles-table__edit-btn"
                          onClick={() => startEdit(profile)}
                          title={isSelf ? '编辑我的信息' : '编辑该成员信息（管理员）'}
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                      {isEditing && (
                        <div className="member-profiles-table__edit-actions">
                          <button
                            className="member-profiles-table__save-btn"
                            onClick={saveEdit}
                            disabled={saving}
                            title="保存"
                          >
                            {saving ? (
                              <Loader2 size={14} className="member-profiles-cloud-banner__spin" />
                            ) : (
                              <Check size={14} />
                            )}
                          </button>
                          <button
                            className="member-profiles-table__cancel-btn"
                            onClick={cancelEdit}
                            title="取消"
                          >
                            <X size={14} />
                          </button>
                          {/* saveMsg 以前作为 absolute 子节点内联渲染在这里，
                              但父级 td 是 sticky 列 + 祖先容器 overflow: auto，
                              会把它的下半部分裁掉 / 被下一行的 sticky 列盖住。
                              现已挪到页面根节点的 toast 区（见组件底部）。 */}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {profiles.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 2} className="member-profiles-table__empty">
                    <Users size={40} />
                    <p>暂无成员通讯录</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 保存反馈 Toast：位于页面根节点末尾，position: fixed 脱离表格
          sticky 列 / overflow 容器的堆叠环境，确保提示永远浮在最上层、
          不会被下一行的 sticky 操作列遮挡。 */}
      {saveMsg && (
        <div
          className={`member-profiles-save-toast member-profiles-save-toast--${saveMsg.type}`}
          role="alert"
        >
          <span className="member-profiles-save-toast__text">{saveMsg.text}</span>
          <button
            type="button"
            className="member-profiles-save-toast__close"
            onClick={() => setSaveMsg(null)}
            aria-label="关闭提示"
            title="关闭"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
