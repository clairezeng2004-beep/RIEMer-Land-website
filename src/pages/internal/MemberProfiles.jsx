import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useWysiwyg } from '../../contexts/WysiwygContext';
import EditableText from '../../components/EditableText';
import {
  Users,
  Pencil,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import './MemberProfiles.css';

// ============================================
// 表格列定义
// ============================================
const COLUMNS = [
  { key: 'name', label: '姓名', width: '90px', editable: false },
  { key: 'enrollment_year', label: '入学年份', width: '100px', editable: true, placeholder: '如 2023' },
  { key: 'joined_at_display', label: '加入时间', width: '140px', editable: true, inputType: 'yearMonth' },
  { key: 'bio', label: '一句话概括自己', width: '180px', editable: true, placeholder: '用一句话介绍自己' },
  { key: 'further_education', label: '升学去向', width: '150px', editable: true, placeholder: '如 XX大学XX专业' },
  { key: 'career', label: '工作去向', width: '150px', editable: true, placeholder: '如 XX公司XX岗位' },
  { key: 'willing_to_share', label: '我愿意分享什么', width: '180px', editable: true, placeholder: '你愿意和大家分享的内容' },
  { key: 'want_to_learn', label: '我想和大家请教什么', width: '180px', editable: true, placeholder: '你想请教大家的问题' },
  { key: 'hobbies', label: '爱好', width: '150px', editable: true, placeholder: '如 摄影、阅读、运动' },
  { key: 'dream_city', label: '未来想定居的城市', width: '150px', editable: true, placeholder: '如 北京、上海' },
  { key: 'other', label: '其他', width: '180px', editable: true, placeholder: '任何想补充的内容' },
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
// MemberProfiles 组件
// ============================================
export default function MemberProfiles() {
  const { user, isAuthenticated, isAdmin, getAllUsers, supabaseOk } = useAuth();
  const { internalConfig, updateInternalConfig } = useSiteContent();
  const { editing } = useWysiwyg();
  const mp = internalConfig.memberProfiles || {};
  const updateMP = useCallback((key, val) => updateInternalConfig({ memberProfiles: { [key]: val } }), [updateInternalConfig]);
  const [profiles, setProfiles] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  const tableRef = useRef(null);

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
          hobbies: '',
          dream_city: '',
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

  // 加载成员信息
  const loadProfiles = useCallback(async () => {
    if (!isAuthenticated) return;

    // 只有 supabaseOk === true 时才走 Supabase 路径
    const useSupabase = isSupabaseConfigured && supabaseOk === true;

    if (useSupabase) {
      // Supabase 模式：从 member_profiles 表加载
      let { data, error } = await supabase
        .from('member_profiles')
        .select('*, profiles(name, created_at)')
        .order('joined_at', { ascending: true });

      // 查询失败时尝试刷新 session 后重试
      if (error) {
        console.warn('[MemberProfiles] Supabase 查询失败:', error.message, '，尝试刷新 session...');
        try {
          const { data: refreshData } = await supabase.auth.refreshSession();
          if (refreshData?.session) {
            console.log('[MemberProfiles] Session 刷新成功，重试查询...');
            const retry = await supabase
              .from('member_profiles')
              .select('*, profiles(name, created_at)')
              .order('joined_at', { ascending: true });
            data = retry.data;
            error = retry.error;
          }
        } catch (refreshErr) {
          console.warn('[MemberProfiles] Session 刷新异常:', refreshErr.message);
        }
      }

      if (error) {
        console.error('[MemberProfiles] Supabase 加载最终失败，降级本地模式:', error.message);
        // 降级到本地模式
        await loadLocalFallback();
        return;
      }

      // 检查当前用户是否有记录，没有则自动创建
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
          hobbies: '',
          dream_city: '',
          other: '',
          joined_at: user.created_at || new Date().toISOString(),
        };
        const { error: insertError } = await supabase
          .from('member_profiles')
          .insert(newProfile);
        if (!insertError) {
          // 重新加载
          loadProfiles();
          return;
        }
      }

      // 转换为前端格式
      const formatted = (data || []).map((p) => ({
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
        hobbies: p.hobbies || '',
        dream_city: p.dream_city || '',
        other: p.other || '',
      }));
      setProfiles(formatted);
    } else {
      await loadLocalFallback();
    }
  }, [isAuthenticated, user, getAllUsers, supabaseOk, loadLocalFallback]);

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

  const isOwnRow = (profile) => profile.user_id === user?.id;

  return (
    <div className="member-profiles-page">
      <div className="container">
        <div className="member-profiles-page__header">
          <div>
            <h1>
              <Users size={28} /> <EditableText as="span" value={mp.pageTitle || '成员通讯录'} configKey="memberProfiles.pageTitle" onChange={v => updateMP('pageTitle', v)} />
            </h1>
            <EditableText as="p" value={mp.pageDesc || '了解每位成员的基本信息、去向与兴趣，促进彼此交流'} configKey="memberProfiles.pageDesc" onChange={v => updateMP('pageDesc', v)} />
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
                  <th key={col.key} style={{ minWidth: col.width }}>
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
                      <td key={col.key}>
                        {isEditing && col.editable ? (
                          col.inputType === 'yearMonth' ? (
                            <div className="member-profiles-table__year-month">
                              <select
                                className="member-profiles-table__select"
                                value={editData._joined_year || ''}
                                onChange={(e) =>
                                  setEditData({ ...editData, _joined_year: e.target.value ? Number(e.target.value) : '' })
                                }
                              >
                                <option value="">年</option>
                                {YEAR_OPTIONS.map((y) => (
                                  <option key={y} value={y}>{y}</option>
                                ))}
                              </select>
                              <span className="member-profiles-table__year-month-sep">年</span>
                              <select
                                className="member-profiles-table__select"
                                value={editData._joined_month || ''}
                                onChange={(e) =>
                                  setEditData({ ...editData, _joined_month: e.target.value ? Number(e.target.value) : '' })
                                }
                              >
                                <option value="">月</option>
                                {MONTH_OPTIONS.map((m) => (
                                  <option key={m} value={m}>{m}</option>
                                ))}
                              </select>
                              <span className="member-profiles-table__year-month-sep">月</span>
                            </div>
                          ) : (
                            <input
                              className="member-profiles-table__input"
                              type="text"
                              value={editData[col.key] || ''}
                              onChange={(e) =>
                                setEditData({ ...editData, [col.key]: e.target.value })
                              }
                              placeholder={col.placeholder}
                              autoFocus={col.key === 'enrollment_year'}
                            />
                          )
                        ) : (
                          <span
                            className={`member-profiles-table__cell ${
                              !profile[col.key] ? 'member-profiles-table__cell--empty' : ''
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
