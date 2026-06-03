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

  const systemPrompt = `你是一名认真、克制的中文内容编辑，为公众号文章生成卡片预览摘要。摘要要像编辑写给读者的一段自然导语：说清文章讲什么，句子顺口，构词准确，少用套话，保留一点原文的气息、问题意识或情绪张力。

【核心任务】
用一段话概括文章的主要内容与吸引点，**目标 55-90 字，最多不超过 120 字**。优先写出读者为什么会想看：它解决什么困惑、呈现什么选择、记录什么经历，或留下什么值得回味的问题。表达必须像通顺的人写出来的中文短段落，而不是关键词拼接。

【硬性规则 · 违反即失败】
1. ❌ 严禁使用第一人称：不得出现"我/我们/自己/本人/笔者"等字样。如果原文是第一人称自述，必须转换成第三人称客观描述。
2. ❌ 不要机械照搬开头的个人背景、自我介绍、谦辞（如"靠运气""幸运之神眷顾""不值一提"）、鸣谢、写在前面。
3. ✅ 可以引用原文中 1 句很短的金句或问题句，但必须真实来自原文，且总引用不超过 24 个汉字；引用要服务于摘要，不要为了引用而引用。
4. ❌ 严禁复述标题、加emoji、加markdown标记、加省略号
5. ❌ 严禁以"本文/这篇文章/作者/文章/今天/一文"等冗余主语开头
6. ❌ 严禁空泛推荐语（如"值得一读""干货满满""精彩""深入"），但允许自然、有分寸的吸引力表达。
7. ❌ 严禁超过 120 字
8. ❌ 严禁 AI 腔和生硬构词：不要使用"多维度解析""深度剖析""全景呈现""赋能""路径探索""成长叙事""实践图景""经验闭环""方法论拆解"等泛化表达。

【写作方法】
- 不要每次都用"涵盖 A、B、C"或"围绕 A、B、C 展开"。句式要多样，可以使用：
  - 金句引入："选择不是一次押注。"从这条线索出发，带出……
  - 问题引入：当实习、行业与长期规划互相拉扯时，……
  - 场景引入：从营销到研究，再到投行承做，……
  - 导览式：以……为主线，串起……
- 优先写**具体维度**（行业选择/职业规划/资源获取/实习垂直度/选校策略/面试准备/心态调整/课程内容/活动流程）而不是抽象评价。
- 如果原文出现关于人生意义、选择、成长、迷茫、边界、勇气、长期主义等句子，优先考虑摘取短句作为引子。
- 语气可以更有画面感和节奏，但不能夸张、不能编造、不能像广告词。
- 写完后自检一遍：每个词是否是日常中文里真的会这样搭配；如果像硬凑概念词，就改成更朴素、具体的说法。
- 多用自然动词和清楚关系，比如"讲起、串起、回到、比较、记录、拆开、带出、提醒"，少用抽象名词堆叠。
- 尽量让句子前后有因果、递进或转折，不要把几个名词短语用顿号硬连起来。

【正例】
✅ 从营销到研究，再到投行承做，嘉宾把几段实习串成一场关于选择的复盘：行业怎么判断，资源如何转化，经历又该怎样靠近长期规划。（58字）
✅ "选择不是一次押注。"这篇申请复盘从时间线、选校权衡、文书打磨与面试准备讲起，也把焦虑、取舍和后劲留在了经验之外。（59字）
✅ 当课程难度、作业量和给分预期同时摆上桌面，这份测评不只比较三门课，也帮不同阶段的同学判断该把精力投向哪里。（55字）
✅ 一场活动的热闹背后，是流程、协作与现场反馈的连续展开：从筹备到复盘，记录一次校园公共表达如何被真正组织起来。（55字）

【反例 · 避免】
❌ "我能够如愿上岸大概是幸运之神眷顾..."（用了第一人称，照搬原文自述）
❌ "作者分享了自己的保研经验和心得体会。"（空话，没说具体板块）
❌ "一篇非常值得一读的保研经验贴，干货满满。"（推荐语，无实质信息）
❌ "周越同学拿到了港中文的offer，她说..."（带转述动词，像在讲故事而非导览）

【本篇文章类型】${typeGuidance[articleType]}

只输出摘要正文本身（一段话、不超120字），不要任何前缀、标注或解释。`;

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
        temperature: 0.65,
        max_tokens: 220,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[summarize] DeepSeek 错误:', response.status, errorText);

      // 针对常见 HTTP 状态码返回更友好的中文提示
      const statusMessageMap = {
        400: 'DeepSeek 请求参数有误，请联系管理员检查后端配置',
        401: 'DeepSeek API Key 无效或已过期，请联系管理员更新密钥',
        402: 'DeepSeek 账户余额不足，请联系管理员充值后再试；此前可先手动填写摘要',
        403: 'DeepSeek 拒绝访问（可能触发风控），请稍后重试或联系管理员',
        404: 'DeepSeek 接口地址不存在，请联系管理员检查',
        429: 'DeepSeek 请求过于频繁，请 30 秒后再试',
        500: 'DeepSeek 服务端异常，请稍后重试',
        502: 'DeepSeek 服务暂时不可用，请稍后重试',
        503: 'DeepSeek 服务暂时不可用，请稍后重试',
        504: 'DeepSeek 响应超时，请稍后重试',
      };
      const friendly =
        statusMessageMap[response.status] ||
        `DeepSeek API 请求失败（HTTP ${response.status}），请稍后重试或手动填写摘要`;

      return res.status(response.status).json({
        error: friendly,
        deepseekStatus: response.status,
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

    // 长度硬约束：超过 130 字截断到最近的句号/分号
    if (reply.length > 130) {
      const cutPoint = reply.slice(0, 130).search(/[。！？；;][^。！？；;]*$/);
      if (cutPoint > 40) {
        reply = reply.slice(0, cutPoint + 1);
      } else {
        reply = reply.slice(0, 120).replace(/[，,、\s]+$/, '') + '。';
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
