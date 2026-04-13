import { useState, useMemo, useEffect } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import {
  BarChart3,
  Users,
  Mic,
  FileText,
  Handshake,
  Upload,
  Plus,
  X,
  Calendar,
  Trophy,
  TrendingUp,
  ChevronDown,
} from 'lucide-react';
import { initialTasks, documentsData, articlesData, teamMembers } from '../../data/siteData';
import './MemberContributions.css';

const CUSTOM_CONTRIBUTIONS_KEY = 'riemer_custom_contributions';

// 半年度时间区间
function getHalfYearPeriods() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const periods = [];

  // 生成近几年的半年度区间
  for (let y = currentYear; y >= currentYear - 2; y--) {
    periods.push({
      label: `${y} 年下半年（7-12月）`,
      key: `${y}-H2`,
      start: new Date(y, 6, 1),
      end: new Date(y, 11, 31, 23, 59, 59),
    });
    periods.push({
      label: `${y} 年上半年（1-6月）`,
      key: `${y}-H1`,
      start: new Date(y, 0, 1),
      end: new Date(y, 5, 30, 23, 59, 59),
    });
  }

  return periods;
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function isInPeriod(dateStr, period) {
  if (!period) return true; // "历史全部" 不限时间
  const d = parseDate(dateStr);
  if (!d) return true; // 无日期的数据不过滤
  return d >= period.start && d <= period.end;
}

export default function MemberContributions() {
  const { isAuthenticated } = useAuth();
  const { userArticles, filterOptions } = useSiteContent();

  const members = filterOptions.teamMembers || teamMembers;
  const periods = useMemo(() => getHalfYearPeriods(), []);
  const [selectedPeriod, setSelectedPeriod] = useState('all'); // 'all' 或 period.key
  const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);

  // 自定义贡献（"其他"栏位）
  const [customContributions, setCustomContributions] = useState(() => {
    const stored = localStorage.getItem(CUSTOM_CONTRIBUTIONS_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return {};
      }
    }
    return {};
  });

  // 编辑中的"其他"贡献
  const [editingMember, setEditingMember] = useState(null);
  const [editText, setEditText] = useState('');

  useEffect(() => {
    localStorage.setItem(CUSTOM_CONTRIBUTIONS_KEY, JSON.stringify(customContributions));
  }, [customContributions]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const currentPeriod = selectedPeriod === 'all'
    ? null
    : periods.find((p) => p.key === selectedPeriod) || null;

  const periodLabel = selectedPeriod === 'all'
    ? '历史全部数据'
    : (currentPeriod?.label || '历史全部数据');

  // 合并所有文章
  const allArticles = [...(userArticles || []), ...articlesData];

  // 统计每个成员的贡献数据
  const memberStats = useMemo(() => {
    return members.map((member) => {
      // 1. 线上分享会数量：tasks 中 category='线上分享' 且 assignee 是该成员 且 status='已完成'
      const shareEvents = initialTasks.filter(
        (t) =>
          t.category === '线上分享' &&
          (t.assignee === member.id) &&
          isInPeriod(t.createdAt, currentPeriod)
      ).length;

      // 2. 公众号文章数量：articles 中 leaderId 是该成员
      const articleCount = allArticles.filter(
        (a) =>
          a.leaderId === member.id &&
          isInPeriod(a.date, currentPeriod)
      ).length;

      // 3. 协作帮助次数：tasks 中 helpers 包含该成员
      const helpCount = initialTasks.filter(
        (t) =>
          (t.helpers || []).includes(member.id) &&
          isInPeriod(t.createdAt, currentPeriod)
      ).length;

      // 4. 内部资料上传次数：documents 中 uploadedById 或 uploadedBy 匹配
      const uploadCount = documentsData.filter(
        (d) =>
          ((d.uploadedById && d.uploadedById === member.id) ||
            d.uploadedBy === member.name) &&
          isInPeriod(d.date, currentPeriod)
      ).length;

      // 5. 其他贡献（自定义文本）
      const periodKey = selectedPeriod;
      const customKey = `${member.id}_${periodKey}`;
      const customItems = customContributions[customKey] || [];

      // 总贡献数
      const total = shareEvents + articleCount + helpCount + uploadCount + customItems.length;

      return {
        ...member,
        shareEvents,
        articleCount,
        helpCount,
        uploadCount,
        customItems,
        total,
      };
    });
  }, [members, allArticles, currentPeriod, selectedPeriod, customContributions]);

  // 按总贡献排序
  const sortedStats = useMemo(
    () => [...memberStats].sort((a, b) => b.total - a.total),
    [memberStats]
  );

  // 团队总计
  const teamTotal = useMemo(() => {
    return {
      shareEvents: sortedStats.reduce((s, m) => s + m.shareEvents, 0),
      articleCount: sortedStats.reduce((s, m) => s + m.articleCount, 0),
      helpCount: sortedStats.reduce((s, m) => s + m.helpCount, 0),
      uploadCount: sortedStats.reduce((s, m) => s + m.uploadCount, 0),
      customCount: sortedStats.reduce((s, m) => s + m.customItems.length, 0),
      total: sortedStats.reduce((s, m) => s + m.total, 0),
    };
  }, [sortedStats]);

  // 添加自定义贡献
  const handleAddCustom = (memberId) => {
    if (!editText.trim()) return;
    const periodKey = selectedPeriod;
    const customKey = `${memberId}_${periodKey}`;
    setCustomContributions((prev) => ({
      ...prev,
      [customKey]: [...(prev[customKey] || []), { text: editText.trim(), date: new Date().toISOString().split('T')[0] }],
    }));
    setEditText('');
    setEditingMember(null);
  };

  // 删除自定义贡献
  const handleRemoveCustom = (memberId, index) => {
    const periodKey = selectedPeriod;
    const customKey = `${memberId}_${periodKey}`;
    setCustomContributions((prev) => ({
      ...prev,
      [customKey]: (prev[customKey] || []).filter((_, i) => i !== index),
    }));
  };

  // 获取排名图标
  const getRankDisplay = (index) => {
    if (index === 0) return <span className="mc-rank mc-rank--gold">🥇</span>;
    if (index === 1) return <span className="mc-rank mc-rank--silver">🥈</span>;
    if (index === 2) return <span className="mc-rank mc-rank--bronze">🥉</span>;
    return <span className="mc-rank">{index + 1}</span>;
  };

  return (
    <div className="mc-page">
      <div className="container">
        {/* 页头 */}
        <div className="mc-page__header">
          <div>
            <h1>
              <BarChart3 size={28} /> 成员贡献
            </h1>
            <p>自动统计每位成员的贡献数据，以半年度为单位或查看历史全部数据</p>
          </div>
        </div>

        {/* 时间段选择器 */}
        <div className="mc-period-selector">
          <Calendar size={16} />
          <div className="mc-period-dropdown-wrapper">
            <button
              className="mc-period-dropdown__trigger"
              onClick={() => setShowPeriodDropdown(!showPeriodDropdown)}
            >
              <span>{periodLabel}</span>
              <ChevronDown size={16} className={showPeriodDropdown ? 'mc-chevron--open' : ''} />
            </button>
            {showPeriodDropdown && (
              <div className="mc-period-dropdown">
                <button
                  className={`mc-period-dropdown__item ${selectedPeriod === 'all' ? 'mc-period-dropdown__item--active' : ''}`}
                  onClick={() => { setSelectedPeriod('all'); setShowPeriodDropdown(false); }}
                >
                  历史全部数据
                </button>
                {periods.map((p) => (
                  <button
                    key={p.key}
                    className={`mc-period-dropdown__item ${selectedPeriod === p.key ? 'mc-period-dropdown__item--active' : ''}`}
                    onClick={() => { setSelectedPeriod(p.key); setShowPeriodDropdown(false); }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 团队总览卡片 */}
        <div className="mc-summary">
          <div className="mc-summary__card">
            <div className="mc-summary__icon mc-summary__icon--share"><Mic size={28} /></div>
            <div className="mc-summary__info">
              <span className="mc-summary__value">{teamTotal.shareEvents}</span>
              <span className="mc-summary__label">线上分享会</span>
            </div>
          </div>
          <div className="mc-summary__card">
            <div className="mc-summary__icon mc-summary__icon--article"><FileText size={28} /></div>
            <div className="mc-summary__info">
              <span className="mc-summary__value">{teamTotal.articleCount}</span>
              <span className="mc-summary__label">公众号文章</span>
            </div>
          </div>
          <div className="mc-summary__card">
            <div className="mc-summary__icon mc-summary__icon--help"><Handshake size={28} /></div>
            <div className="mc-summary__info">
              <span className="mc-summary__value">{teamTotal.helpCount}</span>
              <span className="mc-summary__label">协作帮助</span>
            </div>
          </div>
          <div className="mc-summary__card">
            <div className="mc-summary__icon mc-summary__icon--upload"><Upload size={28} /></div>
            <div className="mc-summary__info">
              <span className="mc-summary__value">{teamTotal.uploadCount}</span>
              <span className="mc-summary__label">资料上传</span>
            </div>
          </div>
          <div className="mc-summary__card">
            <div className="mc-summary__icon mc-summary__icon--total"><TrendingUp size={28} /></div>
            <div className="mc-summary__info">
              <span className="mc-summary__value">{teamTotal.total}</span>
              <span className="mc-summary__label">贡献总计</span>
            </div>
          </div>
        </div>

        {/* 成员贡献详情表 */}
        <div className="mc-table-wrapper">
          <table className="mc-table">
            <thead>
              <tr>
                <th className="mc-table__th--rank">排名</th>
                <th className="mc-table__th--member">成员</th>
                <th><Mic size={14} /> 线上分享会</th>
                <th><FileText size={14} /> 公众号文章</th>
                <th><Handshake size={14} /> 协作帮助</th>
                <th><Upload size={14} /> 资料上传</th>
                <th className="mc-table__th--custom">其他</th>
                <th className="mc-table__th--total"><Trophy size={14} /> 总计</th>
              </tr>
            </thead>
            <tbody>
              {sortedStats.map((member, index) => (
                <tr
                  key={member.id}
                  className={`mc-table__row ${index < 3 ? `mc-table__row--top${index + 1}` : ''}`}
                >
                  <td className="mc-table__td--rank">{getRankDisplay(index)}</td>
                  <td className="mc-table__td--member">
                    <Link to={member.profileUrl} className="mc-member-link">
                      <div className="mc-member-avatar">
                        {member.name.charAt(0)}
                      </div>
                      <div className="mc-member-info">
                        <span className="mc-member-name">{member.name}</span>
                      </div>
                    </Link>
                  </td>
                  <td className="mc-table__td--num">
                    <span className={member.shareEvents > 0 ? 'mc-num mc-num--active' : 'mc-num'}>
                      {member.shareEvents}
                    </span>
                  </td>
                  <td className="mc-table__td--num">
                    <span className={member.articleCount > 0 ? 'mc-num mc-num--active' : 'mc-num'}>
                      {member.articleCount}
                    </span>
                  </td>
                  <td className="mc-table__td--num">
                    <span className={member.helpCount > 0 ? 'mc-num mc-num--active' : 'mc-num'}>
                      {member.helpCount}
                    </span>
                  </td>
                  <td className="mc-table__td--num">
                    <span className={member.uploadCount > 0 ? 'mc-num mc-num--active' : 'mc-num'}>
                      {member.uploadCount}
                    </span>
                  </td>
                  <td className="mc-table__td--custom">
                    <div className="mc-custom">
                      {member.customItems.map((item, idx) => (
                        <div key={idx} className="mc-custom__item">
                          <span className="mc-custom__text">{item.text}</span>
                          <button
                            className="mc-custom__remove"
                            onClick={() => handleRemoveCustom(member.id, idx)}
                            title="删除"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                      {editingMember === member.id ? (
                        <div className="mc-custom__edit">
                          <input
                            type="text"
                            className="mc-custom__input"
                            placeholder="输入其他贡献…"
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleAddCustom(member.id);
                              if (e.key === 'Escape') { setEditingMember(null); setEditText(''); }
                            }}
                            autoFocus
                          />
                          <button
                            className="mc-custom__confirm"
                            onClick={() => handleAddCustom(member.id)}
                            disabled={!editText.trim()}
                          >
                            确认
                          </button>
                          <button
                            className="mc-custom__cancel"
                            onClick={() => { setEditingMember(null); setEditText(''); }}
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          className="mc-custom__add"
                          onClick={() => { setEditingMember(member.id); setEditText(''); }}
                        >
                          <Plus size={12} /> 添加
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="mc-table__td--total">
                    <span className="mc-total">{member.total}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 说明 */}
        <div className="mc-note">
          <p>
            <strong>数据说明</strong>
          </p>
          <ul>
            <li><strong>线上分享会</strong>：统计事项追踪中分类为「线上分享」且该成员为负责人的事项数量</li>
            <li><strong>公众号文章</strong>：统计文章浏览中该成员为负责人（leaderId）的文章数量</li>
            <li><strong>协作帮助</strong>：统计事项追踪中该成员作为协助人参与的事项数量</li>
            <li><strong>资料上传</strong>：统计文档管理中该成员上传的文档数量</li>
            <li><strong>其他</strong>：手动输入的自定义贡献项，保存在本地</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
