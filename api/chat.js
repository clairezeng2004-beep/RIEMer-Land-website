// Vercel Serverless Function: 代理 DeepSeek API 调用
// 路径: POST /api/chat
// API Key 通过 Vercel 环境变量 DEEPSEEK_API_KEY 配置，不暴露给前端

export default async function handler(req, res) {
  // CORS headers
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

  const { messages, articlesContext } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: '缺少 messages 参数' });
  }

  // 构建系统 Prompt
  const systemPrompt = `你是 RIEMer Land 的查询助手，帮助用户找到感兴趣的内容。

以下是所有可用文章：
${articlesContext || '暂无文章数据'}

规则：
1. 根据用户的描述，推荐最相关的文章（1-5 篇）
2. 每篇推荐请说明推荐理由
3. 使用文章的实际标题，并注明文章 ID（格式：#ID）
4. 如果没有匹配的文章，友好地告知用户
5. 回答简洁友好，使用中文`;

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature: 0.7,
        max_tokens: 800,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('DeepSeek API 错误:', response.status, errorText);
      return res.status(response.status).json({
        error: `DeepSeek API 请求失败: ${response.status}`,
      });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || null;

    return res.status(200).json({ reply });
  } catch (error) {
    console.error('DeepSeek API 调用异常:', error);
    return res.status(500).json({ error: `调用异常: ${error.message}` });
  }
}
