import { useMemo, useState, useEffect } from 'react';
import { X, Plus, Trash2, Info, Eye } from 'lucide-react';
import {
  EVENT_CATALOG,
  AUDIENCE_OPTIONS,
  TYPE_OPTIONS,
  CONDITION_OPS,
  getEventMeta,
  describeRule,
  renderTemplate,
  validateRule,
  createEmptyRule,
} from '../lib/notificationRuleDSL';

// 规则编辑器弹窗 —— 供 NotificationManagement 页面使用
// 核心体验：
//   - 管理员只看到下拉 + 输入框 + 开关，不用写代码
//   - 每一次输入变化，右下角同步生成"一句话"自然语言预览
//   - 变量占位符（如 {operator}）通过点击按钮插入，防止拼错
//   - 还能用触发事件里真实的变量值做一次"消息预览"
export default function NotificationRuleEditor({
  open,
  rule, // 编辑时传入；新增时传 null
  onClose,
  onSave,
}) {
  const [draft, setDraft] = useState(() => rule || createEmptyRule());
  const [errors, setErrors] = useState([]);

  // 当外部 rule 变化（切换编辑对象）时同步 draft
  useEffect(() => {
    setDraft(rule ? JSON.parse(JSON.stringify(rule)) : createEmptyRule());
    setErrors([]);
  }, [rule, open]);

  const eventMeta = useMemo(() => getEventMeta(draft.event), [draft.event]);

  // "一句话预览"
  const nlDescription = useMemo(() => describeRule(draft), [draft]);

  // 消息预览（用事件变量的 label 占位）
  const messagePreview = useMemo(() => {
    if (!eventMeta) return '';
    const sample = {};
    eventMeta.variables.forEach((v) => {
      // 用"【变量标签】"的形式作为示例数据，直观
      sample[v.key] = v.label.includes('（') ? v.label.split('（')[0] : v.label;
    });
    // 特别美化一下常见字段
    if (sample.count !== undefined) sample.count = '8';
    if (sample.from !== undefined) sample.from = '进行中';
    if (sample.to !== undefined) sample.to = '已完成';
    return renderTemplate(draft.messageTemplate, sample);
  }, [draft.messageTemplate, eventMeta]);

  const handleChange = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const handleEventChange = (eventKey) => {
    const meta = getEventMeta(eventKey);
    if (!meta) return;
    // 切换事件时，标题/消息模板用该事件默认值，避免原来变量对不上
    setDraft((d) => ({
      ...d,
      event: eventKey,
      title: meta.defaults.title,
      messageTemplate: meta.defaults.messageTemplate,
      type: meta.defaults.type,
      audience: meta.defaults.autoReadForOperator ? 'operator_exclude' : 'all',
      autoReadForOperator: meta.defaults.autoReadForOperator,
      conditions: [], // 清空条件，因为变量不一样
    }));
  };

  const insertVariable = (field, varKey) => {
    const val = (draft[field] || '') + `{${varKey}}`;
    handleChange({ [field]: val });
  };

  const addCondition = () => {
    if (!eventMeta) return;
    const firstVar = eventMeta.variables[0];
    setDraft((d) => ({
      ...d,
      conditions: [
        ...(d.conditions || []),
        { field: firstVar?.key || '', op: 'equals', value: '' },
      ],
    }));
  };

  const updateCondition = (idx, patch) => {
    setDraft((d) => {
      const next = [...(d.conditions || [])];
      next[idx] = { ...next[idx], ...patch };
      return { ...d, conditions: next };
    });
  };

  const removeCondition = (idx) => {
    setDraft((d) => {
      const next = [...(d.conditions || [])];
      next.splice(idx, 1);
      return { ...d, conditions: next };
    });
  };

  const handleSave = () => {
    const errs = validateRule(draft);
    setErrors(errs);
    if (errs.length === 0) onSave(draft);
  };

  if (!open) return null;

  return (
    <div className="notif-mgmt__modal-overlay" onClick={onClose}>
      <div
        className="notif-mgmt__modal notif-mgmt__modal--wide"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="notif-mgmt__modal-header">
          <h3>{rule?.id ? '编辑通知规则' : '新增通知规则'}</h3>
          <button className="notif-mgmt__modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="notif-mgmt__modal-body nre">
          {/* 1. 触发事件 */}
          <div className="nre-section">
            <div className="nre-section-title">
              1. 什么情况下触发这条通知？
              <span className="nre-hint">（选择后系统会自动监听这个事件）</span>
            </div>
            <select
              className="nre-select"
              value={draft.event}
              onChange={(e) => handleEventChange(e.target.value)}
            >
              {EVENT_CATALOG.map((ev) => (
                <option key={ev.key} value={ev.key}>
                  【{ev.source}】{ev.label}
                </option>
              ))}
            </select>
          </div>

          {/* 2. 通知内容 */}
          <div className="nre-section">
            <div className="nre-section-title">
              2. 通知要显示什么？
              <span className="nre-hint">（点击右侧变量按钮可直接插入占位符）</span>
            </div>

            <div className="nre-field">
              <label>通知标题</label>
              <input
                type="text"
                value={draft.title}
                onChange={(e) => handleChange({ title: e.target.value })}
                placeholder="例：新内部分享"
                maxLength={100}
              />
              {eventMeta && (
                <div className="nre-vars">
                  <span className="nre-vars-label">可用变量：</span>
                  {eventMeta.variables.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      className="nre-var-btn"
                      onClick={() => insertVariable('title', v.key)}
                      title={`点击把 {${v.key}} 插入标题`}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="nre-field">
              <label>通知内容模板</label>
              <textarea
                rows={2}
                value={draft.messageTemplate}
                onChange={(e) => handleChange({ messageTemplate: e.target.value })}
                placeholder="例：{operator} 上传了文档「{title}」（{typeLabel}）"
              />
              {eventMeta && (
                <div className="nre-vars">
                  <span className="nre-vars-label">可用变量：</span>
                  {eventMeta.variables.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      className="nre-var-btn"
                      onClick={() => insertVariable('messageTemplate', v.key)}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              )}
              {messagePreview && (
                <div className="nre-preview">
                  <Eye size={12} /> 消息实际显示效果：
                  <strong>{messagePreview}</strong>
                </div>
              )}
            </div>
          </div>

          {/* 3. 通知范围与类型 */}
          <div className="nre-section">
            <div className="nre-section-title">3. 通知谁？什么类型？</div>
            <div className="nre-row">
              <div className="nre-field">
                <label>通知范围</label>
                <select
                  className="nre-select"
                  value={draft.audience}
                  onChange={(e) => handleChange({ audience: e.target.value })}
                >
                  {AUDIENCE_OPTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="nre-field">
                <label>通知类型</label>
                <select
                  className="nre-select"
                  value={draft.type}
                  onChange={(e) => handleChange({ type: e.target.value })}
                >
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* 4. 附加触发条件 */}
          <div className="nre-section">
            <div className="nre-section-title">
              4. 附加触发条件（可选）
              <span className="nre-hint">
                （只在满足以下全部条件时才发通知；不填就是所有情况都发）
              </span>
            </div>
            {!eventMeta ? null : (
              <>
                {(draft.conditions || []).map((c, idx) => (
                  <div key={idx} className="nre-condition">
                    <select
                      className="nre-select nre-select--sm"
                      value={c.field}
                      onChange={(e) => updateCondition(idx, { field: e.target.value })}
                    >
                      {eventMeta.variables.map((v) => (
                        <option key={v.key} value={v.key}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                    <select
                      className="nre-select nre-select--sm"
                      value={c.op}
                      onChange={(e) => updateCondition(idx, { op: e.target.value })}
                    >
                      {CONDITION_OPS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      className="nre-cond-val"
                      value={c.value}
                      onChange={(e) => updateCondition(idx, { value: e.target.value })}
                      placeholder="对比值，例：流程手册"
                    />
                    <button
                      type="button"
                      className="nre-cond-remove"
                      onClick={() => removeCondition(idx)}
                      title="删除这条条件"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button type="button" className="nre-add-cond" onClick={addCondition}>
                  <Plus size={14} /> 添加一条附加条件
                </button>
              </>
            )}
          </div>

          {/* 5. 频率控制 */}
          <div className="nre-section">
            <div className="nre-section-title">
              5. 频率限制（可选）
              <span className="nre-hint">（防止同一类事件短时间刷屏）</span>
            </div>
            <div className="nre-field">
              <label>每天最多触发</label>
              <input
                type="number"
                min="0"
                className="nre-num"
                value={draft.throttle?.maxPerDay ?? 0}
                onChange={(e) =>
                  handleChange({
                    throttle: {
                      ...(draft.throttle || {}),
                      maxPerDay: Number(e.target.value) || 0,
                    },
                  })
                }
              />
              <span className="nre-hint">（0 表示不限，超过后当天剩余事件不再发通知）</span>
            </div>
          </div>

          {/* 6. 启用开关 */}
          <div className="nre-section">
            <label className="nre-switch">
              <input
                type="checkbox"
                checked={draft.enabled !== false}
                onChange={(e) => handleChange({ enabled: e.target.checked })}
              />
              <span>启用这条规则</span>
            </label>
          </div>

          {/* 自然语言预览 */}
          <div className="nre-nl">
            <div className="nre-nl-title">
              <Info size={14} /> 这条规则的自然语言描述
            </div>
            <div className="nre-nl-text">{nlDescription}</div>
          </div>

          {errors.length > 0 && (
            <div className="nre-errors">
              {errors.map((err, i) => (
                <div key={i}>• {err}</div>
              ))}
            </div>
          )}
        </div>

        <div className="notif-mgmt__modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            保存规则
          </button>
        </div>
      </div>
    </div>
  );
}
