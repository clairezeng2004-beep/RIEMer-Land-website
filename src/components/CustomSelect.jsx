import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, X } from 'lucide-react';
import './CustomSelect.css';

/**
 * CustomSelect — 自定义下拉菜单组件
 *
 * Props:
 *   value       — 当前选中值（单选: string；多选: string[]）
 *   onChange     — 选中回调（单选: (value) => void；多选: (values[]) => void）
 *   options      — [{ value, label }] 或 [string]
 *   className    — 外层容器额外 className
 *   style        — 外层容器 inline style（例如设置 color）
 *   size         — 'sm' | 'md'（默认 'md'）
 *   placeholder  — 占位文字
 *   multiple     — 是否启用多选模式（默认 false）
 */
export default function CustomSelect({
  value,
  onChange,
  options = [],
  className = '',
  style = {},
  size = 'md',
  placeholder = '请选择',
  multiple = false,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // 标准化 options 为 { value, label }
  const normalised = options.map((opt) =>
    typeof opt === 'string' ? { value: opt, label: opt } : opt
  );

  // 单选：找到选中项；多选：计算选中标签
  const selected = multiple ? null : normalised.find((o) => o.value === value);
  const selectedValues = multiple ? (Array.isArray(value) ? value : []) : [];
  const selectedLabels = multiple
    ? selectedValues.map((v) => normalised.find((o) => o.value === v)?.label || v)
    : [];

  // 点击外部关闭
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (val) => {
    if (multiple) {
      const current = Array.isArray(value) ? value : [];
      const next = current.includes(val)
        ? current.filter((v) => v !== val)
        : [...current, val];
      onChange(next);
      // 多选模式不自动关闭
    } else {
      onChange(val);
      setOpen(false);
    }
  };

  const handleRemoveTag = (e, val) => {
    e.stopPropagation();
    if (!multiple) return;
    const current = Array.isArray(value) ? value : [];
    onChange(current.filter((v) => v !== val));
  };

  // 多选显示内容
  const renderTriggerContent = () => {
    if (!multiple) {
      return <span className="custom-select__value">{selected ? selected.label : placeholder}</span>;
    }
    if (selectedLabels.length === 0) {
      return <span className="custom-select__value custom-select__placeholder">{placeholder}</span>;
    }
    return (
      <span className="custom-select__tags">
        {selectedLabels.map((label, idx) => (
          <span key={selectedValues[idx]} className="custom-select__tag">
            {label}
            <X size={12} className="custom-select__tag-remove" onMouseDown={(e) => handleRemoveTag(e, selectedValues[idx])} />
          </span>
        ))}
      </span>
    );
  };

  return (
    <div
      ref={ref}
      className={`custom-select ${size === 'sm' ? 'custom-select--sm' : ''} ${open ? 'custom-select--open' : ''} ${multiple ? 'custom-select--multiple' : ''} ${className}`}
      style={style}
    >
      <button
        type="button"
        className="custom-select__trigger"
        onClick={() => setOpen(!open)}
      >
        {renderTriggerContent()}
        <ChevronDown size={size === 'sm' ? 12 : 14} className="custom-select__icon" />
      </button>

      {open && (
        <div className="custom-select__dropdown">
          {normalised.map((opt) => {
            const isActive = multiple
              ? selectedValues.includes(opt.value)
              : opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                className={`custom-select__option ${isActive ? 'custom-select__option--active' : ''}`}
                onClick={() => handleSelect(opt.value)}
              >
                {multiple && (
                  <span className={`custom-select__checkbox ${isActive ? 'custom-select__checkbox--checked' : ''}`}>
                    {isActive && <Check size={12} />}
                  </span>
                )}
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
