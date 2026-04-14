import React, { useState, useCallback, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { useWysiwyg } from '../../contexts/WysiwygContext';
import EditableText from '../../components/EditableText';
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
  ThumbsUp,
} from 'lucide-react';
import './Suggestions.css';

export default function Suggestions() {
  const { isAuthenticated, user } = useAuth();
  const { suggestions, addSuggestion, updateSuggestion, deleteSuggestion, internalConfig, updateInternalConfig } = useSiteContent();
  const { addNotification } = useNotifications();
  const { editing } = useWysiwyg();
  const sc = internalConfig.suggestions || {};
  const updateSugs = useCallback((key, val) => updateInternalConfig({ suggestions: { [key]: val } }), [updateInternalConfig]);

  const [editingSuggestion, setEditingSuggestion] = useState(null);
  const [editingSuggestionId, setEditingSuggestionId] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

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

  // 头像 URL 生成
  const sugAvatarUrl = (name) =>
    name
      ? `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=5B8C3E&color=fff&size=80&font-size=0.4&rounded=true`
      : null;

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

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="suggestions-page">
      <div className="suggestions-page__header">
        <div className="suggestions-page__header-icon">
          <MessageSquarePlus size={24} />
        </div>
        <div>
          <EditableText as="h2" className="suggestions-page__title" value={sc.pageTitle || '建设建议'} configKey="suggestions.pageTitle" onChange={v => updateSugs('pageTitle', v)} />
          <EditableText as="p" className="suggestions-page__desc" value={sc.pageDesc || '收集和追踪网站改进与组织建设相关建议的进度'} configKey="suggestions.pageDesc" onChange={v => updateSugs('pageDesc', v)} />
        </div>
      </div>

      <div className="suggestions-page__content">
        {/* 添加新建议 */}
        {!editingSuggestion && (
          <button
            className="suggestions-page__add-btn"
            onClick={() => {
              setEditingSuggestion({
                id: `sug-${Date.now()}`,
                content: '',
                proposer: user?.name || user?.nickname || '',
                supporters: [],
                status: '处理中',
                statusUpdatedAt: new Date().toISOString().split('T')[0],
                statusUpdatedBy: '',
                statusUpdatedByAvatar: null,
                createdAt: new Date().toISOString().split('T')[0],
                resolver: '',
                skipReason: '',
              });
              setEditingSuggestionId(null);
            }}
          >
            <Plus size={16} /> <EditableText as="span" value={sc.addBtn || '添加建议'} configKey="suggestions.addBtn" onChange={v => updateSugs('addBtn', v)} />
          </button>
        )}

        {/* 新建表单 */}
        {editingSuggestion && !editingSuggestionId && (
          <div className="suggestions-page__form">
            <div className="suggestions-page__form-header">
              <h4>新建建议</h4>
              <button
                className="suggestions-page__icon-btn"
                onClick={() => setEditingSuggestion(null)}
                title="取消"
              >
                <X size={14} />
              </button>
            </div>

            <div className="suggestions-page__field">
              <label>具体建议</label>
              <div className="suggestions-page__textarea-wrap">
                <textarea
                  value={editingSuggestion.content}
                  onChange={(e) => setEditingSuggestion({ ...editingSuggestion, content: e.target.value })}
                  className="suggestions-page__input suggestions-page__textarea"
                  rows={3}
                  placeholder="描述你的建议…（可以是网站功能改进、组织活动策划、团队协作优化等）"
                />
                <button
                  type="button"
                  className={`suggestions-page__voice-btn${isListening ? ' suggestions-page__voice-btn--active' : ''}`}
                  onClick={() => toggleVoiceInput('content')}
                  title={isListening ? '停止语音输入' : '语音输入'}
                >
                  {isListening ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
              </div>
              {isListening && (
                <span className="suggestions-page__voice-hint">🎙️ 正在聆听，请说话...</span>
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
                <select
                  value={editingSuggestion.status}
                  onChange={(e) => setEditingSuggestion({ ...editingSuggestion, status: e.target.value })}
                  className="suggestions-page__input"
                >
                  <option value="处理中">处理中</option>
                  <option value="已完成">已完成</option>
                  <option value="暂时搁置">暂时搁置</option>
                </select>
              </div>
              <div className="suggestions-page__field suggestions-page__field--flex">
                <label>负责人</label>
                <input
                  type="text"
                  value={editingSuggestion.resolver}
                  onChange={(e) => setEditingSuggestion({ ...editingSuggestion, resolver: e.target.value })}
                  className="suggestions-page__input"
                  placeholder="负责跟进此建议的成员"
                />
              </div>
            </div>

            {editingSuggestion.status === '暂时搁置' && (
              <div className="suggestions-page__field">
                <label><AlertCircle size={14} /> 搁置原因</label>
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
                disabled={!editingSuggestion.content.trim() || !editingSuggestion.proposer.trim()}
                onClick={() => {
                  addSuggestion({
                    ...editingSuggestion,
                    statusUpdatedBy: editingSuggestion.proposer,
                    statusUpdatedByAvatar: sugAvatarUrl(editingSuggestion.proposer),
                  });
                  addNotification({
                    title: '新建设建议',
                    message: `${editingSuggestion.proposer} 提出了建议：${editingSuggestion.content.slice(0, 40)}${editingSuggestion.content.length > 40 ? '…' : ''}`,
                    type: 'system',
                    read: true,
                  });
                  setEditingSuggestion(null);
                }}
              >
                <Plus size={16} /> 添加建议
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setEditingSuggestion(null)}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 建议列表表格 */}
        {suggestions.length > 0 && (
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
                {suggestions.map((sug) => (
                  editingSuggestionId === sug.id && editingSuggestion ? (
                    <tr key={sug.id} className="sug-table__row sug-table__row--editing">
                      <td colSpan={7} className="sug-table__td sug-table__td--edit">
                        <div className="sug-edit-form">
                          <div className="suggestions-page__field">
                            <label>具体建议</label>
                            <div className="suggestions-page__textarea-wrap">
                              <textarea
                                value={editingSuggestion.content}
                                onChange={(e) => setEditingSuggestion({ ...editingSuggestion, content: e.target.value })}
                                className="suggestions-page__input suggestions-page__textarea"
                                rows={2}
                              />
                              <button
                                type="button"
                                className={`suggestions-page__voice-btn${isListening ? ' suggestions-page__voice-btn--active' : ''}`}
                                onClick={() => toggleVoiceInput('content')}
                                title={isListening ? '停止语音输入' : '语音输入'}
                              >
                                {isListening ? <MicOff size={16} /> : <Mic size={16} />}
                              </button>
                            </div>
                            {isListening && (
                              <span className="suggestions-page__voice-hint">🎙️ 正在聆听，请说话...</span>
                            )}
                          </div>
                          <div className="suggestions-page__inline-group">
                            <div className="suggestions-page__field suggestions-page__field--flex">
                              <label>提出人</label>
                              <input type="text" value={editingSuggestion.proposer} onChange={(e) => setEditingSuggestion({ ...editingSuggestion, proposer: e.target.value })} className="suggestions-page__input" />
                            </div>
                            <div className="suggestions-page__field suggestions-page__field--flex">
                              <label>当前状态</label>
                              <select value={editingSuggestion.status} onChange={(e) => setEditingSuggestion({ ...editingSuggestion, status: e.target.value })} className="suggestions-page__input">
                                <option value="处理中">处理中</option>
                                <option value="已完成">已完成</option>
                                <option value="暂时搁置">暂时搁置</option>
                              </select>
                            </div>
                          </div>
                          <div className="suggestions-page__inline-group">
                            <div className="suggestions-page__field suggestions-page__field--flex">
                              <label>负责人</label>
                              <input type="text" value={editingSuggestion.resolver} onChange={(e) => setEditingSuggestion({ ...editingSuggestion, resolver: e.target.value })} className="suggestions-page__input" />
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
                                  statusUpdatedAt: new Date().toISOString().split('T')[0],
                                  statusUpdatedByAvatar: sugAvatarUrl(editingSuggestion.statusUpdatedBy),
                                });
                                if (oldSug && oldSug.status !== editingSuggestion.status) {
                                  addNotification({
                                    title: '建设建议状态变更',
                                    message: `建议「${editingSuggestion.content.slice(0, 30)}${editingSuggestion.content.length > 30 ? '…' : ''}」状态：${oldSug.status} → ${editingSuggestion.status}`,
                                    type: 'system',
                                    read: true,
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
                    <tr className={`sug-table__row${sug.status === '暂时搁置' && sug.skipReason ? ' sug-table__row--has-note' : sug.status === '暂时不做' && sug.skipReason ? ' sug-table__row--has-note' : ''}`}>
                      <td className="sug-table__td sug-table__td--content">
                        <span>{sug.content}</span>
                      </td>
                      <td className="sug-table__td sug-table__td--proposer">
                        <div className="sug-table__proposer-wrap">
                          <span className="sug-table__person">
                            <img src={sugAvatarUrl(sug.proposer)} alt={sug.proposer} className="sug-table__avatar" />
                            {sug.proposer}
                          </span>
                          {(sug.supporters || []).length > 0 && (
                            <div className="sug-table__supporters">
                              {(sug.supporters || []).map((s, i) => (
                                <img
                                  key={i}
                                  src={sugAvatarUrl(s.name)}
                                  alt={s.name}
                                  className="sug-table__supporter-avatar"
                                  title={s.name}
                                />
                              ))}
                            </div>
                          )}
                          <button
                            className={`sug-table__plus-one${(sug.supporters || []).some(s => s.name === currentUserName) ? ' sug-table__plus-one--active' : ''}`}
                            onClick={() => handlePlusOne(sug.id)}
                            title={(sug.supporters || []).some(s => s.name === currentUserName) ? '取消 +1' : '+1 支持这个建议'}
                          >
                            <ThumbsUp size={12} />
                            <span>+1</span>
                            {(sug.supporters || []).length > 0 && (
                              <span className="sug-table__plus-one-count">{(sug.supporters || []).length}</span>
                            )}
                          </button>
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
                          {sug.statusUpdatedByAvatar || sugAvatarUrl(sug.statusUpdatedBy) ? (
                            <img src={sug.statusUpdatedByAvatar || sugAvatarUrl(sug.statusUpdatedBy)} alt={sug.statusUpdatedBy} className="sug-table__avatar" />
                          ) : null}
                          <span>
                            <span className="sug-table__date-text">{sug.statusUpdatedAt}</span>
                            {sug.statusUpdatedBy && <span className="sug-table__updater">by {sug.statusUpdatedBy}</span>}
                          </span>
                        </span>
                      </td>
                      <td className="sug-table__td">
                        {sug.resolver ? (
                          <span className="sug-table__person">
                            <img src={sugAvatarUrl(sug.resolver)} alt={sug.resolver} className="sug-table__avatar" />
                            {sug.resolver}
                          </span>
                        ) : (
                          <span className="sug-table__empty">未指派</span>
                        )}
                      </td>
                      <td className="sug-table__td sug-table__td--actions">
                        <button
                          className="suggestions-page__icon-btn"
                          onClick={() => {
                            setEditingSuggestionId(sug.id);
                            setEditingSuggestion({ ...sug });
                          }}
                          title="编辑"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="suggestions-page__icon-btn suggestions-page__icon-btn--danger"
                          onClick={() => {
                            if (window.confirm(`确定删除这条建议吗？`)) {
                              deleteSuggestion(sug.id);
                            }
                          }}
                          title="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                    {(sug.status === '暂时搁置' || sug.status === '暂时不做') && sug.skipReason && (
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
        )}

        {suggestions.length === 0 && (
          <div className="suggestions-page__empty">
            <AlertCircle size={16} />
            <span>暂无建议，点击上方按钮添加第一条建设建议。</span>
          </div>
        )}
      </div>
    </div>
  );
}
