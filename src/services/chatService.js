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
// 注意：纯情绪词（焦虑、迷茫、压力等）已由 EMOTION_PATTERNS 优先处理，不放在这里
const DOMAIN_KEYWORDS = [
  '保研', '推免', '考研', '考公', '留学', '出国', '申请',
  '求职', '就业', '实习', '工作', '面试', '简历', '招聘',
  '课程', '选课', '测评', '必修', '选修', '通识',
  '经验', '分享', '心得', '故事', '经历',
  '规划', '方向', '成长',
  '辩论', '活动', '招新', '征稿',
  '金融', '经济学', '科技', '互联网', '学术', '论文', '数模', '建模',
  '大一', '大二', '大三', '大四', '备考', '复习',
  '时间线', '准备', '策略', '建议', '技巧',
  '字节', '销售', '科技行业',
];

// 闲聊 / 寒暄的模式识别与回复
const CASUAL_PATTERNS = [
  // 打招呼
  { pattern: /^(hi|hello|hey|你好|嗨|哈喽|嘿|在吗|在不在)/i, reply: '嗨～在的在的！最近怎么样，有什么想聊的吗？😊' },
  { pattern: /^(早|早上好|早安|morning)/i, reply: '早上好呀～新的一天，加油鸭！☀️' },
  { pattern: /^(晚上好|晚安|good night|夜深了)/i, reply: '晚上好～忙了一天辛苦啦！早点休息哦 🌙' },
  { pattern: /^(下午好)/i, reply: '下午好呀～今天过得怎么样？' },
  // 感谢/告别
  { pattern: /(谢谢|感谢|thanks|thx|thank)/i, reply: '不客气！有事随时找我聊～ 😄' },
  { pattern: /^(拜拜|再见|byebye|bye|回见|下次见)/i, reply: '拜拜～下次再聊！👋' },
  // 自我介绍
  { pattern: /^(你是谁|你叫什么|介绍一下你自己)/i, reply: '我是小 R，你的 RIEMer Land 小伙伴～可以陪你聊天、帮你找文章和经验分享，也能聊聊大学里的各种事儿。你想了解什么？' },
  { pattern: /(怎么用|怎么使用|有什么功能)/i, reply: '你可以跟我随便聊天，也可以让我帮你找文章，比如说"保研经验"、"课程测评"、"求职分享"这些～也可以点下面的快捷指令试试！' },
];

// ========== 情绪 / 倾诉 / 日常闲聊识别（不搜索文章，直接回复）==========
const EMOTION_PATTERNS = [
  // 累 / 疲惫
  { pattern: /(好累|太累|累了|累死|疲惫|好困|困死|不想动|想躺|躺平|摆烂)/i, replies: [
    '辛苦了～累了就歇一会儿吧，别硬撑着 🫂',
    '抱抱～该休息就休息，身体最重要！今天辛苦了～',
    '累了就给自己放个小假吧，喝杯奶茶什么的犒劳一下自己 🧋',
    '我懂我懂，最近是不是事情特别多？累了就先缓缓，慢慢来～',
  ]},
  // 烦 / 郁闷
  { pattern: /(好烦|烦死|烦躁|郁闷|心烦|难受|不开心|不高兴|不爽|生气|气死)/i, replies: [
    '怎么啦？要不要说说看，聊出来会好一些的～',
    '摸摸头～有什么烦心事可以跟我说说，我虽然帮不了太多但可以陪你吐槽 😤',
    '深呼吸～不开心的事会过去的，要不要聊聊是什么让你烦躁？',
    '心情不好就来跟我吐槽吧！我是很好的情绪垃圾桶 🫠',
  ]},
  // 焦虑 / 压力
  { pattern: /(焦虑|压力好大|压力大|好有压力|紧张|担心|害怕|恐惧|焦|心慌)/i, replies: [
    '焦虑的时候深呼吸一下～你已经很努力了，别对自己太苛刻 💪',
    '压力大的时候就允许自己停一停吧，休息不是摆烂，是为了走更远的路～',
    '我理解那种感觉…要不要说说是什么让你焦虑？有时候说出来就好多了',
    '嗨，别太紧张～事情一件一件来，你比自己想象的要强大 🌟',
  ]},
  // 迷茫 / 困惑
  { pattern: /(好迷茫|迷茫|不知道该|不知道怎么办|不知道路|没有方向|找不到方向|不确定|很纠结|纠结)/i, replies: [
    '迷茫是正常的，说明你在思考，这本身就很好～有什么具体纠结的可以聊聊？',
    '其实大学里很多人都会有迷茫的阶段，包括我当时也是。慢慢来，不用急着有答案～',
    '迷茫的时候就多尝试、多探索，很多路都是走着走着才清晰的 🌿',
    '别太焦虑方向的问题啦～先做好眼前的事，慢慢就会找到感觉的',
  ]},
  // emo / 情绪低落
  { pattern: /(emo|好丧|丧了|想哭|哭了|难过|伤心|心情不好|情绪低落|自我怀疑|怀疑自己|好菜|感觉自己好差|不想学|学不进|学不下去|不想上课)/i, replies: [
    '抱抱你～每个人都会有低落的时候，这很正常的。今天就对自己温柔一点吧 🤗',
    '没关系的，允许自己偶尔不开心。想聊什么都可以跟我说～',
    '学不进去的时候就别硬学了，出去走走或者看个喜欢的视频放松一下吧 ☁️',
    '你已经很棒了！不要跟别人比，跟昨天的自己比就好 💗',
    '我当时也有过这种感觉…后来发现只是一个阶段，会过去的，相信我～',
  ]},
  // 无聊
  { pattern: /(无聊|好无聊|没事做|闲着|干啥|干什么|做什么|没意思)/i, replies: [
    '无聊的话来跟我聊天呀！我可有趣了（自封的）😎',
    '无聊的时候可以逛逛 RIEMer Land 看看学长学姐们的分享，说不定能找到新的灵感～',
    '那要不要来看看有什么有趣的经验分享？或者我们可以随便聊聊～',
    '哈哈无聊就对了，大学嘛，偶尔发发呆也挺好的 😌',
  ]},
  // 吐槽期末 / 考试
  { pattern: /(期末|考试|ddl|deadline|论文|作业|赶due|交作业|期中|写不完|来不及)/i, replies: [
    '期末战士加油！💪 你不是一个人在战斗，大家都在肝呢～',
    'ddl 是第一生产力嘛！冲一波，过了这阵子就好了 🔥',
    '深呼吸，一件一件来～先搞最紧急的那个，其他的慢慢来',
    '辛苦了！需要什么学习上的建议可以问我，虽然我可能也会让你失望哈哈',
  ]},
  // 开心 / 积极
  { pattern: /(开心|高兴|太好了|耶|好棒|真棒|厉害|nice|哈哈|嘿嘿|哈哈哈|嘻嘻|lol|笑死)/i, replies: [
    '哈哈开心就好！分享快乐，快乐加倍 🎉',
    '看到你开心我也开心！✨',
    '哈哈哈不错不错～今天心情很好嘛！',
    '耶！好心情要保持住哦～ 😆',
  ]},
  // 吃饭 / 美食
  { pattern: /(吃什么|吃饭|吃啥|饿了|好饿|食堂|外卖|奶茶|咖啡|火锅|烧烤)/i, replies: [
    '推荐你去试试学校附近的那些小店！你平时喜欢吃什么类型的？',
    '饿了就去吃呀！别亏待自己的胃 🍜',
    '吃饭选择困难症是吧？哈哈那就随机选一个，不好吃下次换一家～',
    '好问题！不过这个我确实帮不了太多，毕竟我是 AI，吃不了东西 😢 但我建议你点杯奶茶配着吃！',
  ]},
  // 天气
  { pattern: /(天气|下雨|太热|好冷|冷死|热死|出太阳|刮风)/i, replies: [
    '是呀～注意根据天气加减衣服哦！别感冒了 🌤️',
    '天气这种事我也没办法改变啦，不过待在室里也挺好的，正好可以学习或者放松～',
    '哈哈天气的事就随缘吧！重要的是心情好 ☀️',
  ]},
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
  { pattern: /(迷茫|焦虑|不知道|困惑|纠结|压力|不确定).*(怎么办|怎么选|怎么规划|该不该|如何|求助|求建议|求经验)/, keywords: ['规划', '方向', '成长', '经验'] },
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
  const trimmed = query.trim();

  // 1. 先检查是否为打招呼/寒暄
  for (const { pattern, reply } of CASUAL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { text: reply, articles: [] };
    }
  }

  // 2. 检查是否为情绪表达/闲聊（不搜索文章，直接回复）
  for (const { pattern, replies } of EMOTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      const reply = replies[Math.floor(Math.random() * replies.length)];
      return { text: reply, articles: [] };
    }
  }

  // 智能提取关键词
  const keywords = extractKeywords(query);

  // 如果完全无法提取关键词，给出友好回复
  if (keywords.length === 0) {
    return {
      text: '哈哈我没太听懂你在说啥～不过没关系，你可以直接跟我聊天，或者告诉我想了解什么方面的内容，比如保研、考研、求职、课程测评等，我帮你找找看！',
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
      text: '嗯…暂时没找到特别匹配的文章，不过你可以换个说法试试，比如直接说"保研"、"考研"、"课程测评"、"求职"等关键词，我来帮你搜～',
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
