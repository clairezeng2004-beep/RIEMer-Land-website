// Vercel Serverless Function: 专用于生成文章摘要
// 路径: POST /api/summarize
// 与 /api/chat 分离，使用纯净的摘要 prompt，避免聊天机器人人设干扰

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API Key 未配置' });
  }

  const { title = '', content = '' } = req.body || {};

  if (!content || content.trim().length < 20) {
    return res.status(400).json({ error: '正文内容过短，无法生成摘要' });
  }

  // 截取正文前 3000 字，避免 token 过多
  const truncated = content.slice(0, 3000);

  const systemPrompt = `你是一个中文摘要生成器，专门为公众号文章撰写简短的预览摘要。

严格遵守以下规则：
1. 只输出纯文本摘要本身，一段话，60-110 字之间
2. 绝对不要使用引号、emoji、markdown 格式、标题、列表
3. 绝对不要使用以下开头：本文、这篇文章、作者、文章讲、今天给大家、推荐这篇
4. 用第三人称客观概括文章核心内容（主题 + 关键信息 + 价值），语言凝练
5. 不要复述标题，不要添加解释或点评，不要加省略号
6. 不要以"。"以外的标点结尾`;

  const userPrompt = `文章标题：${title}

文章正文：
${truncated}

请生成摘要。`;

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[summarize] DeepSeek 错误:', response.status, errorText);
      return res.status(response.status).json({
        error: `DeepSeek API 请求失败: ${response.status}`,
      });
    }

    const data = await response.json();
    let reply = data.choices?.[0]?.message?.content || '';

    // ========== 清洗 AI 输出 ==========
    reply = reply.trim()
      // 去除首尾引号
      .replace(/^["'「『《]+|["'」』》]+$/g, '')
      // 去除常见的"摘要："前缀
      .replace(/^(摘要|简介|概述|内容摘要)\s*[:：]\s*/, '')
      // 去除 markdown 标题符号
      .replace(/^#+\s*/, '')
      // 去除可能多行中只保留第一段（摘要应该是单段）
      .split(/\n{2,}/)[0]
      .replace(/\n+/g, ' ')
      .trim();

    if (!reply || reply.length < 15) {
      return res.status(502).json({ error: 'AI 返回内容过短' });
    }

    return res.status(200).json({ summary: reply });
  } catch (error) {
    console.error('[summarize] 调用异常:', error);
    return res.status(500).json({ error: `调用异常: ${error.message}` });
  }
}
