// ============================================
// RIEMer Land — 文章助手 Chat Service
// ============================================
// 通过 Vercel Serverless Function (/api/chat) 调用 DeepSeek API
// API Key 安全存储在 Vercel 环境变量中，不暴露给前端
// 如果后端不可用，自动 fallback 到本地关键词匹配

import { articlesData } from '../data/siteData';

// 构建文章摘要上下文（发送给后端供大模型使用）
function buildArticlesContext() {
  return articlesData
    .map(
      (a) =>
        `[ID:${a.id}] 标题：${a.title} | 分类：${a.category} | 标签：${a.tags.join('、')} | 摘要：${a.excerpt}`
    )
    .join('\n');
}

// ========== 通过后端 Serverless Function 调用 DeepSeek ==========
async function callLLMApi(messages) {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        articlesContext: buildArticlesContext(),
      }),
    });

    if (!response.ok) {
      console.warn('后端 API 返回错误:', response.status);
      return null;
    }

    const data = await response.json();
    return data.reply || null;
  } catch (error) {
    console.warn('后端 API 调用失败，使用本地搜索:', error.message);
    return null;
  }
}

// ========== 领域关键词词典（用于从自然语句中提取有效关键词）==========
const DOMAIN_KEYWORDS = [
  '保研', '推免', '考研', '考公', '留学', '出国', '申请',
  '求职', '就业', '实习', '工作', '面试', '简历', '招聘',
  '课程', '选课', '测评', '必修', '选修', '通识',
  '经验', '分享', '心得', '故事', '经历',
  '焦虑', '迷茫', '规划', '方向', '成长', '心态', '压力',
  '辩论', '活动', '招新', '征稿',
  '金融', '经济学', '科技', '互联网', '学术', '论文', '数模', '建模',
  '大一', '大二', '大三', '大四', '备考', '复习',
  '时间线', '准备', '策略', '建议', '技巧',
  '字节', '销售', '科技行业',
];

// 闲聊 / 寒暄的模式识别与回复
const CASUAL_PATTERNS = [
  { pattern: /^(hi|hello|hey|你好|嗨|哈喽|嘿|在吗|在不在)/i, reply: '嗨～有什么想聊的或者想找的内容吗？我可以帮你推荐相关文章哦 😊' },
  { pattern: /^(早|早上好|早安|morning)/i, reply: '早上好呀～新的一天从 RIEMer Land 开始！有什么想了解的可以问我 😊' },
  { pattern: /^(晚上好|晚安|good night)/i, reply: '晚上好～忙了一天了吧！有什么想了解的随时问我哦～' },
  { pattern: /(谢谢|感谢|thanks|thx|thank)/i, reply: '不客气！有其他问题随时找我～' },
  { pattern: /^(你是谁|你叫什么|介绍一下你自己)/i, reply: '我是小 R，RIEMer Land 的查询助手～我可以帮你找文章、推荐经验分享，也能聊聊大学生活的各种问题。你想了解什么？' },
  { pattern: /(怎么用|怎么使用|有什么功能)/i, reply: '你可以直接跟我描述你想了解的内容，比如"保研经验"、"课程测评"、"求职分享"等，我会帮你找到相关文章～也可以点下面的快捷指令试试看！' },
];

// 意图关键词映射（当用户提出疑问句，尝试映射到领域关键词）
const INTENT_MAPPINGS = [
  { pattern: /(考研|考公).*(保研|推免)|保研.*(考研|考公)|(该|怎么)(选|选择).*(考研|保研)/, keywords: ['考研', '保研'] },
  { pattern: /保研.*(时间|准备|流程|规划|什么时候)/, keywords: ['保研', '时间线', '准备'] },
  { pattern: /考研.*(准备|复习|备考|怎么|如何)/, keywords: ['考研', '备考', '复习'] },
  { pattern: /(课程|选课).*(推荐|测评|好|值得)/, keywords: ['课程', '测评', '选课'] },
  { pattern: /(求职|找工作|就业).*(经验|分享|怎么|如何)/, keywords: ['求职', '就业', '经验'] },
  { pattern: /(实习).*(经验|分享|怎么|如何|推荐)/, keywords: ['实习', '求职', '经验'] },
  { pattern: /(简历).*(怎么|如何|写|准备)/, keywords: ['求职', '简历', '面试'] },
  { pattern: /(留学|出国|申请).*(经验|怎么|如何|准备|分享)/, keywords: ['留学', '出国', '申请'] },
  { pattern: /(迷茫|焦虑|不知道|困惑|纠结|压力|不确定)/, keywords: ['迷茫', '焦虑', '成长', '心态'] },
  { pattern: /(大学|大一|大二|大三|大四).*(规划|怎么|建议)/, keywords: ['规划', '方向', '成长'] },
  { pattern: /(值得|推荐|有什么).*(文章|看|读)/, keywords: ['经验', '分享'] },
  { pattern: /(辩论|辩论赛)/, keywords: ['辩论', '活动'] },
  { pattern: /(征稿|投稿)/, keywords: ['征稿', '课程测评'] },
];

/**
 * 从自然语言中提取有效关键词
 * 1. 先匹配意图模式，直接获取关键词
 * 2. 再从领域词典中提取命中的词
 * 3. 兜底：按分隔符拆分
 */
function extractKeywords(query) {
  const q = query.toLowerCase();
  const result = new Set();

  // 1. 意图模式匹配
  for (const { pattern, keywords } of INTENT_MAPPINGS) {
    if (pattern.test(q)) {
      keywords.forEach((kw) => result.add(kw));
    }
  }

  // 2. 领域词典匹配
  for (const kw of DOMAIN_KEYWORDS) {
    if (q.includes(kw.toLowerCase())) {
      result.add(kw);
    }
  }

  // 3. 兜底：按空格/逗号/顿号拆分
  if (result.size === 0) {
    const parts = q.split(/[\s,，、?？！!。.~～]+/).filter((s) => s.length >= 2);
    parts.forEach((p) => result.add(p));
  }

  return [...result];
}

// ========== 本地关键词匹配（fallback，支持自然语言）==========
function localSearch(query) {
  // 先检查是否为闲聊/寒暄
  for (const { pattern, reply } of CASUAL_PATTERNS) {
    if (pattern.test(query.trim())) {
      return { text: reply, articles: [] };
    }
  }

  // 智能提取关键词
  const keywords = extractKeywords(query);

  // 如果完全无法提取关键词，给出友好回复
  if (keywords.length === 0) {
    return {
      text: '我还没太理解你的意思呢～你可以试试跟我说想了解什么方面的内容，比如保研、考研、求职、课程测评等，我来帮你找相关文章！',
      articles: [],
    };
  }

  const scored = articlesData.map((article) => {
    const searchText = `${article.title} ${article.category} ${article.tags.join(' ')} ${article.excerpt} ${article.content}`.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      const lkw = kw.toLowerCase();
      if (article.title.toLowerCase().includes(lkw)) score += 3;
      if (article.tags.some((t) => t.toLowerCase().includes(lkw))) score += 2;
      if (article.category.toLowerCase().includes(lkw)) score += 2;
      if (article.excerpt.toLowerCase().includes(lkw)) score += 1;
      if (searchText.includes(lkw)) score += 0.5;
    }
    return { article, score };
  });

  const matches = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (matches.length === 0) {
    return {
      text: '暂时没找到完全匹配的文章，不过你可以换个说法试试，比如直接说"保研"、"考研"、"课程测评"、"求职"等关键词，我来帮你搜～',
      articles: [],
    };
  }

  // 根据匹配数量和关键词生成更自然的引导语
  const topicHint = keywords.slice(0, 2).join('、');
  const introText = matches.length === 1
    ? `找到 1 篇和"${topicHint}"相关的文章，来看看吧：`
    : `为你找到了 ${matches.length} 篇和"${topicHint}"相关的文章：`;

  const lines = matches.map(
    (m, i) => `${i + 1}. ${m.article.title}（${m.article.category}）\n   ${m.article.excerpt}`
  );

  return {
    text: `${introText}\n\n${lines.join('\n\n')}`,
    articles: matches.map((m) => m.article),
  };
}

// ========== 主入口 ==========
export async function sendMessage(messages) {
  // 尝试调用大模型 API
  const userMessages = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const llmReply = await callLLMApi(userMessages);

  if (llmReply) {
    // 从回复中提取提到的文章 ID
    const idMatches = [...llmReply.matchAll(/#(\d+)/g)];
    const mentionedArticles = idMatches
      .map((m) => articlesData.find((a) => a.id === m[1]))
      .filter(Boolean);

    return {
      text: llmReply,
      articles: mentionedArticles,
    };
  }

  // fallback: 智能本地搜索（支持自然对话 + 关键词提取）
  const lastUserMessage = messages[messages.length - 1]?.content || '';
  return localSearch(lastUserMessage);
}
