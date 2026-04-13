import { useRef, useEffect, useCallback } from 'react';
import { useWysiwyg } from '../contexts/WysiwygContext';
import './EditableText.css';

/**
 * 所见即所得的可编辑文本组件
 *
 * @param {string}   value      当前文本值
 * @param {function} onChange   文本变更回调 (newValue) => void
 * @param {string}   configKey  配置路径标识（如 "sidebar.labelHome"），用于高亮变更
 * @param {string}   as         渲染的 HTML 标签（默认 "span"）
 * @param {string}   className  额外的 CSS class
 * @param {object}   style      额外的 inline style
 * @param {boolean}  multiline  是否支持多行（默认 false）
 * @param {React.ReactNode} children  子元素（非编辑模式时的内容，若无则用 value）
 */
export default function EditableText({
  value,
  onChange,
  configKey,
  as: Tag = 'span',
  className = '',
  style,
  multiline = false,
  children,
  ...rest
}) {
  const { editing, markChanged } = useWysiwyg();
  const ref = useRef(null);
  const lastValue = useRef(value);

  // 同步外部 value 到 DOM（仅当外部值确实变了，且不在用户正编辑时）
  useEffect(() => {
    if (ref.current && !editing) {
      ref.current.textContent = value;
    }
    lastValue.current = value;
  }, [value, editing]);

  // 进入编辑模式时，确保 DOM 内容是最新 value
  useEffect(() => {
    if (editing && ref.current) {
      ref.current.textContent = value;
    }
  }, [editing, value]);

  const handleInput = useCallback(() => {
    if (!ref.current) return;
    const newVal = ref.current.textContent || '';
    if (newVal !== lastValue.current) {
      lastValue.current = newVal;
      onChange(newVal);
      if (configKey) markChanged(configKey);
    }
  }, [onChange, configKey, markChanged]);

  const handleKeyDown = useCallback(
    (e) => {
      if (!multiline && e.key === 'Enter') {
        e.preventDefault();
        ref.current?.blur();
      }
    },
    [multiline]
  );

  const handlePaste = useCallback(
    (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, multiline ? text : text.replace(/\n/g, ' '));
    },
    [multiline]
  );

  if (!editing) {
    // 非编辑模式：渲染普通元素
    return (
      <Tag className={className} style={style} {...rest}>
        {children ?? value}
      </Tag>
    );
  }

  // 编辑模式
  return (
    <Tag
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      className={`editable-text ${className}`}
      style={style}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      spellCheck={false}
      data-config-key={configKey}
      {...rest}
    />
  );
}
