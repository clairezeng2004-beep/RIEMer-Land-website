import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, X, Search } from 'lucide-react';
import { pinyinMatch } from '../utils/pinyinSearch';
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
 *   allowClear   — 是否允许清空选择（默认 false，单选模式专用）
 *   searchable   — 是否启用搜索框：true 强制启用 / false 强制禁用 /
 *                  'auto'（默认）：选项数 >= searchThreshold 时自动启用
 *   searchThreshold — auto 模式下启用搜索框的最小选项数（默认 6）
 *   searchPlaceholder — 搜索框占位文字（默认 "搜索…"）
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
  allowClear = false,
  searchable = 'auto',
  searchThreshold = 6,
  searchPlaceholder = '搜索…',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dropdownStyle, setDropdownStyle] = useState(null);
  const ref = useRef(null);
  const dropdownRef = useRef(null);
  const searchInputRef = useRef(null);

  const updateDropdownPosition = useCallback(() => {
    const trigger = ref.current?.querySelector('.custom-select__trigger');
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const preferredHeight = 220;
    const gap = 4;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(preferredHeight, openUp ? spaceAbove - gap : spaceBelow - gap));

    setDropdownStyle({
      position: 'fixed',
      top: openUp ? 'auto' : rect.bottom + gap,
      bottom: openUp ? window.innerHeight - rect.top + gap : 'auto',
      left: rect.left,
      width: rect.width,
      maxHeight,
    });
  }, []);

  // 标准化 options 为 { value, label }
  const normalised = useMemo(
    () => options.map((opt) => (typeof opt === 'string' ? { value: opt, label: opt } : opt)),
    [options]
  );

  // 是否显示搜索框
  const showSearch =
    searchable === true ||
    (searchable === 'auto' && normalised.length >= searchThreshold);

  // 过滤后的选项（支持中文、英文、拼音全拼、拼音首字母）
  const filtered = useMemo(() => {
    if (!showSearch || !query.trim()) return normalised;
    return normalised.filter((opt) => pinyinMatch(String(opt.label ?? ''), query.trim()));
  }, [normalised, query, showSearch]);

  // 单选：找到选中项；多选：计算选中标签（注意：这里用 normalised，不用 filtered，
  // 以保证已选 tag 的 label 不会因搜索过滤而消失）
  const selected = multiple ? null : normalised.find((o) => o.value === value);
  const selectedValues = multiple ? (Array.isArray(value) ? value : []) : [];
  const selectedLabels = multiple
    ? selectedValues.map((v) => normalised.find((o) => o.value === v)?.label || v)
    : [];

  // 点击外部关闭
  useEffect(() => {
    const handler = (e) => {
      if (
        ref.current &&
        !ref.current.contains(e.target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    updateDropdownPosition();
    const onMove = () => updateDropdownPosition();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, updateDropdownPosition]);

  // 下拉打开时，自动把"当前选中项"滚到可视区中间，
  // 避免长列表（如年份 2015~2027）打开后只看得到开头、找不到选中值的情况。
  // 多选场景滚到第一个已选项。搜索态（有 query）时不滚动，让过滤结果从顶部显示。
  useEffect(() => {
    if (!open) return;
    // 等 DOM 渲染完成再找元素
    const id = requestAnimationFrame(() => {
      const dd = dropdownRef.current;
      if (!dd) return;
      if (query.trim()) {
        dd.scrollTop = 0;
        return;
      }
      const active = dd.querySelector('.custom-select__option--active');
      if (!active) return;
      // 用相对容器的偏移做居中滚动，避免 scrollIntoView 把外层页面也滚掉
      const targetTop = active.offsetTop - dd.clientHeight / 2 + active.clientHeight / 2;
      dd.scrollTop = Math.max(0, targetTop);
    });
    return () => cancelAnimationFrame(id);
  }, [open, query]);

  // 关闭时清空搜索词；打开时如启用搜索框则自动聚焦
  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    if (showSearch) {
      const id = requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [open, showSearch]);

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

  const handleClear = (e) => {
    e.stopPropagation();
    onChange('');
    setOpen(false);
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
      return (
        <span className={`custom-select__value${!selected ? ' custom-select__placeholder' : ''}`}>
          {selected ? selected.label : placeholder}
        </span>
      );
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
        {allowClear && !multiple && value ? (
          <X size={size === 'sm' ? 12 : 14} className="custom-select__clear" onMouseDown={handleClear} />
        ) : (
          <ChevronDown size={size === 'sm' ? 12 : 14} className="custom-select__icon" />
        )}
      </button>

      {open && createPortal(
        <div
          className={`custom-select__dropdown custom-select__dropdown--portal ${size === 'sm' ? 'custom-select__dropdown--sm' : ''}`}
          ref={dropdownRef}
          style={dropdownStyle || undefined}
        >
          {showSearch && (
            <div
              className="custom-select__search"
              // 阻止点击搜索框时冒泡导致下拉收起
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Search size={14} className="custom-select__search-icon" />
              <input
                ref={searchInputRef}
                type="text"
                className="custom-select__search-input"
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                // 阻止输入空格等触发外层表单/按钮
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setOpen(false);
                  }
                }}
              />
              {query && (
                <X
                  size={14}
                  className="custom-select__search-clear"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setQuery('');
                    searchInputRef.current?.focus();
                  }}
                />
              )}
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="custom-select__empty">无匹配结果</div>
          ) : (
            filtered.map((opt) => {
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
            })
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
