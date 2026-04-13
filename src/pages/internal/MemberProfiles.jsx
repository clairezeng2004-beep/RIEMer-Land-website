import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
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
  { key: 'joined_at_display', label: '加入时间', width: '110px', editable: false },
  { key: 'bio', label: '一句话概括自己', width: '180px', editable: true, placeholder: '用一句话介绍自己' },
  { key: 'further_education', label: '升学去向', width: '150px', editable: true, placeholder: '如 XX大学XX专业' },
  { key: 'career', label: '工作去向', width: '150px', editable: true, placeholder: '如 XX公司XX岗位' },
  { key: 'willing_to_share', label: '我愿意分享什么', width: '180px', editable: true, placeholder: '你愿意和大家分享的内容' },
  { key: 'want_to_learn', label: '我想和大家请教什么', width: '180px', editable: true, placeholder: '你想请教大家的问题' },
  { key: 'hobbies', label: '爱好', width: '150px', editable: true, placeholder: '如 摄影、阅读、运动' },
  { key: 'dream_city', label: '未来想定居的城市', width: '150px', editable: true, placeholder: '如 北京、上海' },
  { key: 'other', label: '其他', width: '180px', editable: true, placeholder: '任何想补充的内容' },
];

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
  const { user, isAuthenticated, getAllUsers } = useAuth();
  const [profiles, setProfiles] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  const tableRef = useRef(null);

  // 加载成员信息
  const loadProfiles = useCallback(async () => {
    if (!isAuthenticated) return;

    if (isSupabaseConfigured) {
      // Supabase 模式：从 member_profiles 表加载
      const { data, error } = await supabase
        .from('member_profiles')
        .select('*, profiles(name, created_at)')
        .order('joined_at', { ascending: true });

      if (error) {
        console.error('[MemberProfiles] Failed to load:', error);
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
        joined_at_display: p.joined_at || p.profiles?.created_at
          ? new Date(p.joined_at || p.profiles?.created_at).toLocaleDateString('zh-CN')
          : '',
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
      // 本地模式
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
            joined_at_display: p.joined_at
              ? new Date(p.joined_at).toLocaleDateString('zh-CN')
              : '',
          };
        })
        .sort((a, b) => new Date(a.joined_at) - new Date(b.joined_at));

      setProfiles(formatted);
    }
  }, [isAuthenticated, user, getAllUsers]);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  // 开始编辑
  const startEdit = (profile) => {
    setEditingId(profile.user_id);
    setEditData({ ...profile });
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
      if (isSupabaseConfigured) {
        const updateData = {};
        COLUMNS.forEach((col) => {
          if (col.editable && editData[col.key] !== undefined) {
            updateData[col.key] = editData[col.key];
          }
        });

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
            if (col.editable && editData[col.key] !== undefined) {
              localProfiles[idx][col.key] = editData[col.key];
            }
          });
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
              <Users size={28} /> 成员信息
            </h1>
            <p>了解每位成员的基本信息、去向与兴趣，促进彼此交流</p>
          </div>
          <div className="member-profiles-page__stats">
            <span className="member-profiles-page__stat">
              共 <strong>{profiles.length}</strong> 位成员
            </span>
          </div>
        </div>

        <div className="member-profiles-page__hint">
          💡 点击你那一行右侧的编辑按钮即可修改自己的信息。表格可左右滚动查看更多列。
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
                        ) : (
                          <span
                            className={`member-profiles-table__cell ${
                              !profile[col.key] ? 'member-profiles-table__cell--empty' : ''
                            }`}
                          >
                            {col.key === 'name' && isSelf ? (
                              <>
                                {profile[col.key]}
                                <span className="member-profiles-table__self-badge">我</span>
                              </>
                            ) : (
                              profile[col.key] || '—'
                            )}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="member-profiles-table__action-col">
                      {isSelf && !isEditing && (
                        <button
                          className="member-profiles-table__edit-btn"
                          onClick={() => startEdit(profile)}
                          title="编辑我的信息"
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
                    <p>暂无成员信息</p>
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
