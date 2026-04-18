/**
 * 去除文本/HTML/Markdown 中的"下划线"痕迹：
 * 1) 拆掉 <u>...</u>（保留内部文字，仅去标签）
 * 2) 去掉任何 inline style 里的 text-decoration: underline（以及 text-decoration-line: underline）
 * 3) 去掉 Markdown 风格的 __xxx__（Word 下划线常见替代写法），保留内容
 *
 * 对 <a> 等链接标签不动（链接视觉下划线由全站 CSS 控制，与"正文下划线装饰"无关）。
 *
 * 安全说明：正则式简单稳健，仅针对已知形式做局部擦除，不尝试完整解析 HTML。
 */
export function stripUnderline(input) {
  if (input == null) return input;
  let s = String(input);

  // 1) <u ...>...</u> → 保留内容
  s = s.replace(/<u\b[^>]*>([\s\S]*?)<\/u>/gi, '$1');
  // 自闭合（极少见）<u/>
  s = s.replace(/<u\b[^>]*\/>/gi, '');

  // 2) 内联 style 里移除 underline
  //    匹配 style="... text-decoration: underline ..." / text-decoration-line: underline
  s = s.replace(/style\s*=\s*"([^"]*)"/gi, (m, css) => {
    const cleaned = cleanUnderlineInCss(css);
    if (!cleaned.trim()) return '';
    return `style="${cleaned}"`;
  });
  s = s.replace(/style\s*=\s*'([^']*)'/gi, (m, css) => {
    const cleaned = cleanUnderlineInCss(css);
    if (!cleaned.trim()) return '';
    return `style='${cleaned}'`;
  });

  // 3) Markdown 的 __xxx__（行内下划线/粗体替代写法）
  //    注意：Markdown 中 **xxx** 才是加粗，__xxx__ 在多数实现里也是加粗，但用户语义若曾用作下划线，这里一并去掉装饰变成纯文本
  //    为避免误伤代码/路径里的 __，这里只在被空白/标点包围时剥离
  s = s.replace(/(^|[\s(>])__([^_\n]+?)__(?=[\s),.;:!?<]|$)/g, '$1$2');

  return s;
}

function cleanUnderlineInCss(css) {
  return css
    .split(';')
    .map((decl) => decl.trim())
    .filter(Boolean)
    .filter((decl) => {
      const [rawProp, ...rest] = decl.split(':');
      const prop = (rawProp || '').trim().toLowerCase();
      const val = rest.join(':').trim().toLowerCase();
      if (prop === 'text-decoration' || prop === 'text-decoration-line') {
        // 只要值里有 underline，就整条丢掉；若同时有其他（line-through 等），拆分过滤
        if (!val.includes('underline')) return true;
        const kept = val
          .split(/\s+/)
          .filter((token) => token && token !== 'underline')
          .join(' ');
        if (!kept) return false;
        // 改写为保留其他值
        decl = `${prop}: ${kept}`;
        return true;
      }
      return true;
    })
    .map((decl) => {
      // 对上面修改过的值重新返回
      const [rawProp, ...rest] = decl.split(':');
      return `${rawProp.trim()}: ${rest.join(':').trim()}`;
    })
    .join('; ');
}

export default stripUnderline;
