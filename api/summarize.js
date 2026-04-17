// Vercel Serverless Function: 专用于生成文章摘要
// 路径: POST /api/summarize
// 使用精细化 prompt + few-shot 示例，保证 AI 真正概括文章核心内容，
// 而不是照搬文章开头的"阅读指引/作者自述/关注公众号"铺垫。

/**
 * 从正文中抽取代表性片段：头 40% + 中 40% + 尾 20%
 * 避免只截开头导致 AI 拿到的都是铺垫内容
 */
function sampleContent(content, totalLen = 4000) {
  if (content.length <= totalLen) return content;

  const headLen = Math.floor(totalLen * 0.4);
  const midLen = Math.floor(totalLen * 0.4);
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

  const sampled = sampleContent(content, 4000);
  const articleType = detectArticleType(title, content);

  // ========== 类型化指引（让 AI 知道要抓什么点） ==========
  const typeGuidance = {
    interview: '这是人物访谈类文章，请概括：受访者是谁（身份/去向）、分享了哪些核心经历或观点、对读者的价值。不要只写"xxx接受采访分享经验"。',
    review: '这是课程测评类文章，请概括：评测的是哪门课/哪位老师、核心评价维度（难度/作业量/给分/内容）、整体结论。',
    experience: '这是经验分享类文章（保研/考研/留学/求职等）。请概括：作者的去向/结果、核心经历节点、关键经验或建议。不要只写"分享了自己的经历"这种空话。',
    event: '这是活动介绍类文章，请概括：活动名称、核心内容或亮点、面向对象或意义。',
    general: '请提炼文章主题、核心内容和读者价值。',
  };

  const systemPrompt = `你是一名专业的中文内容编辑，擅长为大学生公众号文章撰写预览摘要。你的摘要会出现在文章卡片上，读者据此决定要不要点进去看。

【核心任务】
用 70-110 字的一段话，**凝练概括文章最核心、最有价值的信息**——告诉读者这篇文章讲了什么、有什么看点。

【严禁踩的坑】
1. 严禁照搬文章开头的"阅读指引""作者自述""写在前面""本文适合xxx读者"等元信息
2. 严禁只写笼统的"作者分享了自己的经验/心得/故事"这种空话——必须说清楚具体内容
3. 严禁复述标题、加引号、加emoji、加markdown标记
4. 严禁用"本文/这篇文章/作者在文中/今天给大家"开头
5. 严禁添加点评、建议、推荐语（如"值得一读""干货满满"）
6. 严禁使用省略号或以非句号结尾

【写作方法】
- 第三人称客观叙述，像新闻导语一样直接切入
- 抓"谁 + 做了什么 + 核心结论或亮点"的结构
- 具体 > 抽象：写"拿到港科大金融硕士offer，复盘保研+留学双线申请过程"，而不是"分享申请经验"
- 优先呈现文章中有信息密度的部分（具体院校、方法、观点、数据），而不是情绪或铺垫

【示例1·经验分享】
作者以港中文金融硕士录取者身份，复盘保研与留学双线申请的时间规划与心得，重点讨论信息差的弥合、文书打磨以及面试准备，并坦言在港硕项目有限的前提下如何做选校取舍。

【示例2·人物访谈】
访谈字节跳动算法实习生 X 同学，围绕从经济学转码、leetcode 刷题节奏、简历投递与面试经验展开，还原一条非科班背景通往大厂算法岗的路径。

【示例3·课程测评】
盘点金融学院三门热门选修课的难度曲线、作业强度与给分情况，对照不同阶段同学的选课目标给出搭配建议，并提醒易踩的坑。

【本篇文章类型】${typeGuidance[articleType]}

只输出摘要正文本身，不要任何前缀、标注或解释。`;

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
        temperature: 0.3,
        max_tokens: 400,
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
      // 去除开头的"本文/这篇文章/作者在文中"等容错
      .replace(/^(本文|这篇文章|该文|文章)[，,：:]?\s*/, '')
      // 多段合并为单段
      .split(/\n{2,}/)[0]
      .replace(/\n+/g, ' ')
      .trim();

    // 保证以句号结尾
    if (reply && !/[。！？]$/.test(reply)) {
      reply += '。';
    }

    if (!reply || reply.length < 20) {
      return res.status(502).json({ error: 'AI 返回内容过短' });
    }

    return res.status(200).json({ summary: reply, articleType });
  } catch (error) {
    console.error('[summarize] 调用异常:', error);
    return res.status(500).json({ error: `调用异常: ${error.message}` });
  }
}
