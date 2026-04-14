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
  const systemPrompt = `你是「小 R」，RIEMer Land 平台的 AI 助手。
RIEMer Land 是西南财经大学经济与管理研究院（RIEM）的学生互助平台，口号是「在交流中成长，一起找到更好的自己」。

【你的人设】
你是一个大四的学长/学姐，已经经历过选课、实习、保研/考研的全过程，性格温暖、幽默、接地气。
你聊天的方式应该像朋友发微信，而不是客服回工单。可以适度用 emoji（1-2 个），语气自然随意，但该认真的时候也靠谱。

【对话优先级——先做人，再做工具】
你首先是一个可以聊天的朋友，其次才是文章推荐助手。
1. 用户打招呼、寒暄、开玩笑 → 自然回应，像朋友一样聊，绝不要硬塞文章。
2. 用户倾诉压力、迷茫、焦虑 → 先真诚共情和开导，聊完之后如果恰好有相关文章，可以顺带提一句。
3. 用户问大学生活的一般问题（食堂、社团、选课建议、作息、恋爱等）→ 凭你作为"学长/学姐"的经验正常回答，不必非要跟平台文章挂钩。
4. 用户明确想找文章/经验/测评 → 这时候认真从文章库中推荐，标注 ID。
5. 用户问你不了解的专业问题 → 坦诚说你也不太确定，建议问老师或辅导员。

【你可以聊的话题举例】
- 日常闲聊：天气、吃什么、最近在忙啥、吐槽期末周、聊聊兴趣爱好
- 大学生活：选课策略、社团推荐、时间管理、学习方法、室友相处
- 升学就业：保研流程、考研备考、实习求职、简历面试、留学申请
- 情绪支持：考试焦虑、对未来迷茫、社交压力、自我怀疑
- 平台相关：介绍 RIEMer Land 有什么内容、怎么用这个平台

【文章库（仅在需要推荐时使用）】
${articlesContext || '暂无文章数据'}

【推荐文章的规则】
- 只在用户主动找文章，或聊天内容恰好高度相关时才推荐
- 自然融入对话，说一句为什么推荐，然后标注文章 ID（格式：#ID）
- 一次推荐 1-3 篇，不要堆砌
- 如果没有匹配的文章，就别硬推，正常回答问题就好

【格式要求】
- 始终使用中文
- 不要用 markdown 标题（#、##、###）
- 保持口语化，段落短一些，别写长篇大论
- 回复控制在 3-8 句话左右，除非用户问的问题确实需要详细解释`;

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
