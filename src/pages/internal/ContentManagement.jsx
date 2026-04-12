import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
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
} from 'lucide-react';
import './ContentManagement.css';

export default function ContentManagement() {
  const { isAuthenticated, isAdmin } = useAuth();
  const { content, updateContent, resetContent, filterOptions, updateFilterOptions, resetFilterOptions } = useSiteContent();

  // 本地编辑状态
  const [form, setForm] = useState({ ...content });
  const [filtersForm, setFiltersForm] = useState({ ...filterOptions });
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('hero');

  // 编辑中的成员索引
  const [editingMemberIndex, setEditingMemberIndex] = useState(null);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/internal/documents" replace />;
  }

  const handleSave = () => {
    updateContent(form);
    updateFilterOptions(filtersForm);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = () => {
    if (window.confirm('确定要重置所有内容为默认值吗？此操作不可撤销。')) {
      resetContent();
      resetFilterOptions();
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
    { id: 'footer', label: '页脚信息', icon: <MapPin size={16} /> },
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
          <div className="content-mgmt__header-actions">
            <button className="btn btn-ghost" onClick={handleReset}>
              <RotateCcw size={16} /> 重置默认
            </button>
            <button className="btn btn-primary" onClick={handleSave}>
              <Save size={16} /> 保存更改
            </button>
          </div>
        </div>

        {saved && (
          <div className="content-mgmt__toast">
            <CheckCircle size={18} />
            <span>内容已保存，刷新首页即可查看更改</span>
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
          <div className="content-mgmt__panel">

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

                {form.stats.map((stat, i) => (
                  <div key={i} className="content-mgmt__inline-group">
                    <div className="content-mgmt__field content-mgmt__field--flex">
                      <label>标签</label>
                      <input
                        type="text"
                        value={stat.label}
                        onChange={(e) => updateStat(i, 'label', e.target.value)}
                        className="content-mgmt__input"
                        placeholder="如：活跃成员"
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
                      />
                    </div>
                    <button
                      className="content-mgmt__remove-btn"
                      onClick={() => removeStat(i)}
                      title="删除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}

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
                  <h4 className="content-mgmt__subsection-title">团队成员</h4>
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
                          <div className="content-mgmt__field">
                            <label>角色</label>
                            <input
                              type="text"
                              value={member.role}
                              onChange={(e) => {
                                const arr = [...filtersForm.teamMembers];
                                arr[i] = { ...arr[i], role: e.target.value };
                                setFiltersForm({ ...filtersForm, teamMembers: arr });
                              }}
                              className="content-mgmt__input"
                              placeholder="如：内容策划"
                            />
                          </div>
                        </>
                      ) : (
                        <div className="content-mgmt__member-summary">
                          <span className="content-mgmt__member-name">{member.name || '未命名'}</span>
                          <span className="content-mgmt__member-role">{member.role || '未设置角色'}</span>
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
                <h3 className="content-mgmt__section-title">文章板块</h3>
                <p className="content-mgmt__section-desc">最新文章区域的标题</p>

                <div className="content-mgmt__field">
                  <label>板块标题</label>
                  <input
                    type="text"
                    value={form.articlesSectionTitle}
                    onChange={(e) => setForm({ ...form, articlesSectionTitle: e.target.value })}
                    className="content-mgmt__input"
                    placeholder="如：最新文章"
                  />
                </div>

                <div className="content-mgmt__hint">
                  <AlertCircle size={16} />
                  <span>文章内容通过「文章」页面管理，此处仅编辑板块标题。</span>
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
          </div>
        </div>
      </div>
    </div>
  );
}
