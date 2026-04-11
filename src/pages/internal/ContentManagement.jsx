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
  Target,
  FileText,
  MapPin,
  Mail,
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import './ContentManagement.css';

export default function ContentManagement() {
  const { isAuthenticated, isAdmin } = useAuth();
  const { content, updateContent, resetContent } = useSiteContent();

  // 本地编辑状态
  const [form, setForm] = useState({ ...content });
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('hero');

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/internal/documents" replace />;
  }

  const handleSave = () => {
    updateContent(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = () => {
    if (window.confirm('确定要重置所有内容为默认值吗？此操作不可撤销。')) {
      resetContent();
      setForm({ ...content });
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

  const updateMission = (index, field, value) => {
    const newMissions = [...form.missions];
    newMissions[index] = { ...newMissions[index], [field]: value };
    setForm({ ...form, missions: newMissions });
  };

  const addMission = () => {
    setForm({ ...form, missions: [...form.missions, { title: '', desc: '' }] });
  };

  const removeMission = (index) => {
    setForm({ ...form, missions: form.missions.filter((_, i) => i !== index) });
  };

  const tabs = [
    { id: 'hero', label: 'Hero 区域', icon: <Type size={16} /> },
    { id: 'stats', label: '数据统计', icon: <BarChart3 size={16} /> },
    { id: 'mission', label: '使命板块', icon: <Target size={16} /> },
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

            {/* 使命板块 */}
            {activeTab === 'mission' && (
              <div className="content-mgmt__section">
                <h3 className="content-mgmt__section-title">使命板块</h3>
                <p className="content-mgmt__section-desc">「我们的使命」区域的标题和内容</p>

                <div className="content-mgmt__field">
                  <label>板块标题</label>
                  <input
                    type="text"
                    value={form.missionSectionTitle}
                    onChange={(e) => setForm({ ...form, missionSectionTitle: e.target.value })}
                    className="content-mgmt__input"
                    placeholder="如：我们的使命"
                  />
                </div>

                {form.missions.map((mission, i) => (
                  <div key={i} className="content-mgmt__card">
                    <div className="content-mgmt__card-header">
                      <span className="content-mgmt__card-index">#{i + 1}</span>
                      <button
                        className="content-mgmt__remove-btn"
                        onClick={() => removeMission(i)}
                        title="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="content-mgmt__field">
                      <label>标题</label>
                      <input
                        type="text"
                        value={mission.title}
                        onChange={(e) => updateMission(i, 'title', e.target.value)}
                        className="content-mgmt__input"
                        placeholder="使命标题"
                      />
                    </div>
                    <div className="content-mgmt__field">
                      <label>描述</label>
                      <textarea
                        value={mission.desc}
                        onChange={(e) => updateMission(i, 'desc', e.target.value)}
                        className="content-mgmt__input content-mgmt__textarea"
                        rows={2}
                        placeholder="使命描述"
                      />
                    </div>
                  </div>
                ))}

                <button className="content-mgmt__add-btn" onClick={addMission}>
                  <Plus size={16} /> 添加使命项
                </button>
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
