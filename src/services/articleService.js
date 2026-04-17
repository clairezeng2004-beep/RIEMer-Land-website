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
 * 解码 HTML 实体（包括 &nbsp; 等常见命名实体）
 */
function decodeHTMLEntities(str) {
  return str
    .replace(/&nbsp;/gi, ' ')
    .replace(/&ensp;/gi, ' ')
    .replace(/&emsp;/gi, ' ')
    .replace(/&thinsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lsquo;/gi, '\u2018')
    .replace(/&rsquo;/gi, '\u2019')
    .replace(/&ldquo;/gi, '\u201C')
    .replace(/&rdquo;/gi, '\u201D')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '…')
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

/**
 * 去除 HTML 标签，并解码残留的 HTML 实体
 */
function stripHTML(html) {
  let text = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // 去除标签后再解码实体（微信文章中 &nbsp; 非常常见）
  return decodeHTMLEntities(text);
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
 * 本地提取摘要（降级方案）
 * 策略：挑选"有信息量"的句子，而不是单纯取前 N 字
 *  - 优先跳过开头的问候/梗概铺垫
 *  - 避免纯数字罗列的句子作为开头（如"绩点3.9/5.0 专业排名24/158"）
 *  - 选择包含动词/转折/关键词的句子
 */
export function generateSummaryLocal(content, maxLength = 100) {
  if (!content) return '';

  // 清洗：去除常见公众号铺垫
  let cleaned = content
    .replace(/^.{0,40}(大家好|hello|hi,|各位|同学们)[，,：:\s]/i, '')
    .replace(/点击上方.*?关注/g, '')
    .replace(/扫码关注.*?公众号/g, '')
    // 去除"注："/"写在前面"/"阅读指引"等铺垫段
    .replace(/注[:：][^。！？\n]{5,200}[。！？]/g, '')
    .replace(/写在前面[:：]?[^。！？\n]{5,300}[。！？]/g, '')
    .replace(/阅读指引[:：]?[^。！？\n]{5,300}[。！？]/g, '')
    // 去除"本文适合xx读者/建议xx阅读"这类元信息
    .replace(/[^。！？\n]{0,30}(适合|建议|推荐)[^。！？\n]{0,30}(读者|阅读|人群)[^。！？\n]{0,30}[。！？]/g, '')
    .trim();

  // 按句子切分
  const sentences = cleaned
    .split(/[。！？；\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 10 && s.length <= 120)
    // 过滤含第一人称和典型谦辞的句子（本地兜底也要尽量不露怯）
    .filter((s) => !/^(我|我们|自己|本人|笔者)/.test(s))
    .filter((s) => !/(幸运之神|幸运女神|运气|不值一提|鸣谢|感谢大家|感谢各位)/.test(s))
    .filter((s) => !/^(相信|大家|各位|同学们)/.test(s));

  if (sentences.length === 0) {
    return cleaned.slice(0, maxLength) + (cleaned.length > maxLength ? '…' : '');
  }

  // 给每个句子打分，挑选信息量高的
  const scored = sentences.map((s, idx) => {
    let score = 0;
    // 位置分：越靠前越高，但不是第一句（第一句通常是问候）
    if (idx >= 1 && idx <= 4) score += 5;
    else if (idx <= 8) score += 2;
    // 长度分：25-60 字最佳
    if (s.length >= 20 && s.length <= 60) score += 3;
    else if (s.length >= 15) score += 1;
    // 关键词分
    if (/分享|介绍|探讨|总结|经验|方法|建议|讲述|回顾|采访|专访|心得/.test(s)) score += 4;
    if (/保研|考研|留学|求职|实习|课程|活动|竞赛|辩论/.test(s)) score += 2;
    // 第一人称/谦辞 重罚（万一漏过 filter）
    if (/(我|我们|自己|本人|笔者)/.test(s)) score -= 6;
    if (/(幸运|运气|不值一提|眷顾|鸣谢)/.test(s)) score -= 8;
    // 数字密度惩罚：超过 4 个数字的句子通常是罗列，不适合做摘要首句
    const numCount = (s.match(/\d/g) || []).length;
    if (numCount > 6) score -= 3;
    // 避免以纯数据开头
    if (/^[\d.、,，/]+/.test(s)) score -= 2;
    return { s, score, idx };
  });

  // 排序：按分数降序，但保持原文顺序展开
  const topSentences = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .sort((a, b) => a.idx - b.idx)
    .map((x) => x.s);

  // 拼接直到达到摘要长度
  let summary = '';
  for (const sent of topSentences) {
    if (summary.length + sent.length > maxLength) {
      if (!summary) summary = sent.slice(0, maxLength);
      break;
    }
    summary += (summary ? '；' : '') + sent;
  }

  if (!summary) {
    summary = sentences[0].slice(0, maxLength);
  }

  // 结尾加句号
  if (!/[。！？]$/.test(summary)) summary += '。';

  return summary;
}

/**
 * AI 智能摘要（走专用的 /api/summarize 接口）
 *
 * 严格模式：只使用 AI 输出，失败直接抛错，不降级到本地兜底。
 * - 把完整正文喂给后端（后端内部再做 sampleContent 抽样）
 * - 35s 超时；失败重试 1 次
 * - 两次都失败抛异常，由调用方显示错误提示
 */
export async function generateSummaryAI(title, content) {
  if (!content || content.trim().length < 20) {
    throw new Error('正文内容过短，无法生成摘要');
  }

  const callOnce = async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 35000);
    try {
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content }), // 喂全文给后端
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `API 返回 ${response.status}`);
      }

      const data = await response.json();
      const summary = (data.summary || '').trim();

      // 校验：15-250 字之间 且 不含第一人称
      const hasFirstPerson = /(^|[^己自])(我|我们|本人|笔者)(?![要命国族])/.test(summary);
      if (summary && summary.length >= 15 && summary.length <= 250 && !hasFirstPerson) {
        return summary;
      }
      throw new Error(
        `AI 返回不合规（len=${summary.length}, firstPerson=${hasFirstPerson}）`,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  };

  try {
    return await callOnce();
  } catch (err1) {
    console.warn(`[articleService] AI 摘要第 1 次失败，1 秒后重试：${err1.message}`);
    await new Promise((r) => setTimeout(r, 1000));
    // 第二次失败直接向上抛错，不降级到本地
    return await callOnce();
  }
}

// 保持向后兼容的别名
export const generateSummary = generateSummaryLocal;

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

  // 注意：摘要不在抓取阶段自动生成，
  // 用户在确认弹窗手动点击「AI 生成」按钮触发（generateSummaryAI）。
  // 这样可以让弹窗立即展示，而不必先等 AI。
  return {
    rawTitle: parsed.rawTitle,
    title: titleForInfer,
    date: parsed.date || new Date().toISOString().split('T')[0],
    author: parsed.author,
    category: inferCategory(titleForInfer, contentText),
    tags: inferTags(titleForInfer, contentText),
    excerpt: '',
    outline: [],
    url,
    content: contentText,
  };
}
