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
    (m, i) => `${i + 1}. ${m.article.title}（${m.article.category}）\n   ${m.article.excerpt}`
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
