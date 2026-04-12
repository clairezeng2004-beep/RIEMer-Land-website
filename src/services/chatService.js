// ============================================
// RIEMer Land — 文章助手 Chat Service
// ============================================
// 当前为本地关键词匹配模式（fallback）
// 拿到 API Key 后，取消注释 callLLMApi 中的 fetch 调用即可切换为大模型模式

import { articlesData } from '../data/siteData';

// ========== 配置区域 ==========
const API_CONFIG = {
  // TODO: 填入你的 API Key 和 endpoint
  apiKey: '',
  endpoint: '', // 例如: 'https://api.deepseek.com/chat/completions'
  model: '',    // 例如: 'deepseek-chat'
};

// 构建文章摘要上下文（供大模型使用）
function buildArticlesContext() {
  return articlesData
    .map(
      (a) =>
        `[ID:${a.id}] 标题：${a.title} | 分类：${a.category} | 标签：${a.tags.join('、')} | 摘要：${a.excerpt}`
    )
    .join('\n');
}

// 系统 Prompt
const SYSTEM_PROMPT = `你是 RIEMer Land 的文章助手，帮助用户找到感兴趣的文章。

以下是所有可用文章：
${buildArticlesContext()}

规则：
1. 根据用户的描述，推荐最相关的文章（1-5 篇）
2. 每篇推荐请说明推荐理由
3. 使用文章的实际标题，并注明文章 ID（格式：#ID）
4. 如果没有匹配的文章，友好地告知用户
5. 回答简洁友好，使用中文`;

// ========== 大模型 API 调用 ==========
async function callLLMApi(messages) {
  if (!API_CONFIG.apiKey || !API_CONFIG.endpoint) {
    return null; // 未配置 API，使用本地 fallback
  }

  try {
    const response = await fetch(API_CONFIG.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_CONFIG.apiKey}`,
      },
      body: JSON.stringify({
        model: API_CONFIG.model,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        temperature: 0.7,
        max_tokens: 800,
      }),
    });

    if (!response.ok) throw new Error(`API 请求失败: ${response.status}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (error) {
    console.error('LLM API 调用失败:', error);
    return null;
  }
}

// ========== 本地关键词匹配（fallback）==========
function localSearch(query) {
  const keywords = query.toLowerCase().split(/[\s,，、]+/).filter(Boolean);

  const scored = articlesData.map((article) => {
    const searchText = `${article.title} ${article.category} ${article.tags.join(' ')} ${article.excerpt} ${article.content}`.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (article.title.toLowerCase().includes(kw)) score += 3;
      if (article.tags.some((t) => t.toLowerCase().includes(kw))) score += 2;
      if (article.category.toLowerCase().includes(kw)) score += 2;
      if (article.excerpt.toLowerCase().includes(kw)) score += 1;
      if (searchText.includes(kw)) score += 0.5;
    }
    return { article, score };
  });

  const matches = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (matches.length === 0) {
    return {
      text: '抱歉，没有找到与你描述相关的文章。你可以试试换个关键词，比如"保研"、"考研"、"求职"、"课程测评"等。',
      articles: [],
    };
  }

  const lines = matches.map(
    (m, i) => `${i + 1}. **${m.article.title}**（${m.article.category}）\n   ${m.article.excerpt}`
  );

  return {
    text: `为你找到了 ${matches.length} 篇相关文章：\n\n${lines.join('\n\n')}`,
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

  // fallback: 本地关键词匹配
  const lastUserMessage = messages[messages.length - 1]?.content || '';
  return localSearch(lastUserMessage);
}
