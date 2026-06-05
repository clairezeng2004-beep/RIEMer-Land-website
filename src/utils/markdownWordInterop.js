import { marked } from 'marked';

function escapeMarkdownText(text = '') {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function normalizeMarkdown(md = '') {
  return md
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function textFromNode(node) {
  return node?.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function inlineToMarkdown(node) {
  if (!node) return '';

  if (node.nodeType === Node.TEXT_NODE) {
    return escapeMarkdownText(node.textContent || '');
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = node.tagName.toLowerCase();
  const children = () => Array.from(node.childNodes).map(inlineToMarkdown).join('');

  if (tag === 'br') return '\n';
  if (tag === 'strong' || tag === 'b') return `**${children()}**`;
  if (tag === 'em' || tag === 'i') return `*${children()}*`;
  if (tag === 'code') return `\`${node.textContent || ''}\``;
  if (tag === 'a') {
    const label = children() || escapeMarkdownText(node.getAttribute('href') || '');
    const href = node.getAttribute('href') || '';
    return href ? `[${label}](${href})` : label;
  }
  if (tag === 'img') {
    const src = node.getAttribute('src') || '';
    if (!src) return '';
    return `![${escapeMarkdownText(node.getAttribute('alt') || '')}](${src})`;
  }

  return children();
}

function tableToMarkdown(table) {
  const rows = Array.from(table.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.children)
      .filter((cell) => ['td', 'th'].includes(cell.tagName.toLowerCase()))
      .map((cell) => inlineToMarkdown(cell).replace(/\n+/g, ' ').trim())
  ).filter((row) => row.length > 0);

  if (!rows.length) return '';

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => {
    const next = [...row];
    while (next.length < columnCount) next.push('');
    return next;
  });
  const header = normalized[0];
  const divider = Array.from({ length: columnCount }, () => '---');
  const body = normalized.slice(1);
  return [header, divider, ...body].map((row) => `| ${row.join(' | ')} |`).join('\n');
}

function blockToMarkdown(node, depth = 0) {
  if (!node) return '';

  if (node.nodeType === Node.TEXT_NODE) {
    return escapeMarkdownText(node.textContent || '').trim();
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = node.tagName.toLowerCase();
  const inline = () => inlineToMarkdown(node).trim();
  const blocks = () => Array.from(node.childNodes).map((child) => blockToMarkdown(child, depth)).filter(Boolean).join('\n\n');

  if (/^h[1-6]$/.test(tag)) {
    return `${'#'.repeat(Number(tag[1]))} ${inline()}`.trim();
  }
  if (tag === 'p') return inline();
  if (tag === 'blockquote') {
    return blocks()
      .split('\n')
      .map((line) => `> ${line}`.trimEnd())
      .join('\n');
  }
  if (tag === 'ul' || tag === 'ol') {
    let index = 1;
    return Array.from(node.children)
      .filter((child) => child.tagName.toLowerCase() === 'li')
      .map((li) => {
        const marker = tag === 'ol' ? `${index++}. ` : '- ';
        const firstLine = inlineToMarkdown(li).split('\n')[0].trim();
        const nested = Array.from(li.children)
          .filter((child) => ['ul', 'ol'].includes(child.tagName.toLowerCase()))
          .map((child) => blockToMarkdown(child, depth + 1))
          .filter(Boolean)
          .join('\n');
        const prefix = '  '.repeat(depth);
        return `${prefix}${marker}${firstLine}${nested ? `\n${nested}` : ''}`;
      })
      .join('\n');
  }
  if (tag === 'pre') return `\`\`\`\n${node.textContent?.replace(/\n$/, '') || ''}\n\`\`\``;
  if (tag === 'hr') return '---';
  if (tag === 'table') return tableToMarkdown(node);
  if (tag === 'img') return inlineToMarkdown(node);
  if (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'body') return blocks();

  const text = textFromNode(node);
  return text ? inline() : blocks();
}

export function htmlToMarkdown(html = '') {
  if (!html.trim()) return '';
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll('script, style, meta, link, title, head').forEach((el) => el.remove());
  return normalizeMarkdown(blockToMarkdown(parsed.body));
}

export function markdownToHtml(markdown = '') {
  if (!markdown.trim()) return '';
  return marked.parse(markdown, { breaks: true, gfm: true });
}

