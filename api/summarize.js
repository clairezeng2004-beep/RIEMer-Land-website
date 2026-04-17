// Vercel Serverless Function: 专用于生成文章摘要
// 路径: POST /api/summarize
// 使用精细化 prompt + few-shot 示例，保证 AI 真正概括文章核心内容，
// 而不是照搬文章开头的"阅读指引/作者自述/关注公众号"铺垫。

/**
 * 从正文中抽取代表性片段：头 25% + 中 45% + 尾 30%
 * 降低开头权重 —— 公众号文章开头常是自我介绍/鸣谢/写在前面等铺垫，
 * 真正的板块内容在中后段，这样能让 AI 看到更均衡的全文视图
 */
function sampleContent(content, totalLen = 4500) {
  if (content.length <= totalLen) return content;

  const headLen = Math.floor(totalLen * 0.25);
  const midLen = Math.floor(totalLen * 0.45);
  const tailLen = totalLen - headLen - midLen;

  const head = content.slice(0, headLen);
  const midStart = Math.floor((content.length - midLen) / 2);
  const mid = content.slice(midStart, midStart + midLen);
  const tail = content.slice(content.length - tailLen);

  return `${head}\n\n【文章中部节选】\n${mid}\n\n【文章结尾节选】\n${tail}`;
}

/**
 * 判断文章疑似类型，用于微调 prompt
 */
function detectArticleType(title, content) {
  const text = `${title} ${content.slice(0, 500)}`;
  if (/专访|访谈|对话|听.*说/.test(text)) return 'interview'; // 人物访谈
  if (/课程测评|选课|测评|课评/.test(text)) return 'review'; // 课程/测评
  if (/保研|考研|留学|申请|求职|实习/.test(text)) return 'experience'; // 经验分享
  if (/活动|招新|辩论|竞赛|表演赛/.test(text)) return 'event'; // 活动
  return 'general';
}

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

  const sampled = sampleContent(content, 4500);
  const articleType = detectArticleType(title, content);

  // ========== 类型化指引（让 AI 知道要抓什么板块） ==========
  const typeGuidance = {
    interview: '访谈类：抓受访者的身份/去向 + 访谈涉及的几个核心话题板块（如申请经历、方法论、心态调整等）。',
    review: '课程测评类：抓评测对象（哪门课/哪位老师） + 评价维度（难度/作业量/给分/内容侧重）。',
    experience: '经验分享类（保研/考研/留学/求职）：抓作者去向 + 文章涉及的几个板块（如背景铺垫、申请时间线、选校策略、面试准备、心态复盘等）。',
    event: '活动类：抓活动名称 + 核心流程/亮点板块。',
    general: '抓文章主题 + 围绕主题展开的几个主要板块。',
  };

  const systemPrompt = `你是一名专业的中文内容编辑，为公众号文章生成卡片预览摘要。摘要的作用是让读者一眼看出"这篇文章分几个板块、讲了哪些方面的内容"，而不是替作者说结论。

【核心任务】
用一段话概括文章包含的主要板块/内容亮点，**目标 50 字以内，最多不超过 100 字**。像是给文章做一个"内容导览"。

【硬性规则 · 违反即失败】
1. ❌ 严禁使用第一人称：不得出现"我/我们/自己/本人/笔者"等字样。如果原文是第一人称自述，必须转换成第三人称客观描述。
2. ❌ 严禁照搬原文句子：尤其是开头的个人背景、自我介绍、谦辞（如"靠运气""幸运之神眷顾""不值一提"）、鸣谢、写在前面。
3. ❌ 严禁复述标题、加引号、加emoji、加markdown标记、加省略号
4. ❌ 严禁以"本文/这篇文章/作者/文章/今天/一文"等冗余主语开头
5. ❌ 严禁输出点评、推荐语、情绪词（如"值得一读""干货满满""精彩""深入"）
6. ❌ 严禁超过 100 字

【写作方法】
- 用"涵盖 A、B、C 等板块"或"围绕 A、B、C 展开"的句式列出文章涉及的主要方面
- 允许先点明文章的核心身份/对象（如"港中文金融硕士录取者的申请复盘"），然后接板块列举
- 优先写**具体维度**（选校策略/时间规划/文书打磨/面试准备/心态调整/院校对比/课程内容/活动流程）而不是抽象评价
- 中性、客观、密度高；一句话即可

【正例】
✅ 港中文金融硕士录取者的申请复盘，涵盖个人背景、时间规划、选校权衡、文书与面试准备及心态调整。（46字）
✅ 字节算法实习生访谈，围绕经济学转码路径、刷题节奏、简历优化与面试复盘四个板块展开。（41字）
✅ 金融学院三门热门选修课测评，对比难度、作业量、给分与内容侧重，给出不同阶段选课建议。（42字）
✅ 保研暑期夏令营全流程指南，覆盖院校筛选、材料准备、笔面试要点与后续联系导师的节奏安排。（43字）

【反例 · 避免】
❌ "我能够如愿上岸大概是幸运之神眷顾..."（用了第一人称，照搬原文自述）
❌ "作者分享了自己的保研经验和心得体会。"（空话，没说具体板块）
❌ "一篇非常值得一读的保研经验贴，干货满满。"（推荐语，无实质信息）
❌ "周越同学拿到了港中文的offer，她说..."（带转述动词，像在讲故事而非导览）

【本篇文章类型】${typeGuidance[articleType]}

只输出摘要正文本身（一句话、不超100字），不要任何前缀、标注或解释。`;

  const userPrompt = `文章标题：${title}

文章正文（节选）：
${sampled}

请按上述规范生成摘要。`;

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
        temperature: 0.2,
        max_tokens: 220,
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
    reply = reply
      .trim()
      // 去除首尾引号
      .replace(/^["'「『《【]+|["'」』》】]+$/g, '')
      // 去除常见的"摘要："前缀
      .replace(/^(摘要|简介|概述|内容摘要|文章摘要)\s*[:：]\s*/, '')
      // 去除 markdown 标题符号
      .replace(/^#+\s*/, '')
      // 去除开头的冗余主语（本文/这篇文章/作者/文章/该文）
      .replace(/^(本文|这篇文章|该文|文章|作者)[，,：:]?\s*/, '')
      // 多段合并为单段
      .split(/\n{2,}/)[0]
      .replace(/\n+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // 第一人称兜底：如果 AI 仍用了"我/我们/自己/笔者/本人"，转换为客观措辞
    reply = reply
      .replace(/我(们|自己|个人)?认为/g, '文中提到')
      .replace(/(我们|我)(的|)/g, '')
      .replace(/自己的/g, '')
      .replace(/笔者|本人/g, '作者');

    // 去重复空格并重新收尾
    reply = reply.replace(/\s{2,}/g, ' ').trim();

    // 保证以句号结尾
    if (reply && !/[。！？]$/.test(reply)) {
      reply += '。';
    }

    // 长度硬约束：超过 110 字截断到最近的句号/分号
    if (reply.length > 110) {
      const cutPoint = reply.slice(0, 110).search(/[。！？；;][^。！？；;]*$/);
      if (cutPoint > 40) {
        reply = reply.slice(0, cutPoint + 1);
      } else {
        reply = reply.slice(0, 100).replace(/[，,、\s]+$/, '') + '。';
      }
    }

    if (!reply || reply.length < 15) {
      return res.status(502).json({ error: 'AI 返回内容过短' });
    }

    return res.status(200).json({ summary: reply, articleType });
  } catch (error) {
    console.error('[summarize] 调用异常:', error);
    return res.status(500).json({ error: `调用异常: ${error.message}` });
  }
}
