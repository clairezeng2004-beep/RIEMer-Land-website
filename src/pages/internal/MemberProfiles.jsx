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
  { key: 'favorites', label: '喜欢的音乐/作家/UP主/书籍/演员/影视剧等', width: '380px', editable: true, placeholder: '如 周杰伦、村上春树、老番茄、《三体》...' },
  { key: 'other', label: '其他', width: '220px', editable: true, placeholder: '任何想补充的内容' },
];

// 生成年份选项（从 2015 到当前年份 +1）
const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: currentYear - 2015 + 2 }, (_, i) => 2015 + i);
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

// 将 ISO 日期转为 { year, month }
function dateToYearMonth(dateStr) {
  if (!dateStr) return { year: '', month: '' };
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return { year: '', month: '' };
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
// ============================================
function formatProfilesFromSupabase(rows) {
  return (rows || []).map((p) => ({
    id: p.user_id,
    user_id: p.user_id,
    name: p.profiles?.name || '未知用户',
    enrollment_year: p.enrollment_year || '',
    joined_at: p.joined_at || p.profiles?.created_at || '',
    joined_at_display: (() => {
      const raw = p.joined_at || p.profiles?.created_at;
      if (!raw) return '';
      const d = new Date(raw);
      return isNaN(d.getTime()) ? '' : `${d.getFullYear()}年${d.getMonth() + 1}月`;
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
  }));
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
            if (!p.joined_at) return '';
            const d = new Date(p.joined_at);
            return isNaN(d.getTime()) ? '' : `${d.getFullYear()}年${d.getMonth() + 1}月`;
          })(),
        })).sort((a, b) => new Date(a.joined_at) - new Date(b.joined_at));
      }
    } catch { /* ignore */ }
    return [];
  });
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
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
            if (!p.joined_at) return '';
            const d = new Date(p.joined_at);
            return isNaN(d.getTime()) ? '' : `${d.getFullYear()}年${d.getMonth() + 1}月`;
          })(),
        };
      })
      .sort((a, b) => new Date(a.joined_at) - new Date(b.joined_at));

    setProfiles(formatted);
  }, [getAllUsers]);

  // ============================================
  // 真正从 Supabase 拉一次成员列表
  // 返回：{ ok: boolean, data?: formatted[], error?: string }
  // 失败时尝试一次 refreshSession 再重试，再失败才算 ok=false
  // ============================================
  const fetchFromSupabase = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      return { ok: false, error: 'Supabase 未配置' };
    }
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

    if (error) {
      return { ok: false, error: error.message || '未知错误' };
    }
    return { ok: true, data: formatProfilesFromSupabase(data) };
  }, []);

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
  };

  // 保存编辑
  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);

    try {
      // 计算加入时间
      const newJoinedAt = yearMonthToDate(editData._joined_year, editData._joined_month);

      if (isSupabaseConfigured && supabaseOk === true) {
        const updateData = {};
        COLUMNS.forEach((col) => {
          if (col.editable && col.key !== 'joined_at_display' && editData[col.key] !== undefined) {
            updateData[col.key] = editData[col.key];
          }
        });
        // 加入时间单独处理
        if (newJoinedAt) {
          updateData.joined_at = newJoinedAt;
        }

        const { error } = await supabase
          .from('member_profiles')
          .update(updateData)
          .eq('user_id', editingId);

        if (error) {
          console.error('[MemberProfiles] Save failed:', error);
          alert('保存失败，请重试');
          setSaving(false);
          return;
        }
      } else {
        // 本地模式
        const localProfiles = getLocalProfiles();
        const idx = localProfiles.findIndex((p) => p.user_id === editingId);
        if (idx >= 0) {
          COLUMNS.forEach((col) => {
            if (col.editable && col.key !== 'joined_at_display' && editData[col.key] !== undefined) {
              localProfiles[idx][col.key] = editData[col.key];
            }
          });
          // 加入时间单独处理
          if (newJoinedAt) {
            localProfiles[idx].joined_at = newJoinedAt;
          }
          saveLocalProfiles(localProfiles);
        }
      }

      await loadProfiles();
      setEditingId(null);
      setEditData({});
    } catch (err) {
      console.error('[MemberProfiles] Save error:', err);
      alert('保存失败，请重试');
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
                            title={
                              col.key === 'name' || !profile[col.key]
                                ? undefined
                                : String(profile[col.key])
                            }
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
                            <Check size={14} />
                          </button>
                          <button
                            className="member-profiles-table__cancel-btn"
                            onClick={cancelEdit}
                            title="取消"
                          >
                            <X size={14} />
                          </button>
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
    </div>
  );
}
