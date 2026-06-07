import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useWysiwyg } from '../../contexts/WysiwygContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import EditableText from '../../components/EditableText';
import {
  BarChart3,
  Mic,
  FileText,
  Handshake,
  Upload,
  Plus,
  X,
  Calendar,
  Trophy,
  ChevronDown,
} from 'lucide-react';
import { initialTasks, documentsData, articlesData, teamMembers as defaultTeamMembers } from '../../data/siteData';
import { getCachedSharings, fetchSharings } from '../../services/memberSharingService';
import './MemberContributions.css';

const CUSTOM_CONTRIBUTIONS_KEY = 'riemer_custom_contributions';

// 获取当前所在半年度的 key（如 "2026-H1" 或 "2025-H2"）
function getCurrentHalfYearKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11
  return month < 6 ? `${year}-H1` : `${year}-H2`;
}

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
  const { isAuthenticated, user, getAllUsers, supabaseOk } = useAuth();
  const { userArticles, filterOptions, internalConfig, updateInternalConfig, syncTeamMembersFromDB } = useSiteContent();
  const { editing } = useWysiwyg();
  const cc = internalConfig.contributions || {};

  const canUseSupabase = isSupabaseConfigured && supabaseOk === true;

  const updateContribs = useCallback(
    (key, val) => updateInternalConfig({ contributions: { [key]: val } }),
    [updateInternalConfig]
  );

  // 使用 filterOptions.teamMembers，如果为空则回退到硬编码默认值
  const members = (filterOptions.teamMembers && filterOptions.teamMembers.length > 0)
    ? filterOptions.teamMembers
    : defaultTeamMembers;
  const periods = useMemo(() => getHalfYearPeriods(), []);
  const [selectedPeriod, setSelectedPeriod] = useState(() => getCurrentHalfYearKey()); // 默认当前半年度
  const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);

  // 首次加载时自动从数据库同步成员列表
  useEffect(() => {
    if (isAuthenticated && getAllUsers) {
      syncTeamMembersFromDB(getAllUsers, supabaseOk).catch(() => {});
    }
  }, [isAuthenticated, getAllUsers, supabaseOk, syncTeamMembersFromDB]);

  // 成员内部分享：先用本地缓存当首屏，再异步拉云端真实数据。
  // 「内部分享」列会把这些分享帖按贡献者计入对应成员。
  const [sharings, setSharings] = useState(() => getCachedSharings());
  useEffect(() => {
    let cancelled = false;
    fetchSharings()
      .then((list) => { if (!cancelled && Array.isArray(list)) setSharings(list); })
      .catch(() => { /* ignore，保留本地缓存 */ });
    return () => { cancelled = true; };
  }, []);

  // ============================================================
  // 自定义贡献（"其他"栏位）—— 跨设备同步
  // 存储结构：customContributions[`${memberId}_${periodKey}`] = [{ text, date }]
  // 云端：member_contributions 表，(member_id, period_key) 唯一
  // 本地：localStorage 作为离线/降级缓存
  // ============================================================
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

  // 每次本地状态变化都写回 localStorage 作为兜底
  useEffect(() => {
    localStorage.setItem(CUSTOM_CONTRIBUTIONS_KEY, JSON.stringify(customContributions));
  }, [customContributions]);

  // 启动后异步从 Supabase 拉取最新数据（如配置且可用）
  const loadedFromServerRef = useRef(false);
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!canUseSupabase) return;
    if (loadedFromServerRef.current) return;
    loadedFromServerRef.current = true;

    (async () => {
      try {
        console.log('[MemberContributions] 开始从 Supabase 拉取 member_contributions...');
        const { data, error } = await supabase
          .from('member_contributions')
          .select('member_id, period_key, items');
        if (error) throw error;
        const map = {};
        (data || []).forEach((row) => {
          const key = `${row.member_id}_${row.period_key}`;
          map[key] = Array.isArray(row.items) ? row.items : [];
        });
        console.log('[MemberContributions] Supabase 返回', Object.keys(map).length, '条记录');
        // 云端即真源：直接覆盖本地
        setCustomContributions(map);
      } catch (err) {
        console.warn('[MemberContributions] ❌ 从 Supabase 加载失败:', err);
      }
    })();
  }, [isAuthenticated, canUseSupabase]);

  // 写入云端（upsert；失败仅警告，保留本地状态）
  const upsertContribToServer = useCallback(async (memberId, periodKey, items) => {
    if (!canUseSupabase) return;
    try {
      const { error } = await supabase
        .from('member_contributions')
        .upsert(
          {
            member_id: memberId,
            period_key: periodKey,
            items,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'member_id,period_key' }
        );
      if (error) throw error;
    } catch (err) {
      console.warn('[MemberContributions] ❌ upsert 失败:', err);
    }
  }, [canUseSupabase]);


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

      // 4. 内部分享次数：包含两部分，都按"贡献者"口径统计
      //    (a) 流程模板文件 documents：contributorIds 包含该成员 id，或旧数据 uploadedById/uploadedBy 匹配
      //    (b) 成员内部分享 member_sharing：contributorIds 包含该成员 id，或旧数据 authorId/author 匹配
      const docUploadCount = documentsData.filter((d) => {
        if (!isInPeriod(d.date, currentPeriod)) return false;
        if (Array.isArray(d.contributorIds) && d.contributorIds.length > 0) {
          return d.contributorIds.includes(member.id);
        }
        return (
          (d.uploadedById && d.uploadedById === member.id) ||
          d.uploadedBy === member.name
        );
      }).length;
      const sharingUploadCount = sharings.filter((s) => {
        if (!isInPeriod(s.createdAt, currentPeriod)) return false;
        if (Array.isArray(s.contributorIds) && s.contributorIds.length > 0) {
          return s.contributorIds.map(String).includes(String(member.id));
        }
        return (
          (s.authorId && String(s.authorId) === String(member.id)) ||
          s.author === member.name
        );
      }).length;
      const uploadCount = docUploadCount + sharingUploadCount;

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
  }, [members, allArticles, sharings, currentPeriod, selectedPeriod, customContributions]);

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
    // 录入人：当前登录用户；字段兼容历史数据（无 addedBy 的老记录仍可正常显示）
    const addedByName =
      user?.name || user?.nickname || user?.email?.split('@')[0] || '';
    const newItem = {
      text: editText.trim(),
      date: new Date().toISOString().split('T')[0],
      addedById: user?.id || null,
      addedByName,
    };
    setCustomContributions((prev) => {
      const nextItems = [...(prev[customKey] || []), newItem];
      // 异步同步到 Supabase（成功/失败都不阻塞本地状态）
      upsertContribToServer(memberId, periodKey, nextItems);
      return { ...prev, [customKey]: nextItems };
    });
    setEditText('');
    setEditingMember(null);
  };

  // 删除自定义贡献
  const handleRemoveCustom = (memberId, index) => {
    const periodKey = selectedPeriod;
    const customKey = `${memberId}_${periodKey}`;
    setCustomContributions((prev) => {
      const nextItems = (prev[customKey] || []).filter((_, i) => i !== index);
      upsertContribToServer(memberId, periodKey, nextItems);
      return { ...prev, [customKey]: nextItems };
    });
  };

  // 获取排名显示
  // v4 变更：前三名不再用金/银/铜奖牌 emoji（🥇🥈🥉 在不同系统字体差异极大，
  //   macOS/Windows/Linux 渲染不一致，且颜色撞不上页面主色；用户反馈想更克制）。
  //   改成纯数字，由 CSS .mc-rank--top{1,2,3} 给出不同配色，
  //   强调方式从"图标 + 左竖线"换到"整行底色"（见 CSS）。
  const getRankDisplay = (index) => {
    if (index < 3) {
      return <span className={`mc-rank mc-rank--top${index + 1}`}>{index + 1}</span>;
    }
    return <span className="mc-rank">{index + 1}</span>;
  };

  return (
    <div className="mc-page">
      <div className="container">
        {/* 页头 */}
        <div className="mc-page__header">
          <div>
            <h1>
              <BarChart3 size={28} /> <EditableText
                value={cc.pageTitle || '成员贡献'}
                onChange={(v) => updateContribs('pageTitle', v)}
                configKey="contributions.pageTitle"
                as="span"
              />
            </h1>
            <p><EditableText
              value={cc.pageDesc || '自动统计每位成员的贡献数据，以半年度为单位或查看历史全部数据'}
              onChange={(v) => updateContribs('pageDesc', v)}
              configKey="contributions.pageDesc"
              as="span"
            /></p>
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

        {/* 团队总览卡片
            ——————————————————————————————————————————————
            v5 改动：删除原本左侧的彩色图标块和 .mc-summary__info 横向排版，
            改为与「事项追踪」.tasks-stat 一致的极简卡片：
              大数字（text-2xl）在上，label（text-sm）在下，居中。
            原 .mc-summary__icon / __info 等 CSS 规则保留但不再被使用。 */}
        <div className="mc-summary">
          <div className="mc-summary__card">
            <div className="mc-summary__value">{teamTotal.shareEvents}</div>
            <EditableText
              value={cc.labelShareEvents || '线上分享会'}
              onChange={(v) => updateContribs('labelShareEvents', v)}
              configKey="contributions.labelShareEvents"
              as="div"
              className="mc-summary__label"
            />
          </div>
          <div className="mc-summary__card">
            <div className="mc-summary__value">{teamTotal.articleCount}</div>
            <EditableText
              value={cc.labelArticleCount || '公众号文章'}
              onChange={(v) => updateContribs('labelArticleCount', v)}
              configKey="contributions.labelArticleCount"
              as="div"
              className="mc-summary__label"
            />
          </div>
          <div className="mc-summary__card">
            <div className="mc-summary__value">{teamTotal.helpCount}</div>
            <EditableText
              value={cc.labelHelpCount || '协作帮助'}
              onChange={(v) => updateContribs('labelHelpCount', v)}
              configKey="contributions.labelHelpCount"
              as="div"
              className="mc-summary__label"
            />
          </div>
          <div className="mc-summary__card">
            <div className="mc-summary__value">{teamTotal.uploadCount}</div>
            <EditableText
              value={cc.labelUploadCount || '资料上传'}
              onChange={(v) => updateContribs('labelUploadCount', v)}
              configKey="contributions.labelUploadCount"
              as="div"
              className="mc-summary__label"
            />
          </div>
          <div className="mc-summary__card">
            <div className="mc-summary__value">{teamTotal.total}</div>
            <EditableText
              value={cc.labelTotal || '贡献总计'}
              onChange={(v) => updateContribs('labelTotal', v)}
              configKey="contributions.labelTotal"
              as="div"
              className="mc-summary__label"
            />
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
                <th><Upload size={14} /> 内部分享</th>
                <th className="mc-table__th--custom">其他</th>
                <th className="mc-table__th--total"><span className="mc-total-head"><Trophy size={14} /> 总计</span></th>
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
                    {/*
                      点击人名不再跳转到个人主页 / timeline。
                      原实现用 <Link to={member.profileUrl}> 会让每个人名
                      变成链接，鼠标悬停时左下角还会显示目标 URL（如
                      https://riemerland.com/timeline#team），用户反馈
                      不希望在成员贡献表里点名字就跳转。
                      改为纯文本 <span>，保留 mc-member-link 的样式
                      （颜色、字重、间距）以免视觉变化；mc-member-name
                      内层 span 不动。
                    */}
                    <span className="mc-member-link mc-member-link--static">
                      <span className="mc-member-name">{member.name}</span>
                    </span>
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
                      {member.customItems.map((item, idx) => {
                        // 录入人名显示：优先用 members 列表里按 id 查到的最新名字，
                        // 其次用录入时保存的 addedByName，都没有则不显示。
                        const recorder =
                          (item.addedById &&
                            members.find((m) => m.id === item.addedById)?.name) ||
                          item.addedByName ||
                          '';
                        return (
                          <div key={idx} className="mc-custom__item">
                            <div className="mc-custom__body">
                              <span className="mc-custom__text">{item.text}</span>
                              {recorder && (
                                <span
                                  className="mc-custom__recorder"
                                  title={`由 ${recorder} 录入`}
                                >
                                  记录人：{recorder}
                                </span>
                              )}
                            </div>
                            <button
                              className="mc-custom__remove"
                              onClick={() => handleRemoveCustom(member.id, idx)}
                              title="删除"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        );
                      })}
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
            <strong><EditableText
              value={cc.noteTitle || '数据说明'}
              onChange={(v) => updateContribs('noteTitle', v)}
              configKey="contributions.noteTitle"
              as="span"
            /></strong>
          </p>
          <ul>
            <li><strong>{cc.labelShareEvents || '线上分享会'}</strong>：<EditableText
              value={cc.noteShareEvents || '统计事项追踪中分类为「线上分享」且该成员为负责人的事项数量'}
              onChange={(v) => updateContribs('noteShareEvents', v)}
              configKey="contributions.noteShareEvents"
              as="span"
            /></li>
            <li><strong>{cc.labelArticleCount || '公众号文章'}</strong>：<EditableText
              value={cc.noteArticleCount || '统计文章浏览中该成员为负责人（leaderId）的文章数量'}
              onChange={(v) => updateContribs('noteArticleCount', v)}
              configKey="contributions.noteArticleCount"
              as="span"
            /></li>
            <li><strong>{cc.labelHelpCount || '协作帮助'}</strong>：<EditableText
              value={cc.noteHelpCount || '统计事项追踪中该成员作为协助人参与的事项数量'}
              onChange={(v) => updateContribs('noteHelpCount', v)}
              configKey="contributions.noteHelpCount"
              as="span"
            /></li>
            <li><strong>{cc.labelUploadCount || '资料上传'}</strong>：<EditableText
              value={cc.noteUploadCount || '统计流程模板文件与成员内部分享中，该成员作为贡献者的数量（按贡献者计，可多选）'}
              onChange={(v) => updateContribs('noteUploadCount', v)}
              configKey="contributions.noteUploadCount"
              as="span"
            /></li>
            <li><strong>其他</strong>：<EditableText
              value={cc.noteCustom || '手动输入的自定义贡献项，跨设备同步；每条后方显示"记录人：姓名"'}
              onChange={(v) => updateContribs('noteCustom', v)}
              configKey="contributions.noteCustom"
              as="span"
            /></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
