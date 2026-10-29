import { Columns, Table as TableIcon, Highlighter } from 'lucide-react';

function insertTextAtTextarea(textarea, value, snippet, { selectOffset = null, selectLength = 0 } = {}) {
  const start = textarea?.selectionStart ?? value.length;
  const end = textarea?.selectionEnd ?? value.length;
  const nextValue = `${value.slice(0, start)}${snippet}${value.slice(end)}`;
  const cursor = selectOffset == null
    ? start + snippet.length
    : start + selectOffset;

  requestAnimationFrame(() => {
    textarea?.focus();
    textarea?.setSelectionRange(cursor, cursor + selectLength);
  });

  return nextValue;
}

function buildMarkdownColumns(count) {
  const n = Math.max(2, Math.min(4, Number(count) || 2));
  const cols = Array.from({ length: n }, (_, index) => (
    `  <div class="msc-col">\n    <p>第 ${index + 1} 栏内容</p>\n  </div>`
  )).join('\n');
  return `\n<div class="msc-cols msc-cols--${n}" data-cols="${n}">\n${cols}\n</div>\n`;
}

function buildMarkdownTable(rows = 3, cols = 3) {
  const r = Math.max(2, Math.min(8, Number(rows) || 3));
  const c = Math.max(2, Math.min(8, Number(cols) || 3));
  const header = Array.from({ length: c }, (_, index) => `标题 ${index + 1}`);
  const divider = Array.from({ length: c }, () => '---');
  const body = Array.from({ length: r - 1 }, (_, row) => (
    Array.from({ length: c }, (_, col) => `内容 ${row + 1}-${col + 1}`)
  ));
  return `\n${[header, divider, ...body].map((line) => `| ${line.join(' | ')} |`).join('\n')}\n`;
}

function buildMarkdownCallout(tone = 'sage') {
  const safeTone = ['sage', 'sun', 'rose', 'sky', 'lavender'].includes(tone) ? tone : 'sage';
  return `\n<div class="msc-callout msc-callout--${safeTone}" data-callout-tone="${safeTone}">\n  <span class="msc-callout__emoji">💡</span>\n  <div class="msc-callout__body" data-placeholder="在这里输入高亮内容" data-empty>\n    <p><br /></p>\n  </div>\n</div>\n`;
}

export default function MarkdownInsertToolbar({ textareaRef, value, onChange }) {
  const insertSnippet = (snippet, options) => {
    onChange(insertTextAtTextarea(textareaRef.current, value, snippet, options));
  };

  return (
    <div className="msc-md-toolbar" aria-label="Markdown 插入工具">
      <div className="msc-md-toolbar__group">
        {[2, 3, 4].map((count) => (
          <button
            key={count}
            type="button"
            className="msc-md-toolbar__btn"
            onClick={() => insertSnippet(buildMarkdownColumns(count))}
            title={`插入 ${count} 栏分栏`}
          >
            <Columns size={14} /> {count} 栏
          </button>
        ))}
      </div>
      <div className="msc-md-toolbar__group">
        <button
          type="button"
          className="msc-md-toolbar__btn"
          onClick={() => insertSnippet(buildMarkdownTable(3, 3))}
          title="插入 3 × 3 表格"
        >
          <TableIcon size={14} /> 表格
        </button>
      </div>
      <div className="msc-md-toolbar__group">
        {[
          { id: 'sage', label: '绿', color: '#dfeee4' },
          { id: 'sun', label: '黄', color: '#fff0bf' },
          { id: 'rose', label: '粉', color: '#ffe1df' },
          { id: 'sky', label: '蓝', color: '#dcecff' },
          { id: 'lavender', label: '紫', color: '#eadfff' },
        ].map((tone) => (
          <button
            key={tone.id}
            type="button"
            className="msc-md-toolbar__btn msc-md-toolbar__btn--swatch"
            onClick={() => insertSnippet(buildMarkdownCallout(tone.id))}
            title={`插入${tone.label}色高亮块`}
          >
            <Highlighter size={14} />
            <span className="msc-md-toolbar__swatch" style={{ background: tone.color }} />
            {tone.label}
          </button>
        ))}
      </div>
    </div>
  );
}

