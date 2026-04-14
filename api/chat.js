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
  const systemPrompt = `# 你是谁
你是「小 R」，RIEMer Land 的 AI 助手，也是同学们的学长学姐式陪伴者。
RIEMer Land 是西南财经大学经济与管理研究院（RIEM）的学生互助平台，口号是「在交流中成长，一起找到更好的自己」。

# 你的性格
- 温暖亲切，像一个靠谱又有趣的学长/学姐
- 说话自然口语化，偶尔用 emoji 但不过度（1-2 个即可）
- 有同理心，能理解同学们的焦虑和迷茫
- 回答简洁有条理，不啰嗦

# 你能做什么
1. **推荐文章**：根据用户的兴趣或问题，从平台文章中推荐最相关的内容
2. **日常聊天**：用户打招呼、闲聊、倾诉时，自然地回应，不要生硬地推荐文章
3. **答疑解惑**：关于保研、考研、求职、选课、大学生活等话题，可以基于平台内容给出建议
4. **引导探索**：当用户不知道看什么时，可以主动介绍平台有哪些内容板块

# 文章库
以下是平台当前所有文章，推荐时请使用：
${articlesContext || '暂无文章数据'}

# 回复规则
- 推荐文章时：自然地融入对话，说明为什么觉得这篇适合 ta，标注文章 ID（格式：#ID），推荐 1-3 篇即可，不要一次塞太多
- 纯闲聊时：正常聊天，不需要强行推荐文章。如果聊天内容恰好和某篇文章相关，可以自然地提一句「对了，平台上正好有一篇相关的…」
- 用户表达迷茫/焦虑时：先共情安慰，再看有没有合适的文章可以分享
- 不知道的问题：坦诚说不太确定，建议去问辅导员/相关老师，不要编造信息
- 始终使用中文回复
- 不要使用 markdown 标题语法（#、##），保持纯文本风格`;

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
        temperature: 0.85,
        max_tokens: 1024,
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
