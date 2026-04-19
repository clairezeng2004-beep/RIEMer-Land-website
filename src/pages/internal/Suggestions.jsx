import React, { useState, useCallback, useRef, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { emitNotificationEvent } from '../../lib/notificationRuleEngine';
import { useWysiwyg } from '../../contexts/WysiwygContext';
import EditableText from '../../components/EditableText';
import CustomSelect from '../../components/CustomSelect';
import {
  Plus,
  Trash2,
  AlertCircle,
  Pencil,
  X,
  Calendar,
  User,
  Save,
  MessageSquarePlus,
  Mic,
  MicOff,
  Monitor,
  Users,
} from 'lucide-react';
import './Suggestions.css';

// 两类建议的状态选项
const WEBSITE_STATUSES = ['处理中', '已完成', '暂时搁置'];
const ORG_STATUSES = ['已完成', '暂时不做'];

export default function Suggestions() {
  const { isAuthenticated, user, getAllUsers } = useAuth();
  const { suggestions, addSuggestion, updateSuggestion, deleteSuggestion, internalConfig, updateInternalConfig } = useSiteContent();
  // useNotifications 保留以确保 NotificationProvider 就绪；
  // 通知派发已统一走规则引擎 emitNotificationEvent。
  useNotifications();
  const { editing } = useWysiwyg();
  const sc = internalConfig.suggestions || {};
  const updateSugs = useCallback((key, val) => updateInternalConfig({ suggestions: { [key]: val } }), [updateInternalConfig]);

  const [editingSuggestion, setEditingSuggestion] = useState(null);
  const [editingSuggestionId, setEditingSuggestionId] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  // 已授权用户列表（用于负责人下拉选择）
  const [authorizedUsers, setAuthorizedUsers] = useState([]);
  React.useEffect(() => {
    let cancelled = false;
    const loadUsers = async () => {
      try {
        const allUsers = await getAllUsers();
        if (!cancelled) {
          const authorized = allUsers
            .filter((u) => u.authorized)
            .map((u) => ({ value: u.name, label: u.nickname ? `${u.name}（${u.nickname}）` : u.name }));
          setAuthorizedUsers(authorized);
        }
      } catch (err) {
        console.warn('[Suggestions] 加载用户列表失败:', err);
      }
    };
    loadUsers();
    return () => { cancelled = true; };
  }, [getAllUsers]);

  // 按类别分组（无 category 的旧数据默认归入网站建设）
  const websiteSugs = useMemo(() => suggestions.filter(s => !s.category || s.category === 'website'), [suggestions]);
  const orgSugs = useMemo(() => suggestions.filter(s => s.category === 'organization'), [suggestions]);

  // 语音识别
  const SpeechRecognition = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;

  const toggleVoiceInput = useCallback((field = 'content', isEdit = false) => {
    if (isListening) {
      // 停止
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    if (!SpeechRecognition) {
      alert('当前浏览器不支持语音输入，请使用 Chrome 或 Edge 浏览器。');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognitionRef.current = recognition;

    let finalTranscript = '';

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interim += transcript;
        }
      }
      // 将识别到的文字追加到建议内容中
      setEditingSuggestion(prev => {
        if (!prev) return prev;
        const currentContent = prev[field] || '';
        // 移除之前的临时文本，追加最终文本和临时文本
        const baseContent = currentContent.replace(/\u200B.*$/, '');
        const newContent = baseContent + finalTranscript + (interim ? '\u200B' + interim : '');
        return { ...prev, [field]: newContent };
      });
    };

    recognition.onend = () => {
      setIsListening(false);
      // 清理临时标记
      setEditingSuggestion(prev => {
        if (!prev) return prev;
        const cleaned = (prev[field] || '').replace(/\u200B.*$/, '') + finalTranscript;
        return { ...prev, [field]: cleaned };
      });
      recognitionRef.current = null;
    };

    recognition.onerror = (event) => {
      console.error('语音识别错误:', event.error);
      setIsListening(false);
      recognitionRef.current = null;
      if (event.error === 'not-allowed') {
        alert('请允许浏览器使用麦克风。');
      }
    };

    recognition.start();
    setIsListening(true);
  }, [isListening, SpeechRecognition]);

  // （已移除姓氏头像生成）

  // +1 支持功能
  const currentUserName = user?.name || user?.nickname || '';
  const handlePlusOne = useCallback((sugId) => {
    const sug = suggestions.find(s => s.id === sugId);
    if (!sug || !currentUserName) return;
    const supporters = sug.supporters || [];
    const alreadySupported = supporters.some(s => s.name === currentUserName);
    if (alreadySupported) {
      // 取消 +1
      updateSuggestion(sugId, {
        supporters: supporters.filter(s => s.name !== currentUserName),
      });
    } else {
      // 添加 +1
      updateSuggestion(sugId, {
        supporters: [...supporters, { name: currentUserName }],
      });
    }
  }, [suggestions, currentUserName, updateSuggestion]);

  // 根据类别返回可用状态选项
  const getStatusOptions = (category) => {
    return category === 'organization' ? ORG_STATUSES : WEBSITE_STATUSES;
  };

  // 根据类别返回默认状态
  const getDefaultStatus = (category) => {
    return category === 'organization' ? '已完成' : '处理中';
  };

  // 开始新建一条建议（category: 'website' | 'organization'）
  const startAddSuggestion = (category) => {
    setEditingSuggestion({
      id: `sug-${Date.now()}`,
      content: '',
      category,
      proposer: user?.name || user?.nickname || '',
      supporters: [],
      status: getDefaultStatus(category),
      statusUpdatedAt: new Date().toISOString().split('T')[0],
      statusUpdatedBy: '',
      statusUpdatedByAvatar: null,
      createdAt: new Date().toISOString().split('T')[0],
      resolver: '',
      skipReason: '',
    });
    setEditingSuggestionId(null);
  };

  // 渲染"新建建议"表单（内嵌到对应的 section 中）
  const renderAddForm = (category) => {
    if (!editingSuggestion || editingSuggestionId) return null;
    if (editingSuggestion.category !== category) return null;
    return (
      <div className="suggestions-page__form">
        <div className="suggestions-page__form-header">
          <h4>新建{category === 'organization' ? '组织' : '网站'}建议</h4>
          <button
            className="suggestions-page__icon-btn"
            onClick={() => setEditingSuggestion(null)}
            title="取消"
          >
            <X size={14} />
          </button>
        </div>

        <div className="suggestions-page__field">
          <div className="suggestions-page__label-row">
            <label>具体建议</label>
            <button
              type="button"
              className={`suggestions-page__voice-btn-inline${isListening ? ' suggestions-page__voice-btn-inline--active' : ''}`}
              onClick={() => toggleVoiceInput('content')}
              title={isListening ? '停止语音输入' : '点击开始语音输入，说话即可自动转为文字'}
            >
              {isListening ? <MicOff size={14} /> : <Mic size={14} />}
              <span>{isListening ? '停止录音' : '语音输入'}</span>
            </button>
          </div>
          <textarea
            value={editingSuggestion.content}
            onChange={(e) => setEditingSuggestion({ ...editingSuggestion, content: e.target.value })}
            className="suggestions-page__input suggestions-page__textarea"
            rows={3}
            placeholder={category === 'organization'
              ? '描述你的组织建设建议…（团队协作、活动策划、制度流程等）'
              : '描述你的网站建设建议…（功能改进、UI/UX、新模块等）'}
          />
          {isListening && (
            <span className="suggestions-page__voice-hint">🎙️ 正在聆听，请说话…识别到的文字将自动填入上方输入框</span>
          )}
        </div>

        <div className="suggestions-page__inline-group">
          <div className="suggestions-page__field suggestions-page__field--flex">
            <label><User size={14} /> 提出人</label>
            <input
              type="text"
              value={editingSuggestion.proposer}
              className="suggestions-page__input suggestions-page__input--readonly"
              readOnly
            />
          </div>
          <div className="suggestions-page__field suggestions-page__field--flex">
            <label><Calendar size={14} /> 提出时间</label>
            <input
              type="date"
              value={editingSuggestion.createdAt}
              onChange={(e) => setEditingSuggestion({ ...editingSuggestion, createdAt: e.target.value })}
              className="suggestions-page__input"
            />
          </div>
        </div>

        <div className="suggestions-page__inline-group">
          <div className="suggestions-page__field suggestions-page__field--flex">
            <label>当前状态</label>
            <CustomSelect
              value={editingSuggestion.status}
              onChange={(val) => setEditingSuggestion({ ...editingSuggestion, status: val })}
              options={getStatusOptions(editingSuggestion.category)}
              placeholder="请选择状态"
              allowClear
            />
          </div>
          <div className="suggestions-page__field suggestions-page__field--flex">
            <label>负责人</label>
            <CustomSelect
              value={editingSuggestion.resolver}
              onChange={(val) => setEditingSuggestion({ ...editingSuggestion, resolver: val })}
              options={authorizedUsers}
              placeholder="选择负责人"
              allowClear
            />
          </div>
        </div>

        {(editingSuggestion.status === '暂时搁置' || editingSuggestion.status === '暂时不做') && (
          <div className="suggestions-page__field">
            <label><AlertCircle size={14} /> {editingSuggestion.status === '暂时不做' ? '原因说明' : '搁置原因'}</label>
            <textarea
              value={editingSuggestion.skipReason}
              onChange={(e) => setEditingSuggestion({ ...editingSuggestion, skipReason: e.target.value })}
              className="suggestions-page__input suggestions-page__textarea"
              rows={2}
              placeholder={editingSuggestion.status === '暂时不做' ? '请说明暂时不做的原因…' : '请说明暂时搁置的原因…'}
            />
          </div>
        )}

        <div className="suggestions-page__form-actions">
          <button
            className="btn btn-primary"
            disabled={!editingSuggestion.content.trim() || !editingSuggestion.proposer.trim()}
            onClick={() => {
              addSuggestion({
                ...editingSuggestion,
                statusUpdatedBy: editingSuggestion.proposer,
                statusUpdatedByAvatar: null,
              });
              emitNotificationEvent('suggestion.new', {
                operator: editingSuggestion.proposer,
                summary:
                  editingSuggestion.content.slice(0, 40) +
                  (editingSuggestion.content.length > 40 ? '…' : ''),
              });
              setEditingSuggestion(null);
            }}
          >
            <Plus size={16} /> 添加{category === 'organization' ? '组织' : '网站'}建议
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => setEditingSuggestion(null)}
          >
            取消
          </button>
        </div>
      </div>
    );
  };

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="suggestions-page">
      <div className="container">
        <div className="suggestions-page__header">
          <div>
            <h1>
              <MessageSquarePlus size={28} /> <EditableText
                value={sc.pageTitle || '建设建议'}
                configKey="suggestions.pageTitle"
                onChange={v => updateSugs('pageTitle', v)}
                as="span"
              />
            </h1>
            <p><EditableText
              value={sc.pageDesc || '收集和追踪网站改进与组织建设相关建议的进度'}
              configKey="suggestions.pageDesc"
              onChange={v => updateSugs('pageDesc', v)}
              as="span"
            /></p>
          </div>
        </div>

        <div className="suggestions-page__content">

        {/* 新建表单：内联在对应分区下渲染（由 renderAddForm 输出） */}
        {/* ============ 网站建设相关 ============ */}
        <div className="sug-section">
          <h3 className="sug-section__title"><Monitor size={18} /> 网站建设相关</h3>
          {!editingSuggestion && (
            <button
              className="suggestions-page__add-btn suggestions-page__add-btn--section"
              onClick={() => startAddSuggestion('website')}
            >
              <Plus size={16} /> 添加网站建议
            </button>
          )}
          {renderAddForm('website')}
          {websiteSugs.length > 0 ? (
            <div className="sug-table-wrap">
              <table className="sug-table">
                <thead>
                  <tr>
                    <th className="sug-table__th">具体建议</th>
                    <th className="sug-table__th">提出人</th>
                    <th className="sug-table__th">当前状态</th>
                    <th className="sug-table__th">提出时间</th>
                    <th className="sug-table__th">状态更新时间</th>
                    <th className="sug-table__th">负责人</th>
                    <th className="sug-table__th">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {websiteSugs.map((sug) => (
                    editingSuggestionId === sug.id && editingSuggestion ? (
                      <tr key={sug.id} className="sug-table__row sug-table__row--editing">
                        <td colSpan={7} className="sug-table__td sug-table__td--edit">
                          <div className="sug-edit-form">
                            <div className="suggestions-page__field">
                              <div className="suggestions-page__label-row">
                                <label>具体建议</label>
                                <button
                                  type="button"
                                  className={`suggestions-page__voice-btn-inline${isListening ? ' suggestions-page__voice-btn-inline--active' : ''}`}
                                  onClick={() => toggleVoiceInput('content')}
                                  title={isListening ? '停止语音输入' : '点击开始语音输入，说话即可自动转为文字'}
                                >
                                  {isListening ? <MicOff size={14} /> : <Mic size={14} />}
                                  <span>{isListening ? '停止录音' : '语音输入'}</span>
                                </button>
                              </div>
                              <textarea
                                value={editingSuggestion.content}
                                onChange={(e) => setEditingSuggestion({ ...editingSuggestion, content: e.target.value })}
                                className="suggestions-page__input suggestions-page__textarea"
                                rows={2}
                              />
                              {isListening && (
                                <span className="suggestions-page__voice-hint">🎙️ 正在聆听，请说话…识别到的文字将自动填入上方输入框</span>
                              )}
                            </div>
                            <div className="suggestions-page__inline-group">
                              <div className="suggestions-page__field suggestions-page__field--flex">
                                <label>提出人</label>
                                <input type="text" value={editingSuggestion.proposer} onChange={(e) => setEditingSuggestion({ ...editingSuggestion, proposer: e.target.value })} className="suggestions-page__input" />
                              </div>
                              <div className="suggestions-page__field suggestions-page__field--flex">
                                <label>当前状态</label>
                                <CustomSelect
                                  value={editingSuggestion.status}
                                  onChange={(val) => setEditingSuggestion({ ...editingSuggestion, status: val })}
                                  options={WEBSITE_STATUSES}
                                  placeholder="请选择状态"
                                  allowClear
                                />
                              </div>
                            </div>
                            <div className="suggestions-page__inline-group">
                              <div className="suggestions-page__field suggestions-page__field--flex">
                                <label>负责人</label>
                                <CustomSelect
                                  value={editingSuggestion.resolver}
                                  onChange={(val) => setEditingSuggestion({ ...editingSuggestion, resolver: val })}
                                  options={authorizedUsers}
                                  placeholder="选择负责人"
                                  allowClear
                                />
                              </div>
                              <div className="suggestions-page__field suggestions-page__field--flex">
                                <label>状态更新人（显示头像）</label>
                                <input type="text" value={editingSuggestion.statusUpdatedBy} onChange={(e) => setEditingSuggestion({ ...editingSuggestion, statusUpdatedBy: e.target.value })} className="suggestions-page__input" placeholder="谁更新了这个状态" />
                              </div>
                            </div>
                            {editingSuggestion.status === '暂时搁置' && (
                              <div className="suggestions-page__field">
                                <label>搁置原因</label>
                                <textarea
                                  value={editingSuggestion.skipReason}
                                  onChange={(e) => setEditingSuggestion({ ...editingSuggestion, skipReason: e.target.value })}
                                  className="suggestions-page__input suggestions-page__textarea"
                                  rows={2}
                                  placeholder="请说明暂时搁置的原因…"
                                />
                              </div>
                            )}
                            <div className="suggestions-page__form-actions">
                              <button
                                className="btn btn-primary"
                                onClick={() => {
                                  const oldSug = suggestions.find(s => s.id === sug.id);
                                  updateSuggestion(sug.id, {
                                    ...editingSuggestion,
                                    category: 'website',
                                    statusUpdatedAt: new Date().toISOString().split('T')[0],
                                    statusUpdatedByAvatar: null,
                                  });
                                  if (oldSug && oldSug.status !== editingSuggestion.status) {
                                    emitNotificationEvent('suggestion.status_change', {
                                      summary:
                                        editingSuggestion.content.slice(0, 30) +
                                        (editingSuggestion.content.length > 30 ? '…' : ''),
                                      from: oldSug.status,
                                      to: editingSuggestion.status,
                                    });
                                  }
                                  setEditingSuggestionId(null);
                                  setEditingSuggestion(null);
                                }}
                              >
                                <Save size={14} /> 保存
                              </button>
                              <button
                                className="btn btn-ghost"
                                onClick={() => { setEditingSuggestionId(null); setEditingSuggestion(null); }}
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <React.Fragment key={sug.id}>
                      <tr className={`sug-table__row${sug.status === '暂时搁置' && sug.skipReason ? ' sug-table__row--has-note' : ''}`}>
                        <td className="sug-table__td sug-table__td--content">
                          <span>{sug.content}</span>
                        </td>
                        <td className="sug-table__td sug-table__td--proposer">
                          <div className="sug-table__proposer-wrap">
                            <span className="sug-table__person">
                              {sug.proposer}
                            </span>
                            <div className="sug-table__plus-one-row">
                              <button
                                className={`sug-table__plus-one${(sug.supporters || []).some(s => s.name === currentUserName) ? ' sug-table__plus-one--active' : ''}`}
                                onClick={() => handlePlusOne(sug.id)}
                                title={(sug.supporters || []).some(s => s.name === currentUserName) ? '取消 +1' : '+1 支持这个建议'}
                              >
                                <span>+1</span>
                                {(sug.supporters || []).length > 0 && (
                                  <span className="sug-table__plus-one-count">{(sug.supporters || []).length}</span>
                                )}
                              </button>
                              {(sug.supporters || []).length > 0 && (
                                <div className="sug-table__supporters">
                                  {(sug.supporters || []).map((s, i) => (
                                    <span key={i} className="sug-table__supporter-name" title={s.name}>
                                      {s.name}{i < (sug.supporters || []).length - 1 ? '、' : ''}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="sug-table__td">
                          <span className={`sug-table__status sug-table__status--${sug.status === '已完成' || sug.status === '已修复' ? 'done' : sug.status === '处理中' || sug.status === '修复中' ? 'wip' : 'skip'}`}>
                            {sug.status}
                          </span>
                        </td>
                        <td className="sug-table__td sug-table__td--date">{sug.createdAt}</td>
                        <td className="sug-table__td sug-table__td--date">
                          <span className="sug-table__person">
                            <span>
                              <span className="sug-table__date-text">{sug.statusUpdatedAt}</span>
                              {sug.statusUpdatedBy && <span className="sug-table__updater">by {sug.statusUpdatedBy}</span>}
                            </span>
                          </span>
                        </td>
                        <td className="sug-table__td">
                          {sug.resolver ? (
                            <span className="sug-table__person">{sug.resolver}</span>
                          ) : (
                            <span className="sug-table__empty">未指派</span>
                          )}
                        </td>
                        <td className="sug-table__td sug-table__td--actions">
                          <button className="suggestions-page__icon-btn" onClick={() => { setEditingSuggestionId(sug.id); setEditingSuggestion({ ...sug }); }} title="编辑">
                            <Pencil size={14} />
                          </button>
                          <button className="suggestions-page__icon-btn suggestions-page__icon-btn--danger" onClick={() => { if (window.confirm('确定删除这条建议吗？')) deleteSuggestion(sug.id); }} title="删除">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                      {sug.status === '暂时搁置' && sug.skipReason && (
                        <tr className="sug-table__row sug-table__row--note">
                          <td colSpan={7} className="sug-table__td sug-table__td--note">
                            <span className="sug-table__skip-reason">
                              <AlertCircle size={12} /> {sug.skipReason}
                            </span>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    )
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="suggestions-page__empty suggestions-page__empty--inline">
              <AlertCircle size={14} />
              <span>暂无网站建设相关建议</span>
            </div>
          )}
        </div>

        {/* ============ 组织建设相关 ============ */}
        <div className="sug-section">
          <h3 className="sug-section__title"><Users size={18} /> 组织建设相关</h3>
          {!editingSuggestion && (
            <button
              className="suggestions-page__add-btn suggestions-page__add-btn--section"
              onClick={() => startAddSuggestion('organization')}
            >
              <Plus size={16} /> 添加组织建议
            </button>
          )}
          {renderAddForm('organization')}
          {orgSugs.length > 0 ? (
            <div className="sug-table-wrap">
              <table className="sug-table">
                <thead>
                  <tr>
                    <th className="sug-table__th">具体建议</th>
                    <th className="sug-table__th">提出人</th>
                    <th className="sug-table__th">当前状态</th>
                    <th className="sug-table__th">提出时间</th>
                    <th className="sug-table__th">状态更新时间</th>
                    <th className="sug-table__th">负责人</th>
                    <th className="sug-table__th">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {orgSugs.map((sug) => (
                    editingSuggestionId === sug.id && editingSuggestion ? (
                      <tr key={sug.id} className="sug-table__row sug-table__row--editing">
                        <td colSpan={7} className="sug-table__td sug-table__td--edit">
                          <div className="sug-edit-form">
                            <div className="suggestions-page__field">
                              <div className="suggestions-page__label-row">
                                <label>具体建议</label>
                                <button
                                  type="button"
                                  className={`suggestions-page__voice-btn-inline${isListening ? ' suggestions-page__voice-btn-inline--active' : ''}`}
                                  onClick={() => toggleVoiceInput('content')}
                                  title={isListening ? '停止语音输入' : '点击开始语音输入，说话即可自动转为文字'}
                                >
                                  {isListening ? <MicOff size={14} /> : <Mic size={14} />}
                                  <span>{isListening ? '停止录音' : '语音输入'}</span>
                                </button>
                              </div>
                              <textarea
                                value={editingSuggestion.content}
                                onChange={(e) => setEditingSuggestion({ ...editingSuggestion, content: e.target.value })}
                                className="suggestions-page__input suggestions-page__textarea"
                                rows={2}
                              />
                              {isListening && (
                                <span className="suggestions-page__voice-hint">🎙️ 正在聆听，请说话…识别到的文字将自动填入上方输入框</span>
                              )}
                            </div>
                            <div className="suggestions-page__inline-group">
                              <div className="suggestions-page__field suggestions-page__field--flex">
                                <label>提出人</label>
                                <input type="text" value={editingSuggestion.proposer} onChange={(e) => setEditingSuggestion({ ...editingSuggestion, proposer: e.target.value })} className="suggestions-page__input" />
                              </div>
                              <div className="suggestions-page__field suggestions-page__field--flex">
                                <label>当前状态</label>
                                <CustomSelect
                                  value={editingSuggestion.status}
                                  onChange={(val) => setEditingSuggestion({ ...editingSuggestion, status: val })}
                                  options={ORG_STATUSES}
                                  placeholder="请选择状态"
                                  allowClear
                                />
                              </div>
                            </div>
                            <div className="suggestions-page__inline-group">
                              <div className="suggestions-page__field suggestions-page__field--flex">
                                <label>负责人</label>
                                <CustomSelect
                                  value={editingSuggestion.resolver}
                                  onChange={(val) => setEditingSuggestion({ ...editingSuggestion, resolver: val })}
                                  options={authorizedUsers}
                                  placeholder="选择负责人"
                                  allowClear
                                />
                              </div>
                              <div className="suggestions-page__field suggestions-page__field--flex">
                                <label>状态更新人（显示头像）</label>
                                <input type="text" value={editingSuggestion.statusUpdatedBy} onChange={(e) => setEditingSuggestion({ ...editingSuggestion, statusUpdatedBy: e.target.value })} className="suggestions-page__input" placeholder="谁更新了这个状态" />
                              </div>
                            </div>
                            {editingSuggestion.status === '暂时不做' && (
                              <div className="suggestions-page__field">
                                <label>原因说明</label>
                                <textarea
                                  value={editingSuggestion.skipReason}
                                  onChange={(e) => setEditingSuggestion({ ...editingSuggestion, skipReason: e.target.value })}
                                  className="suggestions-page__input suggestions-page__textarea"
                                  rows={2}
                                  placeholder="请说明暂时不做的原因…"
                                />
                              </div>
                            )}
                            <div className="suggestions-page__form-actions">
                              <button
                                className="btn btn-primary"
                                onClick={() => {
                                  const oldSug = suggestions.find(s => s.id === sug.id);
                                  updateSuggestion(sug.id, {
                                    ...editingSuggestion,
                                    category: 'organization',
                                    statusUpdatedAt: new Date().toISOString().split('T')[0],
                                    statusUpdatedByAvatar: null,
                                  });
                                  if (oldSug && oldSug.status !== editingSuggestion.status) {
                                    emitNotificationEvent('suggestion.status_change', {
                                      summary:
                                        editingSuggestion.content.slice(0, 30) +
                                        (editingSuggestion.content.length > 30 ? '…' : ''),
                                      from: oldSug.status,
                                      to: editingSuggestion.status,
                                    });
                                  }
                                  setEditingSuggestionId(null);
                                  setEditingSuggestion(null);
                                }}
                              >
                                <Save size={14} /> 保存
                              </button>
                              <button
                                className="btn btn-ghost"
                                onClick={() => { setEditingSuggestionId(null); setEditingSuggestion(null); }}
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <React.Fragment key={sug.id}>
                      <tr className={`sug-table__row${sug.status === '暂时不做' && sug.skipReason ? ' sug-table__row--has-note' : ''}`}>
                        <td className="sug-table__td sug-table__td--content">
                          <span>{sug.content}</span>
                        </td>
                        <td className="sug-table__td sug-table__td--proposer">
                          <div className="sug-table__proposer-wrap">
                            <span className="sug-table__person">
                              {sug.proposer}
                            </span>
                            <div className="sug-table__plus-one-row">
                              <button
                                className={`sug-table__plus-one${(sug.supporters || []).some(s => s.name === currentUserName) ? ' sug-table__plus-one--active' : ''}`}
                                onClick={() => handlePlusOne(sug.id)}
                                title={(sug.supporters || []).some(s => s.name === currentUserName) ? '取消 +1' : '+1 支持这个建议'}
                              >
                                <span>+1</span>
                                {(sug.supporters || []).length > 0 && (
                                  <span className="sug-table__plus-one-count">{(sug.supporters || []).length}</span>
                                )}
                              </button>
                              {(sug.supporters || []).length > 0 && (
                                <div className="sug-table__supporters">
                                  {(sug.supporters || []).map((s, i) => (
                                    <span key={i} className="sug-table__supporter-name" title={s.name}>
                                      {s.name}{i < (sug.supporters || []).length - 1 ? '、' : ''}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="sug-table__td">
                          <span className={`sug-table__status sug-table__status--${sug.status === '已完成' ? 'done' : 'skip'}`}>
                            {sug.status}
                          </span>
                        </td>
                        <td className="sug-table__td sug-table__td--date">{sug.createdAt}</td>
                        <td className="sug-table__td sug-table__td--date">
                          <span className="sug-table__person">
                            <span>
                              <span className="sug-table__date-text">{sug.statusUpdatedAt}</span>
                              {sug.statusUpdatedBy && <span className="sug-table__updater">by {sug.statusUpdatedBy}</span>}
                            </span>
                          </span>
                        </td>
                        <td className="sug-table__td">
                          {sug.resolver ? (
                            <span className="sug-table__person">{sug.resolver}</span>
                          ) : (
                            <span className="sug-table__empty">未指派</span>
                          )}
                        </td>
                        <td className="sug-table__td sug-table__td--actions">
                          <button className="suggestions-page__icon-btn" onClick={() => { setEditingSuggestionId(sug.id); setEditingSuggestion({ ...sug }); }} title="编辑">
                            <Pencil size={14} />
                          </button>
                          <button className="suggestions-page__icon-btn suggestions-page__icon-btn--danger" onClick={() => { if (window.confirm('确定删除这条建议吗？')) deleteSuggestion(sug.id); }} title="删除">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                      {sug.status === '暂时不做' && sug.skipReason && (
                        <tr className="sug-table__row sug-table__row--note">
                          <td colSpan={7} className="sug-table__td sug-table__td--note">
                            <span className="sug-table__skip-reason">
                              <AlertCircle size={12} /> {sug.skipReason}
                            </span>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    )
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="suggestions-page__empty suggestions-page__empty--inline">
              <AlertCircle size={14} />
              <span>暂无组织建设相关建议</span>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
