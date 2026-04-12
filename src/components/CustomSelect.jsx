import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import './CustomSelect.css';

/**
 * CustomSelect — 自定义下拉菜单组件
 *
 * Props:
 *   value       — 当前选中值
 *   onChange     — 选中回调 (value) => void
 *   options      — [{ value, label }] 或 [string]
 *   className    — 外层容器额外 className
 *   style        — 外层容器 inline style（例如设置 color）
 *   size         — 'sm' | 'md'（默认 'md'）
 *   placeholder  — 占位文字
 */
export default function CustomSelect({
  value,
  onChange,
  options = [],
  className = '',
  style = {},
  size = 'md',
  placeholder = '请选择',
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // 标准化 options 为 { value, label }
  const normalised = options.map((opt) =>
    typeof opt === 'string' ? { value: opt, label: opt } : opt
  );

  const selected = normalised.find((o) => o.value === value);

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
    onChange(val);
    setOpen(false);
  };

  return (
    <div
      ref={ref}
      className={`custom-select ${size === 'sm' ? 'custom-select--sm' : ''} ${open ? 'custom-select--open' : ''} ${className}`}
      style={style}
    >
      <button
        type="button"
        className="custom-select__trigger"
        onClick={() => setOpen(!open)}
      >
        <span className="custom-select__value">
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={size === 'sm' ? 12 : 14} className="custom-select__icon" />
      </button>

      {open && (
        <div className="custom-select__dropdown">
          {normalised.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`custom-select__option ${opt.value === value ? 'custom-select__option--active' : ''}`}
              onClick={() => handleSelect(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
