import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { fetchAndParseArticle, cleanTitle, generateSummary, inferCategory, inferTags } from '../../services/articleService';
import {
  Settings,
  Save,
  RotateCcw,
  Type,
  BarChart3,
  FileText,
  MapPin,
  Mail,
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  Filter,
  Pencil,
  X,
  Link2,
  Loader2,
  ExternalLink,
  Tag,
  Calendar,
  LayoutGrid,
  User,
  Users,
  Clock,
  Video,
  Lock,
  Eye,
  EyeOff,
  GitBranch,
  Star,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import CustomSelect from '../../components/CustomSelect';
import './ContentManagement.css';

export default function ContentManagement() {
  const { isAuthenticated, isAdmin, user, getAllUsers, supabaseOk } = useAuth();
  const { content, updateContent, resetContent, filterOptions, updateFilterOptions, resetFilterOptions, userArticles, addArticle, updateArticle, deleteArticle, internalConfig, updateInternalConfig, resetInternalConfig, events, addEvent, updateEvent, deleteEvent, timeline, updateTimeline, addTimelineNode, updateTimelineNode, deleteTimelineNode, resetTimeline, syncTeamMembersFromDB, cloudSyncStatus, flushSettingToCloud, SITE_KEYS } = useSiteContent();
  const { addNotification } = useNotifications();

  // 本地编辑状态
  const [form, setForm] = useState({ ...content });
  const [filtersForm, setFiltersForm] = useState({ ...filterOptions });
  const [internalForm, setInternalForm] = useState(JSON.parse(JSON.stringify(internalConfig)));
  const [saved, setSaved] = useState(false);
  // 保存后展示的"云同步"结果：
  //   null = 未保存；'syncing' = 正在推云；'ok' = 全部成功；'partial' = 本地存了但云失败
  //   failureDetail：失败时的错误明细数组（按 key 分条），给出人话定位根因
  const [cloudSaveState, setCloudSaveState] = useState({ phase: null, failures: [] });
  const [activeTab, setActiveTab] = useState('hero');

  // 编辑中的成员索引
  const [editingMemberIndex, setEditingMemberIndex] = useState(null);
  const [syncingMembers, setSyncingMembers] = useState(false);

  // 文章管理状态
  const [articleUrl, setArticleUrl] = useState('');
  const [fetchingArticle, setFetchingArticle] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [editingArticle, setEditingArticle] = useState(null); // 正在编辑的文章（新建或修改）
  const [editingArticleId, setEditingArticleId] = useState(null); // 正在编辑的已有文章 ID

  // 活动管理状态
  const [editingEvent, setEditingEvent] = useState(null); // 新建/编辑中的活动
  const [editingEventId, setEditingEventId] = useState(null); // 正在编辑的已有活动 ID

  // 已授权成员数据（关于我们TAB展示）
  const [authorizedMembers, setAuthorizedMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const memberTableRef = useRef(null);

  const scrollMemberTable = (direction) => {
    if (memberTableRef.current) {
      memberTableRef.current.scrollBy({
        left: direction === 'left' ? -300 : 300,
        behavior: 'smooth',
      });
    }
  };

  const loadAuthorizedMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      if (isSupabaseConfigured && supabaseOk === true) {
        // Supabase 模式：获取已授权成员 + member_profiles 完整信息
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, name, nickname, avatar, signature, authorized')
          .eq('authorized', true);

        const { data: memberProfiles } = await supabase
          .from('member_profiles')
          .select('user_id, enrollment_year, bio, willing_to_share, want_to_learn, career_interest, dream_city, hobbies, favorites, other, joined_at');

        if (profiles) {
          const mpMap = {};
          (memberProfiles || []).forEach((mp) => {
            mpMap[mp.user_id] = mp;
          });

          setAuthorizedMembers(
            profiles.map((p) => {
              const mp = mpMap[p.id] || {};
              return {
                id: p.id,
                name: p.name || '',
                nickname: p.nickname || '',
                avatar: p.avatar || null,
                signature: p.signature || '',
                enrollment_year: mp.enrollment_year || '',
                bio: mp.bio || '',
                willing_to_share: mp.willing_to_share || '',
                want_to_learn: mp.want_to_learn || '',
                career_interest: mp.career_interest || '',
                dream_city: mp.dream_city || '',
                hobbies: mp.hobbies || '',
                favorites: mp.favorites || '',
                other: mp.other || '',
                joined_at: mp.joined_at || '',
              };
            })
          );
          return;
        }
      }
      // 本地模式
      const allUsers = await getAllUsers();
      const MEMBER_PROFILES_KEY = 'riemer_member_profiles';
      const profilesRaw = localStorage.getItem(MEMBER_PROFILES_KEY);
      const localProfiles = profilesRaw ? JSON.parse(profilesRaw) : [];
      const mpMap = {};
      localProfiles.forEach((p) => {
        mpMap[p.user_id] = p;
      });

      const authorized = allUsers.filter((u) => u.authorized);
      setAuthorizedMembers(
        authorized.map((u) => {
          const mp = mpMap[u.id] || {};
          return {
            id: u.id,
            name: u.name || '',
            nickname: u.nickname || '',
            avatar: u.avatar || null,
            signature: u.signature || '',
            enrollment_year: mp.enrollment_year || '',
            bio: mp.bio || '',
            willing_to_share: mp.willing_to_share || '',
            want_to_learn: mp.want_to_learn || '',
            career_interest: mp.career_interest || '',
            dream_city: mp.dream_city || '',
            hobbies: mp.hobbies || '',
            favorites: mp.favorites || '',
            other: mp.other || '',
            joined_at: mp.joined_at || '',
          };
        })
      );
    } catch (err) {
      console.error('[ContentManagement] 加载成员失败:', err);
    } finally {
      setLoadingMembers(false);
    }
  }, [getAllUsers]);

  // 当切换到 timeline tab 时自动加载成员
  useEffect(() => {
    if (activeTab === 'timeline') {
      loadAuthorizedMembers();
    }
  }, [activeTab, loadAuthorizedMembers]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const handleSave = async () => {
    // 1) 先把本地 state 写入 context（触发 localStorage + 原有去抖 push）
    updateContent(form);
    updateFilterOptions(filtersForm);
    updateInternalConfig(internalForm);
    setSaved(true);

    // 2) 再显式 await 关键 key 的云端写入，这样我们能**真实**知道成没成
    //    这里包含筛选项 / 公开内容 / 内部空间配置（侧边栏 Tab 名称、流程模板/
    //    内部文档的 extraTypeKeys/hiddenBuiltinKeys 等）三大类"所有成员都会看到"
    //    的配置。internalConfig 过去是靠 flushInternalConfig 单独落盘，
    //    但点击"保存"后没有立即 flush，用户一旦立刻刷新/切 tab，400ms 去抖窗口
    //    内云端还没写；现在统一走 flushSettingToCloud 立即推送并 await 返回。
    setCloudSaveState({ phase: 'syncing', failures: [] });
    const targets = [
      { key: SITE_KEYS.PUBLIC_CONTENT,   value: form,         label: '首页内容' },
      { key: SITE_KEYS.FILTER_OPTIONS,   value: filtersForm,  label: '筛选项' },
      { key: SITE_KEYS.INTERNAL_CONFIG,  value: internalForm, label: '内部空间配置' },
    ];
    const failures = [];
    for (const t of targets) {
      // flushSettingToCloud 会取消掉正在排队的去抖 push，走立即 upsert 并等待回包
      // 串行以便错误信息顺序稳定，目标数量很少（2~3 条），开销可忽略
      // eslint-disable-next-line no-await-in-loop
      const res = await flushSettingToCloud(t.key, t.value);
      if (!res?.success) {
        failures.push({ label: t.label, key: t.key, error: res?.error || '未知错误' });
      }
    }
    setCloudSaveState({
      phase: failures.length === 0 ? 'ok' : 'partial',
      failures,
    });
    // 绿条 / 错误条分别决定消失时间：成功 2.5s 收起，失败留着让用户看清
    if (failures.length === 0) {
      setTimeout(() => {
        setSaved(false);
        setCloudSaveState({ phase: null, failures: [] });
      }, 2500);
    } else {
      // 把顶部绿色"已保存"去掉，只留下失败的红条
      setSaved(false);
    }
  };

  const handleReset = () => {
    if (window.confirm('确定要重置所有内容为默认值吗？此操作不可撤销。')) {
      resetContent();
      resetFilterOptions();
      resetInternalConfig();
      resetTimeline();
      setForm({ ...content });
      setFiltersForm({ ...filterOptions });
      // 需要从 context 获取重置后的值
      window.location.reload();
    }
  };

  const updateStat = (index, field, value) => {
    const newStats = [...form.stats];
    newStats[index] = { ...newStats[index], [field]: value };
    setForm({ ...form, stats: newStats });
  };

  const addStat = () => {
    setForm({ ...form, stats: [...form.stats, { label: '', value: '' }] });
  };

  const removeStat = (index) => {
    setForm({ ...form, stats: form.stats.filter((_, i) => i !== index) });
  };

  const tabs = [
    { id: 'hero', label: 'Hero 区域', icon: <Type size={16} /> },
    { id: 'stats', label: '数据统计', icon: <BarChart3 size={16} /> },
    { id: 'filters', label: '筛选选项', icon: <Filter size={16} /> },
    { id: 'articles', label: '文章板块', icon: <FileText size={16} /> },
    { id: 'events', label: '活动管理', icon: <Video size={16} /> },
    { id: 'timeline', label: '关于我们', icon: <GitBranch size={16} /> },
    { id: 'footer', label: '页脚信息', icon: <MapPin size={16} /> },
    { id: 'internal', label: '内部空间', icon: <LayoutGrid size={16} /> },
  ];

  return (
    <div className="content-mgmt">
      <div className="container">
        <div className="content-mgmt__header">
          <div>
            <h1>
              <Settings size={28} /> 内容管理
            </h1>
            <p>编辑网站首页展示的文字内容</p>
          </div>
          {isAdmin && (
            <div className="content-mgmt__header-actions">
              <button className="btn btn-ghost" onClick={handleReset}>
                <RotateCcw size={16} /> 重置默认
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                <Save size={16} /> 保存更改
              </button>
            </div>
          )}
        </div>

        {!isAdmin && (
          <div className="content-mgmt__readonly-banner">
            <Eye size={16} />
            <span>当前为只读模式，仅管理员可编辑内容</span>
          </div>
        )}

        {saved && cloudSaveState.phase !== 'partial' && (
          <div className="content-mgmt__toast">
            <CheckCircle size={18} />
            <span>
              {cloudSaveState.phase === 'syncing'
                ? '已保存到本设备，正在同步到云端…'
                : cloudSaveState.phase === 'ok'
                  ? '内容已保存并同步到云端，其他设备将在几秒内更新'
                  : '内容已保存，刷新首页即可查看更改'}
            </span>
          </div>
        )}

        {/*
          云端同步失败明细横幅
          -----------------------------------------
          背景：多次反馈"筛选项编辑后在另一台设备看不到新值"。
          根因 99% 在三件事上：
            1) Supabase 里 site_settings 表不存在 / RLS 没建好 → saveSetting 返 error
            2) 当前登录账号的 profiles.role 不是 'admin' → write policy 拒绝
            3) 未开启 site_settings 的 realtime 发布 → 第二台设备要手动刷新才更新
          之前代码只 console.warn 吞掉，用户以为保存成功就离开页面；
          现在把错误原文直接挂在顶部红条里，让用户一眼看到"保存到本地、但云端失败"。
          同时给到"再次尝试同步"按钮，避免因为网络抖动造成的一次性失败。
        */}
        {cloudSaveState.phase === 'partial' && (
          <div className="content-mgmt__toast content-mgmt__toast--error">
            <AlertCircle size={18} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <strong>已保存到本设备，但云端同步失败，其他设备可能看不到此次修改</strong>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: '13px', lineHeight: 1.55 }}>
                {cloudSaveState.failures.map((f) => (
                  <li key={f.key}>
                    <code style={{ background: 'rgba(0,0,0,0.05)', padding: '1px 5px', borderRadius: 3 }}>{f.label}</code>
                    ：{f.error}
                  </li>
                ))}
              </ul>
              <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: 2 }}>
                常见原因：Supabase 未登录 / 当前账号不是 admin / site_settings 表未建 → 可用
                仓库根目录的 <code>supabase-debug-site-settings.sql</code> 在 Supabase
                SQL Editor 里一键诊断 + 修复。
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: '4px 12px', fontSize: 13 }}
                  onClick={() => handleSave()}
                >
                  再次尝试同步
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: '4px 12px', fontSize: 13 }}
                  onClick={() => setCloudSaveState({ phase: null, failures: [] })}
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="content-mgmt__layout">
          {/* 左侧标签导航 */}
          <div className="content-mgmt__tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`content-mgmt__tab ${activeTab === tab.id ? 'content-mgmt__tab--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* 右侧编辑区 */}
          <div className={`content-mgmt__panel ${!isAdmin ? 'content-mgmt__panel--readonly' : ''}`}>

            {/* Hero 区域 */}
            {activeTab === 'hero' && (
              <div className="content-mgmt__section">
                <h3 className="content-mgmt__section-title">Hero 区域</h3>
                <p className="content-mgmt__section-desc">首页顶部的标题和介绍文字</p>

                <div className="content-mgmt__field">
                  <label>标语</label>
                  <input
                    type="text"
                    value={form.heroTagline}
                    onChange={(e) => setForm({ ...form, heroTagline: e.target.value })}
                    className="content-mgmt__input"
                    placeholder="如：探索 · 研究 · 交流"
                  />
                </div>

                <div className="content-mgmt__field">
                  <label>主标题</label>
                  <input
                    type="text"
                    value={form.heroTitle}
                    onChange={(e) => setForm({ ...form, heroTitle: e.target.value })}
                    className="content-mgmt__input"
                    placeholder="如：RIEMer Land"
                  />
                </div>

                <div className="content-mgmt__field">
                  <label>简介描述</label>
                  <textarea
                    value={form.heroDescription}
                    onChange={(e) => setForm({ ...form, heroDescription: e.target.value })}
                    className="content-mgmt__input content-mgmt__textarea"
                    rows={4}
                    placeholder="首页 Hero 区域的描述文字"
                  />
                </div>
              </div>
            )}

            {/* 数据统计 */}
            {activeTab === 'stats' && (
              <div className="content-mgmt__section">
                <h3 className="content-mgmt__section-title">数据统计</h3>
                <p className="content-mgmt__section-desc">首页展示的统计数字</p>

                {form.stats.map((stat, i) => {
                  // 自动计算类：标签锁定，数值由系统根据真实数据计算，不允许手动编辑
                  const AUTO_LABELS = ['公众号累计阅读', '活动讲座', '文章分享'];
                  const isAuto = AUTO_LABELS.includes(stat.label);
                  const autoHint = {
                    公众号累计阅读: '该项由所有归档文章的阅读量自动求和，请在「归档 · 管理阅读量」中录入。',
                    活动讲座: '该项自动统计为当前活动总数。',
                    文章分享: '该项自动统计为所有归档文章数。',
                  }[stat.label];

                  return (
                    <div key={i} className="content-mgmt__inline-group">
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label>
                          标签
                          {isAuto && (
                            <span
                              className="content-mgmt__badge"
                              style={{
                                marginLeft: 6,
                                padding: '1px 6px',
                                fontSize: 11,
                                borderRadius: 4,
                                background: 'rgba(94, 173, 140, 0.15)',
                                color: '#3a7a5e',
                              }}
                            >
                              自动
                            </span>
                          )}
                        </label>
                        <input
                          type="text"
                          value={stat.label}
                          onChange={(e) => updateStat(i, 'label', e.target.value)}
                          className="content-mgmt__input"
                          placeholder="如：活跃成员"
                          disabled={isAuto}
                          title={isAuto ? '自动计算项，标签已锁定' : undefined}
                        />
                      </div>
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label>数值</label>
                        <input
                          type="text"
                          value={stat.value}
                          onChange={(e) => updateStat(i, 'value', e.target.value)}
                          className="content-mgmt__input"
                          placeholder="如：120+"
                          disabled={isAuto}
                          title={isAuto ? autoHint : undefined}
                        />
                        {isAuto && (
                          <small
                            style={{
                              display: 'block',
                              marginTop: 4,
                              fontSize: 11,
                              color: '#888',
                              lineHeight: 1.5,
                            }}
                          >
                            {autoHint}
                          </small>
                        )}
                      </div>
                      <button
                        className="content-mgmt__remove-btn"
                        onClick={() => removeStat(i)}
                        title={isAuto ? '自动计算项，不可删除' : '删除'}
                        disabled={isAuto}
                        style={isAuto ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  );
                })}

                <button className="content-mgmt__add-btn" onClick={addStat}>
                  <Plus size={16} /> 添加统计项
                </button>
              </div>
            )}

            {/* 筛选选项 */}
            {activeTab === 'filters' && (
              <div className="content-mgmt__section">
                <h3 className="content-mgmt__section-title">筛选选项管理</h3>
                <p className="content-mgmt__section-desc">管理事项追踪页面中的分类、状态和团队成员选项</p>

                {/* 事项分类 */}
                <div className="content-mgmt__subsection">
                  <h4 className="content-mgmt__subsection-title">事项分类</h4>
                  {filtersForm.taskCategories.map((cat, i) => (
                    <div key={i} className="content-mgmt__inline-group">
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <input
                          type="text"
                          value={cat}
                          onChange={(e) => {
                            const arr = [...filtersForm.taskCategories];
                            arr[i] = e.target.value;
                            setFiltersForm({ ...filtersForm, taskCategories: arr });
                          }}
                          className="content-mgmt__input"
                          placeholder="分类名称"
                        />
                      </div>
                      <button
                        className="content-mgmt__remove-btn"
                        onClick={() => {
                          setFiltersForm({
                            ...filtersForm,
                            taskCategories: filtersForm.taskCategories.filter((_, idx) => idx !== i),
                          });
                        }}
                        title="删除"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  <button
                    className="content-mgmt__add-btn"
                    onClick={() =>
                      setFiltersForm({
                        ...filtersForm,
                        taskCategories: [...filtersForm.taskCategories, ''],
                      })
                    }
                  >
                    <Plus size={16} /> 添加分类
                  </button>
                </div>

                {/* 事项状态 */}
                <div className="content-mgmt__subsection">
                  <h4 className="content-mgmt__subsection-title">事项状态</h4>
                  {filtersForm.taskStatuses.map((status, i) => (
                    <div key={i} className="content-mgmt__inline-group">
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <input
                          type="text"
                          value={status}
                          onChange={(e) => {
                            const arr = [...filtersForm.taskStatuses];
                            arr[i] = e.target.value;
                            setFiltersForm({ ...filtersForm, taskStatuses: arr });
                          }}
                          className="content-mgmt__input"
                          placeholder="状态名称"
                        />
                      </div>
                      <button
                        className="content-mgmt__remove-btn"
                        onClick={() => {
                          setFiltersForm({
                            ...filtersForm,
                            taskStatuses: filtersForm.taskStatuses.filter((_, idx) => idx !== i),
                          });
                        }}
                        title="删除"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  <button
                    className="content-mgmt__add-btn"
                    onClick={() =>
                      setFiltersForm({
                        ...filtersForm,
                        taskStatuses: [...filtersForm.taskStatuses, ''],
                      })
                    }
                  >
                    <Plus size={16} /> 添加状态
                  </button>
                </div>

                {/* 团队成员 */}
                <div className="content-mgmt__subsection">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                    <h4 className="content-mgmt__subsection-title" style={{ margin: 0 }}>团队成员</h4>
                    <button
                      className="content-mgmt__add-btn"
                      style={{ margin: 0, fontSize: '13px', padding: '4px 12px' }}
                      disabled={syncingMembers}
                      onClick={async () => {
                        setSyncingMembers(true);
                        try {
                          const result = await syncTeamMembersFromDB(getAllUsers, supabaseOk);
                          if (result.success) {
                            // 同步 filtersForm 以更新当前编辑状态
                            const stored = localStorage.getItem('riemer_filter_options');
                            if (stored) {
                              try {
                                const parsed = JSON.parse(stored);
                                setFiltersForm((prev) => ({ ...prev, teamMembers: parsed.teamMembers || prev.teamMembers }));
                              } catch { /* ignore */ }
                            }
                            alert(`✅ 已从数据库同步 ${result.count} 位已授权成员`);
                          } else {
                            alert(`⚠️ 同步失败：${result.message}`);
                          }
                        } catch (err) {
                          alert(`⚠️ 同步失败：${err.message}`);
                        } finally {
                          setSyncingMembers(false);
                        }
                      }}
                      title="从已授权成员数据库自动同步团队成员列表"
                    >
                      <RefreshCw size={14} className={syncingMembers ? 'content-mgmt__spinner' : ''} />
                      {syncingMembers ? '同步中…' : '从数据库同步'}
                    </button>
                  </div>
                  {filtersForm.teamMembers.map((member, i) => (
                    <div key={member.id || i} className="content-mgmt__card">
                      <div className="content-mgmt__card-header">
                        <span className="content-mgmt__card-index">#{i + 1}</span>
                        <div className="content-mgmt__card-header-actions">
                          <button
                            className="content-mgmt__edit-btn"
                            onClick={() => setEditingMemberIndex(editingMemberIndex === i ? null : i)}
                            title={editingMemberIndex === i ? '收起' : '编辑'}
                          >
                            {editingMemberIndex === i ? <X size={14} /> : <Pencil size={14} />}
                          </button>
                          <button
                            className="content-mgmt__remove-btn"
                            onClick={() => {
                              setFiltersForm({
                                ...filtersForm,
                                teamMembers: filtersForm.teamMembers.filter((_, idx) => idx !== i),
                              });
                              if (editingMemberIndex === i) setEditingMemberIndex(null);
                            }}
                            title="删除"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      {editingMemberIndex === i ? (
                        <>
                          <div className="content-mgmt__field">
                            <label>姓名</label>
                            <input
                              type="text"
                              value={member.name}
                              onChange={(e) => {
                                const arr = [...filtersForm.teamMembers];
                                arr[i] = { ...arr[i], name: e.target.value };
                                setFiltersForm({ ...filtersForm, teamMembers: arr });
                              }}
                              className="content-mgmt__input"
                              placeholder="成员姓名"
                            />
                          </div>
                        </>
                      ) : (
                        <div className="content-mgmt__member-summary">
                          <span className="content-mgmt__member-name">{member.name || '未命名'}</span>
                        </div>
                      )}
                    </div>
                  ))}
                  <button
                    className="content-mgmt__add-btn"
                    onClick={() => {
                      const newId = `member-${Date.now()}`;
                      setFiltersForm({
                        ...filtersForm,
                        teamMembers: [...filtersForm.teamMembers, { id: newId, name: '', role: '' }],
                      });
                      setEditingMemberIndex(filtersForm.teamMembers.length);
                    }}
                  >
                    <Plus size={16} /> 添加成员
                  </button>
                </div>

                <div className="content-mgmt__hint">
                  <AlertCircle size={16} />
                  <span>修改后请点击顶部「保存更改」按钮，筛选选项将同步更新到事项追踪页面。</span>
                </div>
              </div>
            )}

            {/* 文章板块 */}
            {activeTab === 'articles' && (
              <div className="content-mgmt__section">
                <h3 className="content-mgmt__section-title">文章管理</h3>
                <p className="content-mgmt__section-desc">通过粘贴公众号链接添加文章，自动提取标题、时间并生成智能摘要</p>

                {/* 板块标题 */}
                <div className="content-mgmt__subsection">
                  <h4 className="content-mgmt__subsection-title">板块标题</h4>
                  <div className="content-mgmt__field">
                    <input
                      type="text"
                      value={form.articlesSectionTitle}
                      onChange={(e) => setForm({ ...form, articlesSectionTitle: e.target.value })}
                      className="content-mgmt__input"
                      placeholder="如：最新文章"
                    />
                  </div>
                </div>

                {/* 添加新文章 */}
                <div className="content-mgmt__subsection">
                  <h4 className="content-mgmt__subsection-title">添加新文章</h4>

                  {/* URL 输入 + 抓取 */}
                  <div className="content-mgmt__url-bar">
                    <div className="content-mgmt__url-input-wrap">
                      <Link2 size={16} className="content-mgmt__url-icon" />
                      <input
                        type="text"
                        value={articleUrl}
                        onChange={(e) => {
                          setArticleUrl(e.target.value);
                          setFetchError('');
                        }}
                        className="content-mgmt__input content-mgmt__url-input"
                        placeholder="粘贴微信公众号文章链接…"
                        disabled={fetchingArticle}
                      />
                    </div>
                    <button
                      className="btn btn-primary content-mgmt__fetch-btn"
                      disabled={!articleUrl.trim() || fetchingArticle}
                      onClick={async () => {
                        setFetchingArticle(true);
                        setFetchError('');
                        try {
                          const result = await fetchAndParseArticle(articleUrl.trim());
                          setEditingArticle({
                            id: `user-${Date.now()}`,
                            ...result,
                          });
                          setEditingArticleId(null);
                        } catch (err) {
                          setFetchError(err.message);
                        } finally {
                          setFetchingArticle(false);
                        }
                      }}
                    >
                      {fetchingArticle ? (
                        <><Loader2 size={16} className="content-mgmt__spinner" /> 提取中…</>
                      ) : (
                        <>提取文章</>
                      )}
                    </button>
                  </div>

                  {fetchError && (
                    <div className="content-mgmt__error">
                      <AlertCircle size={14} />
                      <span>{fetchError}</span>
                    </div>
                  )}

                  {/* 手动添加按钮 */}
                  {!editingArticle && (
                    <button
                      className="content-mgmt__add-btn"
                      style={{ marginTop: 'var(--space-md)' }}
                      onClick={() => {
                        setEditingArticle({
                          id: `user-${Date.now()}`,
                          title: '',
                          rawTitle: '',
                          date: new Date().toISOString().split('T')[0],
                          author: 'RIEMer Land',
                          category: '经验分享',
                          tags: [],
                          excerpt: '',
                          url: '',
                          content: '',
                        });
                        setEditingArticleId(null);
                      }}
                    >
                      <Plus size={16} /> 手动添加文章
                    </button>
                  )}

                  {/* 编辑表单（新建 / 从链接提取后编辑） */}
                  {editingArticle && !editingArticleId && (
                    <div className="content-mgmt__article-form">
                      <div className="content-mgmt__article-form-header">
                        <h4>{editingArticle.url ? '提取结果（可编辑）' : '新建文章'}</h4>
                        <button
                          className="content-mgmt__edit-btn"
                          onClick={() => setEditingArticle(null)}
                          title="取消"
                        >
                          <X size={14} />
                        </button>
                      </div>

                      {editingArticle.rawTitle && editingArticle.rawTitle !== editingArticle.title && (
                        <div className="content-mgmt__hint" style={{ marginBottom: 'var(--space-md)' }}>
                          <AlertCircle size={14} />
                          <span>原标题「{editingArticle.rawTitle}」已自动删减前缀</span>
                        </div>
                      )}

                      <div className="content-mgmt__field">
                        <label>标题</label>
                        <input
                          type="text"
                          value={editingArticle.title}
                          onChange={(e) => setEditingArticle({ ...editingArticle, title: e.target.value })}
                          className="content-mgmt__input"
                          placeholder="文章标题"
                        />
                      </div>

                      <div className="content-mgmt__inline-group">
                        <div className="content-mgmt__field content-mgmt__field--flex">
                          <label><Calendar size={14} /> 发布日期</label>
                          <input
                            type="date"
                            value={editingArticle.date}
                            onChange={(e) => setEditingArticle({ ...editingArticle, date: e.target.value })}
                            className="content-mgmt__input"
                          />
                        </div>
                        <div className="content-mgmt__field content-mgmt__field--flex">
                          <label>分类</label>
                          <input
                            type="text"
                            value={editingArticle.category}
                            onChange={(e) => setEditingArticle({ ...editingArticle, category: e.target.value })}
                            className="content-mgmt__input"
                            placeholder="如：听 RIEMer 说系列"
                          />
                        </div>
                      </div>

                      <div className="content-mgmt__field content-mgmt__field--ai">
                        <label>
                          <Tag size={14} /> 标签（逗号分隔）
                          {editingArticle.url && <span className="content-mgmt__ai-badge">✨ AI 生成 · 可修改</span>}
                        </label>
                        <input
                          type="text"
                          value={editingArticle.tags.join('、')}
                          onChange={(e) => setEditingArticle({
                            ...editingArticle,
                            tags: e.target.value.split(/[,，、]/).map(t => t.trim()).filter(Boolean),
                          })}
                          className="content-mgmt__input"
                          placeholder="如：保研、经验分享、学术"
                        />
                      </div>

                      <div className="content-mgmt__field content-mgmt__field--ai">
                        <label>
                          摘要（首页卡片展示）
                          {editingArticle.url && <span className="content-mgmt__ai-badge">✨ AI 生成 · 可修改</span>}
                        </label>
                        <textarea
                          value={editingArticle.excerpt}
                          onChange={(e) => setEditingArticle({ ...editingArticle, excerpt: e.target.value })}
                          className="content-mgmt__input content-mgmt__textarea"
                          rows={3}
                          placeholder="AI 自动生成的智能摘要，也可手动修改"
                        />
                      </div>

                      {editingArticle.url && (
                        <div className="content-mgmt__field">
                          <label><Link2 size={14} /> 原文链接</label>
                          <input
                            type="text"
                            value={editingArticle.url}
                            onChange={(e) => setEditingArticle({ ...editingArticle, url: e.target.value })}
                            className="content-mgmt__input"
                            placeholder="公众号文章链接"
                          />
                        </div>
                      )}

                      <div className="content-mgmt__article-form-actions">
                        <button
                          className="btn btn-primary content-mgmt__confirm-btn"
                          disabled={!editingArticle.title.trim()}
                          onClick={() => {
                            addArticle(editingArticle, user?.id);
                            setEditingArticle(null);
                            setArticleUrl('');
                          }}
                        >
                          <CheckCircle size={18} /> 确认添加文章
                        </button>
                        <button
                          className="btn btn-ghost"
                          onClick={() => setEditingArticle(null)}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 已添加的文章列表 */}
                {userArticles.length > 0 && (
                  <div className="content-mgmt__subsection">
                    <h4 className="content-mgmt__subsection-title">
                      已添加文章（{userArticles.length}）
                    </h4>
                    {userArticles.map((article) => (
                      <div key={article.id} className="content-mgmt__card">
                        <div className="content-mgmt__card-header">
                          <div className="content-mgmt__article-meta">
                            <span className="badge badge-primary">{article.category}</span>
                            <span className="content-mgmt__article-date">{article.date}</span>
                          </div>
                          <div className="content-mgmt__card-header-actions">
                            {article.url && (
                              <a
                                href={article.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="content-mgmt__edit-btn"
                                title="查看原文"
                              >
                                <ExternalLink size={14} />
                              </a>
                            )}
                            <button
                              className="content-mgmt__edit-btn"
                              onClick={() => {
                                if (editingArticleId === article.id) {
                                  setEditingArticleId(null);
                                  setEditingArticle(null);
                                } else {
                                  setEditingArticleId(article.id);
                                  setEditingArticle({ ...article });
                                }
                              }}
                              title={editingArticleId === article.id ? '收起' : '编辑'}
                            >
                              {editingArticleId === article.id ? <X size={14} /> : <Pencil size={14} />}
                            </button>
                            <button
                              className="content-mgmt__remove-btn"
                              onClick={() => {
                                if (window.confirm(`确定删除「${article.title}」？`)) {
                                  deleteArticle(article.id);
                                  if (editingArticleId === article.id) {
                                    setEditingArticleId(null);
                                    setEditingArticle(null);
                                  }
                                }
                              }}
                              title="删除"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        {editingArticleId === article.id && editingArticle ? (
                          <>
                            <div className="content-mgmt__field">
                              <label>标题</label>
                              <input
                                type="text"
                                value={editingArticle.title}
                                onChange={(e) => setEditingArticle({ ...editingArticle, title: e.target.value })}
                                className="content-mgmt__input"
                              />
                            </div>
                            <div className="content-mgmt__inline-group">
                              <div className="content-mgmt__field content-mgmt__field--flex">
                                <label>日期</label>
                                <input
                                  type="date"
                                  value={editingArticle.date}
                                  onChange={(e) => setEditingArticle({ ...editingArticle, date: e.target.value })}
                                  className="content-mgmt__input"
                                />
                              </div>
                              <div className="content-mgmt__field content-mgmt__field--flex">
                                <label>分类</label>
                                <input
                                  type="text"
                                  value={editingArticle.category}
                                  onChange={(e) => setEditingArticle({ ...editingArticle, category: e.target.value })}
                                  className="content-mgmt__input"
                                />
                              </div>
                            </div>
                            <div className="content-mgmt__field content-mgmt__field--ai">
                              <label>
                                <Tag size={14} /> 标签
                                <span className="content-mgmt__ai-badge">✨ AI 生成 · 可修改</span>
                              </label>
                              <input
                                type="text"
                                value={editingArticle.tags.join('、')}
                                onChange={(e) => setEditingArticle({
                                  ...editingArticle,
                                  tags: e.target.value.split(/[,，、]/).map(t => t.trim()).filter(Boolean),
                                })}
                                className="content-mgmt__input"
                                placeholder="如：保研、经验分享、学术"
                              />
                            </div>
                            <div className="content-mgmt__field content-mgmt__field--ai">
                              <label>
                                摘要
                                <span className="content-mgmt__ai-badge">✨ AI 生成 · 可修改</span>
                              </label>
                              <textarea
                                value={editingArticle.excerpt}
                                onChange={(e) => setEditingArticle({ ...editingArticle, excerpt: e.target.value })}
                                className="content-mgmt__input content-mgmt__textarea"
                                rows={3}
                                placeholder="AI 自动生成的智能摘要，也可手动修改"
                              />
                            </div>
                            <button
                              className="btn btn-primary content-mgmt__confirm-btn"
                              onClick={() => {
                                updateArticle(article.id, editingArticle);
                                setEditingArticleId(null);
                                setEditingArticle(null);
                              }}
                            >
                              <CheckCircle size={18} /> 确认保存修改
                            </button>
                          </>
                        ) : (
                          <div className="content-mgmt__article-summary">
                            <h5 className="content-mgmt__article-title">{article.title}</h5>
                            <p className="content-mgmt__article-excerpt">{article.excerpt}</p>
                            {article.tags.length > 0 && (
                              <div className="content-mgmt__article-tags">
                                {article.tags.map((tag) => (
                                  <span key={tag} className="content-mgmt__article-tag">{tag}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="content-mgmt__hint">
                  <AlertCircle size={16} />
                  <span>添加的文章会自动展示在首页和文章列表页，无需额外点击「保存更改」。</span>
                </div>
              </div>
            )}

            {/* 活动管理 */}
            {activeTab === 'events' && (
              <div className="content-mgmt__section">
                <h3 className="content-mgmt__section-title">活动管理</h3>
                <p className="content-mgmt__section-desc">管理首页展示的活动信息，可为活动添加回放链接（需密码访问）</p>

                {/* 添加新活动 */}
                {!editingEvent && (
                  <button
                    className="content-mgmt__add-btn"
                    style={{ marginBottom: 'var(--space-xl)' }}
                    onClick={() => {
                      setEditingEvent({
                        id: `event-${Date.now()}`,
                        title: '',
                        date: new Date().toISOString().split('T')[0],
                        category: '分享会',
                        location: '线上腾讯会议',
                        leaderId: '',
                        excerpt: '',
                        hasReplay: false,
                        replayUrl: '',
                        replayPassword: '',
                      });
                      setEditingEventId(null);
                    }}
                  >
                    <Plus size={16} /> 添加活动
                  </button>
                )}

                {/* 新建活动表单 */}
                {editingEvent && !editingEventId && (
                  <div className="content-mgmt__article-form" style={{ marginBottom: 'var(--space-xl)' }}>
                    <div className="content-mgmt__article-form-header">
                      <h4>新建活动</h4>
                      <button
                        className="content-mgmt__edit-btn"
                        onClick={() => setEditingEvent(null)}
                        title="取消"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div className="content-mgmt__field">
                      <label>活动标题</label>
                      <input
                        type="text"
                        value={editingEvent.title}
                        onChange={(e) => setEditingEvent({ ...editingEvent, title: e.target.value })}
                        className="content-mgmt__input"
                        placeholder="如：快消行业经验分享"
                      />
                    </div>

                    <div className="content-mgmt__inline-group">
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label><Calendar size={14} /> 活动日期</label>
                        <input
                          type="date"
                          value={editingEvent.date}
                          onChange={(e) => setEditingEvent({ ...editingEvent, date: e.target.value })}
                          className="content-mgmt__input"
                        />
                      </div>
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label>活动分类</label>
                        <select
                          value={editingEvent.category}
                          onChange={(e) => setEditingEvent({ ...editingEvent, category: e.target.value })}
                          className="content-mgmt__input"
                        >
                          <option value="分享会">分享会</option>
                          <option value="经验分享">经验分享</option>
                          <option value="团队招新">团队招新</option>
                          <option value="校园活动">校园活动</option>
                        </select>
                      </div>
                    </div>

                    <div className="content-mgmt__field">
                      <label>活动地点</label>
                      <input
                        type="text"
                        value={editingEvent.location}
                        onChange={(e) => setEditingEvent({ ...editingEvent, location: e.target.value })}
                        className="content-mgmt__input"
                        placeholder="如：线上腾讯会议 / 西南财经大学"
                      />
                    </div>

                    <div className="content-mgmt__field">
                      <label>活动简介</label>
                      <textarea
                        value={editingEvent.excerpt}
                        onChange={(e) => setEditingEvent({ ...editingEvent, excerpt: e.target.value })}
                        className="content-mgmt__input content-mgmt__textarea"
                        rows={3}
                        placeholder="活动的简要描述，将展示在首页卡片中"
                      />
                    </div>

                    {/* 回放设置 */}
                    <div className="content-mgmt__subsection">
                      <h4 className="content-mgmt__subsection-title">
                        <Video size={14} /> 活动回放设置
                      </h4>
                      <div className="content-mgmt__field">
                        <label className="content-mgmt__toggle-label">
                          <input
                            type="checkbox"
                            checked={editingEvent.hasReplay}
                            onChange={(e) => setEditingEvent({ ...editingEvent, hasReplay: e.target.checked })}
                            className="content-mgmt__checkbox"
                          />
                          <span>开启活动回放</span>
                        </label>
                      </div>

                      {editingEvent.hasReplay && (
                        <>
                          <div className="content-mgmt__field">
                            <label><Link2 size={14} /> 设置回放链接</label>
                            <input
                              type="text"
                              value={editingEvent.replayUrl}
                              onChange={(e) => setEditingEvent({ ...editingEvent, replayUrl: e.target.value })}
                              className="content-mgmt__input"
                              placeholder="粘贴回放视频链接，例如腾讯会议 / 腾讯微云 / B 站等"
                            />
                          </div>
                          <div className="content-mgmt__field">
                            <label><Lock size={14} /> 设置回放密码</label>
                            <input
                              type="text"
                              value={editingEvent.replayPassword}
                              onChange={(e) => setEditingEvent({ ...editingEvent, replayPassword: e.target.value })}
                              className="content-mgmt__input"
                              placeholder="为该活动回放设置访问密码（留空则无需密码）"
                            />
                            <p className="content-mgmt__field-hint">
                              此处为你<strong>设置</strong>的密码，成员在前台点击活动卡片时需要输入此密码才能查看回放。
                            </p>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="content-mgmt__article-form-actions">
                      <button
                        className="btn btn-primary content-mgmt__confirm-btn"
                        disabled={!editingEvent.title.trim()}
                        onClick={() => {
                          addEvent(editingEvent);
                          setEditingEvent(null);
                        }}
                      >
                        <CheckCircle size={18} /> 确认添加活动
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => setEditingEvent(null)}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}

                {/* 已添加的活动列表 */}
                {events.length > 0 && (
                  <div className="content-mgmt__subsection">
                    <h4 className="content-mgmt__subsection-title">
                      活动列表（{events.length}）
                    </h4>
                    {events.map((event) => (
                      <div key={event.id} className="content-mgmt__card">
                        <div className="content-mgmt__card-header">
                          <div className="content-mgmt__article-meta">
                            <span className="badge badge-primary">{event.category}</span>
                            <span className="content-mgmt__article-date">{event.date}</span>
                            {event.hasReplay && (
                              <span className="badge" style={{ background: 'rgba(139,92,246,0.12)', color: '#8B5CF6', fontSize: 'var(--text-xs)', padding: '0.1rem 0.5rem', borderRadius: 'var(--radius-full)' }}>
                                <Video size={12} style={{ marginRight: 2, verticalAlign: -1 }} /> 有回放
                              </span>
                            )}
                          </div>
                          <div className="content-mgmt__card-header-actions">
                            <button
                              className="content-mgmt__edit-btn"
                              onClick={() => {
                                if (editingEventId === event.id) {
                                  setEditingEventId(null);
                                  setEditingEvent(null);
                                } else {
                                  setEditingEventId(event.id);
                                  setEditingEvent({ ...event });
                                }
                              }}
                              title={editingEventId === event.id ? '收起' : '编辑'}
                            >
                              {editingEventId === event.id ? <X size={14} /> : <Pencil size={14} />}
                            </button>
                            <button
                              className="content-mgmt__remove-btn"
                              onClick={() => {
                                if (window.confirm(`确定删除「${event.title}」？`)) {
                                  deleteEvent(event.id);
                                  if (editingEventId === event.id) {
                                    setEditingEventId(null);
                                    setEditingEvent(null);
                                  }
                                }
                              }}
                              title="删除"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        {editingEventId === event.id && editingEvent ? (
                          <>
                            <div className="content-mgmt__field">
                              <label>活动标题</label>
                              <input
                                type="text"
                                value={editingEvent.title}
                                onChange={(e) => setEditingEvent({ ...editingEvent, title: e.target.value })}
                                className="content-mgmt__input"
                              />
                            </div>
                            <div className="content-mgmt__inline-group">
                              <div className="content-mgmt__field content-mgmt__field--flex">
                                <label>日期</label>
                                <input
                                  type="date"
                                  value={editingEvent.date}
                                  onChange={(e) => setEditingEvent({ ...editingEvent, date: e.target.value })}
                                  className="content-mgmt__input"
                                />
                              </div>
                              <div className="content-mgmt__field content-mgmt__field--flex">
                                <label>分类</label>
                                <CustomSelect
                                  className="content-mgmt__input"
                                  value={editingEvent.category}
                                  onChange={(v) => setEditingEvent({ ...editingEvent, category: v })}
                                  options={[
                                    { value: '分享会', label: '分享会' },
                                    { value: '经验分享', label: '经验分享' },
                                    { value: '团队招新', label: '团队招新' },
                                    { value: '校园活动', label: '校园活动' },
                                  ]}
                                />
                              </div>
                            </div>
                            <div className="content-mgmt__field">
                              <label>活动地点</label>
                              <input
                                type="text"
                                value={editingEvent.location}
                                onChange={(e) => setEditingEvent({ ...editingEvent, location: e.target.value })}
                                className="content-mgmt__input"
                              />
                            </div>
                            <div className="content-mgmt__field">
                              <label>活动简介</label>
                              <textarea
                                value={editingEvent.excerpt}
                                onChange={(e) => setEditingEvent({ ...editingEvent, excerpt: e.target.value })}
                                className="content-mgmt__input content-mgmt__textarea"
                                rows={3}
                              />
                            </div>

                            {/* 编辑回放设置 */}
                            <div className="content-mgmt__subsection" style={{ marginTop: 'var(--space-md)' }}>
                              <h4 className="content-mgmt__subsection-title">
                                <Video size={14} /> 活动回放设置
                              </h4>
                              <div className="content-mgmt__field">
                                <label className="content-mgmt__toggle-label">
                                  <input
                                    type="checkbox"
                                    checked={editingEvent.hasReplay}
                                    onChange={(e) => setEditingEvent({ ...editingEvent, hasReplay: e.target.checked })}
                                    className="content-mgmt__checkbox"
                                  />
                                  <span>开启活动回放</span>
                                </label>
                              </div>

                              {editingEvent.hasReplay && (
                                <>
                                  <div className="content-mgmt__field">
                                    <label><Link2 size={14} /> 回放链接</label>
                                    <input
                                      type="text"
                                      value={editingEvent.replayUrl}
                                      onChange={(e) => setEditingEvent({ ...editingEvent, replayUrl: e.target.value })}
                                      className="content-mgmt__input"
                                      placeholder="粘贴回放视频链接…"
                                    />
                                  </div>
                                  <div className="content-mgmt__field">
                                    <label><Lock size={14} /> 回放密码</label>
                                    <input
                                      type="text"
                                      value={editingEvent.replayPassword}
                                      onChange={(e) => setEditingEvent({ ...editingEvent, replayPassword: e.target.value })}
                                      className="content-mgmt__input"
                                      placeholder="设置回放访问密码"
                                    />
                                  </div>
                                </>
                              )}
                            </div>

                            <button
                              className="btn btn-primary content-mgmt__confirm-btn"
                              onClick={() => {
                                updateEvent(event.id, editingEvent);
                                setEditingEventId(null);
                                setEditingEvent(null);
                              }}
                            >
                              <CheckCircle size={18} /> 确认保存修改
                            </button>
                          </>
                        ) : (
                          <div className="content-mgmt__article-summary">
                            <h5 className="content-mgmt__article-title">{event.title}</h5>
                            <p className="content-mgmt__article-excerpt">{event.excerpt}</p>
                            <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-xs)', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>📍 {event.location}</span>
                              {event.hasReplay && (
                                <span style={{ fontSize: 'var(--text-xs)', color: '#8B5CF6', fontWeight: 500 }}>
                                  🔗 回放链接已设置 · 密码: {event.replayPassword}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {events.length === 0 && (
                  <div className="content-mgmt__hint">
                    <AlertCircle size={16} />
                    <span>暂无活动，点击上方按钮添加第一个活动。</span>
                  </div>
                )}

                <div className="content-mgmt__hint">
                  <AlertCircle size={16} />
                  <span>添加的活动会自动展示在首页「最新活动」区域；开启回放并<strong>设置链接</strong>和<strong>设置密码</strong>后，成员在前台点击卡片需输入你设置的密码才能查看回放。</span>
                </div>
              </div>
            )}

            {/* 关于我们（时间轴管理） */}
            {activeTab === 'timeline' && (
              <div className="content-mgmt__section">
                <h3 className="content-mgmt__section-title">关于我们 · 时间轴管理</h3>
                <p className="content-mgmt__section-desc">编辑「关于我们」页面的时间轴节点，支持修改时间、文字、高亮状态，以及添加或删除节点</p>

                {/* 添加新节点 */}
                <button
                  className="content-mgmt__add-btn"
                  style={{ marginBottom: 'var(--space-xl)' }}
                  onClick={() => {
                    addTimelineNode({
                      year: new Date().getFullYear().toString(),
                      month: (new Date().getMonth() + 1).toString(),
                      title: '',
                      description: '',
                      highlight: false,
                    });
                  }}
                >
                  <Plus size={16} /> 添加时间轴节点
                </button>

                {/* 节点列表 */}
                {timeline.map((node, index) => (
                  <div key={index} className="content-mgmt__card">
                    <div className="content-mgmt__card-header">
                      <span className="content-mgmt__card-index">
                        {node.highlight && <Star size={12} style={{ fill: 'currentColor', marginRight: 4 }} />}
                        #{index + 1} · {node.year}.{node.month.padStart(2, '0')}
                      </span>
                      <div className="content-mgmt__card-header-actions">
                        {/* 上移 */}
                        {index > 0 && (
                          <button
                            className="content-mgmt__edit-btn"
                            onClick={() => {
                              const arr = [...timeline];
                              [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
                              updateTimeline(arr);
                            }}
                            title="上移"
                          >
                            <ArrowUp size={14} />
                          </button>
                        )}
                        {/* 下移 */}
                        {index < timeline.length - 1 && (
                          <button
                            className="content-mgmt__edit-btn"
                            onClick={() => {
                              const arr = [...timeline];
                              [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
                              updateTimeline(arr);
                            }}
                            title="下移"
                          >
                            <ArrowDown size={14} />
                          </button>
                        )}
                        <button
                          className="content-mgmt__remove-btn"
                          onClick={() => {
                            if (window.confirm(`确定删除节点「${node.title || '未命名'}」？`)) {
                              deleteTimelineNode(index);
                            }
                          }}
                          title="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="content-mgmt__inline-group">
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label>年份</label>
                        <input
                          type="text"
                          value={node.year}
                          onChange={(e) => updateTimelineNode(index, { year: e.target.value })}
                          className="content-mgmt__input"
                          placeholder="如：2025"
                        />
                      </div>
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label>月份</label>
                        <input
                          type="text"
                          value={node.month}
                          onChange={(e) => updateTimelineNode(index, { month: e.target.value })}
                          className="content-mgmt__input"
                          placeholder="如：3"
                        />
                      </div>
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label>
                          <input
                            type="checkbox"
                            checked={node.highlight || false}
                            onChange={(e) => updateTimelineNode(index, { highlight: e.target.checked })}
                            className="content-mgmt__checkbox"
                            style={{ marginRight: 6 }}
                          />
                          高亮节点
                        </label>
                      </div>
                    </div>

                    <div className="content-mgmt__field">
                      <label>标题</label>
                      <input
                        type="text"
                        value={node.title}
                        onChange={(e) => updateTimelineNode(index, { title: e.target.value })}
                        className="content-mgmt__input"
                        placeholder="事件标题"
                      />
                    </div>

                    <div className="content-mgmt__field" style={{ marginBottom: 0 }}>
                      <label>描述</label>
                      <textarea
                        value={node.description}
                        onChange={(e) => updateTimelineNode(index, { description: e.target.value })}
                        className="content-mgmt__input content-mgmt__textarea"
                        rows={2}
                        placeholder="事件描述"
                      />
                    </div>
                  </div>
                ))}

                {timeline.length === 0 && (
                  <div className="content-mgmt__hint">
                    <AlertCircle size={16} />
                    <span>暂无时间轴节点，点击上方按钮添加第一个节点。</span>
                  </div>
                )}

                <div className="content-mgmt__hint">
                  <AlertCircle size={16} />
                  <span>时间轴节点的修改会即时生效，无需额外点击「保存更改」。可通过上下箭头调整节点顺序。</span>
                </div>

                {/* 已授权成员信息表格（自动同步） */}
                <div style={{ marginTop: 'var(--space-2xl)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-xl)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-md)' }}>
                    <h3 className="content-mgmt__section-title" style={{ margin: 0 }}>
                      <Users size={18} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                      已授权成员通讯录（自动同步）
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        className="content-mgmt__edit-btn"
                        onClick={() => scrollMemberTable('left')}
                        title="向左滚动"
                        style={{ padding: '6px 8px', fontSize: '13px' }}
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <button
                        className="content-mgmt__edit-btn"
                        onClick={() => scrollMemberTable('right')}
                        title="向右滚动"
                        style={{ padding: '6px 8px', fontSize: '13px' }}
                      >
                        <ChevronRight size={14} />
                      </button>
                      <button
                        className="content-mgmt__edit-btn"
                        onClick={loadAuthorizedMembers}
                        disabled={loadingMembers}
                        title="刷新成员列表"
                        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', fontSize: '13px' }}
                      >
                        <RefreshCw size={14} className={loadingMembers ? 'content-mgmt__spinner' : ''} />
                        刷新
                      </button>
                    </div>
                  </div>
                  <p className="content-mgmt__section-desc">
                    以下成员信息自动同步自已授权成员的「成员通讯录」页面，成员可前往侧边栏「成员通讯录」编辑自己的行。表格可左右滚动查看更多列。
                  </p>

                  {loadingMembers ? (
                    <div className="content-mgmt__hint">
                      <Loader2 size={16} className="content-mgmt__spinner" />
                      <span>加载中...</span>
                    </div>
                  ) : authorizedMembers.length > 0 ? (
                    <div
                      ref={memberTableRef}
                      className="content-mgmt__member-table-wrapper"
                    >
                      <table className="content-mgmt__member-table">
                        <thead>
                          <tr>
                            <th className="content-mgmt__member-th content-mgmt__member-th--sticky">#</th>
                            <th className="content-mgmt__member-th" style={{ minWidth: 90 }}>姓名</th>
                            <th className="content-mgmt__member-th" style={{ minWidth: 100 }}>入学年份</th>
                            <th className="content-mgmt__member-th" style={{ minWidth: 180 }}>一句话概括自己</th>
                            <th className="content-mgmt__member-th" style={{ minWidth: 110 }}>加入时间</th>
                            <th className="content-mgmt__member-th" style={{ minWidth: 180 }}>我愿意分享什么</th>
                            <th className="content-mgmt__member-th" style={{ minWidth: 180 }}>我想和大家请教什么</th>
                            <th className="content-mgmt__member-th" style={{ minWidth: 180 }}>感兴趣的职业方向/生活模式</th>
                            <th className="content-mgmt__member-th" style={{ minWidth: 160 }}>喜爱向往的城市与地区</th>
                            <th className="content-mgmt__member-th" style={{ minWidth: 150 }}>爱好</th>
                            <th className="content-mgmt__member-th" style={{ minWidth: 160 }}>喜欢的音乐/作家/UP主/书籍/演员/影视剧...</th>
                            <th className="content-mgmt__member-th" style={{ minWidth: 180 }}>其他</th>
                          </tr>
                        </thead>
                        <tbody>
                          {authorizedMembers.map((member, idx) => (
                            <tr key={member.id} className="content-mgmt__member-row">
                              <td className="content-mgmt__member-td content-mgmt__member-td--sticky content-mgmt__member-td--index">
                                {idx + 1}
                              </td>
                              <td className="content-mgmt__member-td content-mgmt__member-td--name">
                                {member.name || '—'}
                              </td>
                              <td className="content-mgmt__member-td">
                                {member.enrollment_year ? `${member.enrollment_year}` : '—'}
                              </td>
                              <td className="content-mgmt__member-td">
                                {member.bio || '—'}
                              </td>
                              <td className="content-mgmt__member-td">
                                {member.joined_at
                                  ? new Date(member.joined_at).toLocaleDateString('zh-CN')
                                  : '—'}
                              </td>
                              <td className="content-mgmt__member-td">
                                {member.willing_to_share || '—'}
                              </td>
                              <td className="content-mgmt__member-td">
                                {member.want_to_learn || '—'}
                              </td>
                              <td className="content-mgmt__member-td">
                                {member.career_interest || '—'}
                              </td>
                              <td className="content-mgmt__member-td">
                                {member.dream_city || '—'}
                              </td>
                              <td className="content-mgmt__member-td">
                                {member.hobbies || '—'}
                              </td>
                              <td className="content-mgmt__member-td">
                                {member.favorites || '—'}
                              </td>
                              <td className="content-mgmt__member-td">
                                {member.other || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="content-mgmt__hint">
                      <Users size={16} />
                      <span>暂无已授权成员。请在「用户管理」中授权成员后，此处将自动同步。</span>
                    </div>
                  )}

                  <div className="content-mgmt__hint" style={{ marginTop: 'var(--space-md)' }}>
                    <AlertCircle size={16} />
                    <span>成员信息从「成员通讯录」页面自动同步，此处仅供查看。成员可在侧边栏「成员通讯录」中编辑自己的行。</span>
                  </div>
                </div>
              </div>
            )}

            {/* 页脚信息 */}
            {activeTab === 'footer' && (
              <div className="content-mgmt__section">
                <h3 className="content-mgmt__section-title">页脚信息</h3>
                <p className="content-mgmt__section-desc">网站底部的联系和介绍信息</p>

                <div className="content-mgmt__field">
                  <label>简介描述</label>
                  <textarea
                    value={form.footerDescription}
                    onChange={(e) => setForm({ ...form, footerDescription: e.target.value })}
                    className="content-mgmt__input content-mgmt__textarea"
                    rows={3}
                    placeholder="页脚中的社团简介"
                  />
                </div>

                <div className="content-mgmt__field">
                  <label>
                    <Mail size={14} /> 联系邮箱
                  </label>
                  <input
                    type="email"
                    value={form.footerEmail}
                    onChange={(e) => setForm({ ...form, footerEmail: e.target.value })}
                    className="content-mgmt__input"
                    placeholder="contact@riemerland.org"
                  />
                </div>

                <div className="content-mgmt__field">
                  <label>
                    <MapPin size={14} /> 地点
                  </label>
                  <input
                    type="text"
                    value={form.footerLocation}
                    onChange={(e) => setForm({ ...form, footerLocation: e.target.value })}
                    className="content-mgmt__input"
                    placeholder="学术楼 A-301"
                  />
                </div>
              </div>
            )}

            {/* 内部空间配置 */}
            {activeTab === 'internal' && (
              <div className="content-mgmt__section">
                <h3 className="content-mgmt__section-title">内部空间配置</h3>
                <p className="content-mgmt__section-desc">内部空间已支持「所见即所得」编辑模式，直接在页面上点击文字即可修改</p>

                <div className="content-mgmt__wysiwyg-guide">
                  <div className="content-mgmt__wysiwyg-guide-icon">✏️</div>
                  <h4>所见即所得编辑</h4>
                  <p>
                    前往任意内部空间页面（如首页、文档管理、事项追踪等），
                    点击页面右下角的 <strong>「进入编辑」</strong> 按钮，即可直接在页面上点击文字进行编辑。
                    编辑完成后点击 <strong>「保存」</strong> 即可生效。
                  </p>
                  <div className="content-mgmt__wysiwyg-steps">
                    <div className="content-mgmt__wysiwyg-step">
                      <span className="content-mgmt__wysiwyg-step-num">1</span>
                      <span>前往内部空间任意页面</span>
                    </div>
                    <div className="content-mgmt__wysiwyg-step">
                      <span className="content-mgmt__wysiwyg-step-num">2</span>
                      <span>点击右下角「进入编辑」按钮</span>
                    </div>
                    <div className="content-mgmt__wysiwyg-step">
                      <span className="content-mgmt__wysiwyg-step-num">3</span>
                      <span>点击页面上高亮的文字直接修改</span>
                    </div>
                    <div className="content-mgmt__wysiwyg-step">
                      <span className="content-mgmt__wysiwyg-step-num">4</span>
                      <span>点击「保存」完成编辑</span>
                    </div>
                  </div>
                </div>

                <div className="content-mgmt__hint">
                  <AlertCircle size={16} />
                  <span>所见即所得模式可编辑的内容包括：侧边栏导航标签、各页面标题/描述/按钮文字、首页欢迎区文字、功能模块卡片名称和描述等。</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}