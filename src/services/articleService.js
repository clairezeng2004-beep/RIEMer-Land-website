// ============================================
// RIEMer Land — 文章抓取 & 智能摘要服务
// ============================================
// 1. 通过代理抓取微信公众号文章 HTML
// 2. 解析标题、发布时间
// 3. 自动删减标题前缀
// 4. 生成智能摘要（本地提取 + 可选 LLM）

// ========== 常见标题前缀（自动删减） ==========
const TITLE_PREFIXES = [
  /^听\s*RIEMer\s*说\s*[|｜·丨:：]\s*/i,
  /^RIEMer\s*Land\s*[|｜·丨:：]\s*/i,
  /^RIEMer['']?s?\s*Space\s*[|｜·丨:：]\s*/i,
  /^RIEMer\s*课程测评\s*[|｜·丨:：]\s*/i,
  /^「听\s*RIEMer\s*说」\s*/,
  /^「RIEMer\s*Land」\s*/,
  /^【.*?】\s*/,
];

/**
 * 删减标题前缀
 */
export function cleanTitle(rawTitle) {
  let title = rawTitle.trim();
  for (const prefix of TITLE_PREFIXES) {
    title = title.replace(prefix, '');
  }
  return title.trim();
}

/**
 * 从 HTML 中解析微信公众号文章元数据
 */
function parseWechatArticle(html) {
  const result = {
    rawTitle: '',
    title: '',
    date: '',
    author: 'RIEMer Land',
    content: '',
  };

  // 提取标题：优先 og:title，其次 <title>
  const ogTitleMatch = html.match(
    /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i
  );
  if (ogTitleMatch) {
    result.rawTitle = decodeHTMLEntities(ogTitleMatch[1]);
  } else {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      result.rawTitle = decodeHTMLEntities(titleMatch[1]);
    }
  }
  result.title = cleanTitle(result.rawTitle);

  // 提取发布时间
  // 方式1: var ct = "1234567890"; (微信文章中的秒级时间戳)
  const ctMatch = html.match(/var\s+ct\s*=\s*["'](\d{10})["']/);
  if (ctMatch) {
    const d = new Date(parseInt(ctMatch[1], 10) * 1000);
    result.date = formatDate(d);
  } else {
    // 方式2: publish_time
    const publishMatch = html.match(/publish_time\s*=\s*["'](\d{10})["']/);
    if (publishMatch) {
      const d = new Date(parseInt(publishMatch[1], 10) * 1000);
      result.date = formatDate(d);
    } else {
      // 方式3: og:article:published_time 或文中日期
      const ogDateMatch = html.match(
        /<meta\s+property=["']article:published_time["']\s+content=["']([^"']+)["']/i
      );
      if (ogDateMatch) {
        result.date = ogDateMatch[1].split('T')[0];
      }
    }
  }

  // 提取作者
  const authorMatch = html.match(
    /<meta\s+property=["']og:article:author["']\s+content=["']([^"']+)["']/i
  );
  if (authorMatch) {
    result.author = decodeHTMLEntities(authorMatch[1]);
  } else {
    const nicknameMatch = html.match(/var\s+nickname\s*=\s*["']([^"']+)["']/);
    if (nicknameMatch) {
      result.author = decodeHTMLEntities(nicknameMatch[1]);
    }
  }

  // 提取正文内容（用于生成摘要）
  const contentMatch = html.match(
    /<div[^>]+id=["']js_content["'][^>]*>([\s\S]*?)<\/div>\s*<script/i
  );
  if (contentMatch) {
    result.content = stripHTML(contentMatch[1]).trim();
  } else {
    // fallback: og:description
    const descMatch = html.match(
      /<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i
    );
    if (descMatch) {
      result.content = decodeHTMLEntities(descMatch[1]);
    }
  }

  return result;
}

/**
 * 解码 HTML 实体
 */
function decodeHTMLEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

/**
 * 去除 HTML 标签
 */
function stripHTML(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 生成智能摘要
 * 本地提取前几个有意义的句子，去除太短的句子
 */
export function generateSummary(content, maxLength = 120) {
  if (!content) return '';

  // 按句子切分
  const sentences = content
    .split(/[。！？；\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);

  if (sentences.length === 0) return content.slice(0, maxLength);

  // 拼接前几个句子直到达到摘要长度
  let summary = '';
  for (const sent of sentences) {
    if (summary.length + sent.length > maxLength) break;
    summary += sent + '，';
  }

  // 去掉末尾逗号，加省略号
  summary = summary.replace(/，$/, '');
  if (summary.length < content.length * 0.8) {
    summary += '…';
  }

  return summary || content.slice(0, maxLength) + '…';
}

/**
 * 根据标题和内容自动推断分类
 */
export function inferCategory(title, content) {
  const text = `${title} ${content}`.toLowerCase();

  if (/听\s*riemer\s*说|访谈|专访|分享/.test(text)) return '听 RIEMer 说系列';
  if (/课程测评|选课|测评/.test(text)) return '课程测评';
  if (/辩论|活动|招新|表演赛/.test(text)) return '校园活动';
  return '经验分享';
}

/**
 * 根据内容自动提取标签
 */
export function inferTags(title, content) {
  const text = `${title} ${content}`;
  const tagCandidates = [
    { keyword: /保研/, tag: '保研' },
    { keyword: /考研/, tag: '考研' },
    { keyword: /留学|申请/, tag: '留学' },
    { keyword: /求职|就业|面试/, tag: '求职' },
    { keyword: /课程测评|选课/, tag: '课程测评' },
    { keyword: /经验分享|心得/, tag: '经验分享' },
    { keyword: /互联网|科技/, tag: '互联网' },
    { keyword: /金融/, tag: '金融' },
    { keyword: /经济学/, tag: '经济学' },
    { keyword: /辩论/, tag: '辩论赛' },
    { keyword: /招新/, tag: '招新' },
    { keyword: /学术|论文/, tag: '学术' },
    { keyword: /实习/, tag: '实习' },
    { keyword: /数模|建模/, tag: '数学建模' },
  ];

  const tags = [];
  for (const { keyword, tag } of tagCandidates) {
    if (keyword.test(text) && tags.length < 4) {
      tags.push(tag);
    }
  }

  return tags.length > 0 ? tags : ['经验分享'];
}

/**
 * 从文章内容自动生成大纲
 * 提取 ## / ### 标题行，或者按段落首句提取要点
 */
export function generateOutline(content) {
  if (!content) return [];

  const lines = content.split('\n');
  const outline = [];

  // 1. 优先提取 Markdown 标题行
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{2,3}\s+/.test(trimmed)) {
      outline.push(trimmed.replace(/^#{2,3}\s+/, '').trim());
    }
  }

  if (outline.length > 0) return outline;

  // 2. 如果没有 Markdown 标题，按段落分割，提取每段首句作为要点
  const paragraphs = content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 10);

  for (const para of paragraphs) {
    // 取段落首句（句号/问号/叹号之前）
    const firstSentence = para.split(/[。！？\n]/)[0]?.trim();
    if (firstSentence && firstSentence.length >= 4 && firstSentence.length <= 60) {
      outline.push(firstSentence);
    }
  }

  // 如果还是空，取前几个有意义的短句
  if (outline.length === 0) {
    const sentences = content
      .split(/[。！？；\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 6 && s.length <= 60);
    return sentences.slice(0, 5);
  }

  return outline.slice(0, 8);
}

// ========== 主入口：抓取并解析文章 ==========

/**
 * 抓取微信公众号文章并提取元数据
 * @param {string} url - 微信公众号文章链接
 * @returns {Promise<{title, rawTitle, date, author, category, tags, excerpt, url, content}>}
 */
export async function fetchAndParseArticle(url) {
  if (!url || !url.includes('mp.weixin.qq.com')) {
    throw new Error('请输入有效的微信公众号文章链接');
  }

  // 通过代理接口获取 HTML
  const proxyUrl = import.meta.env.DEV
    ? `/api/fetch-article?url=${encodeURIComponent(url)}`
    : `/api/fetch-article?url=${encodeURIComponent(url)}`;

  const response = await fetch(proxyUrl);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `抓取失败 (${response.status})`);
  }

  const { html } = await response.json();
  if (!html) {
    throw new Error('未获取到文章内容');
  }

  const parsed = parseWechatArticle(html);

  const titleForInfer = parsed.title || parsed.rawTitle;
  const contentText = parsed.content;

  return {
    rawTitle: parsed.rawTitle,
    title: titleForInfer,
    date: parsed.date || new Date().toISOString().split('T')[0],
    author: parsed.author,
    category: inferCategory(titleForInfer, contentText),
    tags: inferTags(titleForInfer, contentText),
    excerpt: generateSummary(contentText),
    outline: generateOutline(contentText),
    url,
    content: contentText,
  };
}
