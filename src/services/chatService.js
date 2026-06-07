// ============================================
// RIEMer Land — 文章助手 Chat Service
// ============================================
// 通过 Vercel Serverless Function (/api/chat) 调用 DeepSeek API
// API Key 安全存储在 Vercel 环境变量中，不暴露给前端
// 如果后端不可用，自动 fallback 到本地关键词匹配

import { articlesData } from '../data/siteData';

// 合并"用户上传的最新文章" + 静态内置文章，按 id 去重（用户文章优先）。
// 这样助手读取的是当前实际已上传的文章，而不是历史缓存。
function mergeArticles(userArticles) {
  const seen = new Set();
  const all = [];
  [...(userArticles || []), ...articlesData].forEach((a) => {
    if (!a || a.id == null || seen.has(a.id)) return;
    seen.add(a.id);
    all.push(a);
  });
  return all;
}

// 构建文章摘要上下文（发送给后端供大模型使用）。
// 用顺序编号 #n 作为引用标记（不依赖文章 id 的格式，兼容 user-xxx 这类非数字 id）。
function buildArticlesContext(all) {
  return all
    .map(
      (a, i) =>
        `#${i + 1} 标题：${a.title} | 分类：${a.category || ''} | 标签：${(a.tags || []).join('、')} | 摘要：${a.excerpt || ''}`
    )
    .join('\n');
}

// ========== 通过后端 Serverless Function 调用 DeepSeek ==========
async function callLLMApi(messages, articlesContext) {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        articlesContext,
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
  // 想聊天 / 陪我聊
  { pattern: /(陪我聊|陪聊|聊聊天|聊聊|随便聊|想聊|找人聊|找个人说|陪我说|陪我一会)/i, replies: [
    '好呀～最近过得咋样？有啥想说的我都愿意听 🌿',
    '那就聊呀！最近在忙啥呢？有没有什么有趣的事？',
    '哈哈当然可以～最近心情怎么样？有啥开心或者不开心的都可以说说',
    '我在呀～说说最近吧，学习、生活、心情都行',
    '嘿嘿好呀，你最近咋样？有啥想吐槽的或者开心的吗？',
  ]},
  // 累 / 疲惫
  { pattern: /(好累|太累|累了|累死|疲惫|好困|困死|不想动|想躺|躺平|摆烂|有点累|有些累)/i, replies: [
    '辛苦了～累了就歇一会儿吧，别硬撑着 🫂 发生啥了？',
    '抱抱～该休息就休息，身体最重要！怎么突然这么累？',
    '累了就给自己放个小假吧，喝杯奶茶什么的犒劳一下自己 🧋',
    '我懂我懂，最近是不是事情特别多？可以跟我说说～',
    '那就先别学了，今天先放过自己吧～最近在忙啥呢？',
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
    '焦虑的时候深呼吸一下～你已经很努力了，别对自己太苛刻 💪 什么事让你这么紧张？',
    '压力大的时候就允许自己停一停吧，休息不是摆烂，是为了走更远的路～',
    '我理解那种感觉…要不要说说是什么让你焦虑？有时候说出来就好多了',
    '嗨，别太紧张～事情一件一件来，你比自己想象的要强大 🌟',
  ]},
  // 迷茫 / 困惑
  { pattern: /(好迷茫|迷茫|不知道该|不知道怎么办|不知道路|没有方向|找不到方向|不确定|很纠结|纠结)/i, replies: [
    '迷茫是正常的，说明你在思考，这本身就很好～有什么具体纠结的可以聊聊？',
    '其实大学里很多人都会有迷茫的阶段，包括我当时也是。慢慢来，不用急着有答案～',
    '迷茫的时候就多尝试、多探索，很多路都是走着走着才清晰的 🌿',
    '别太焦虑方向的问题啦～先做好眼前的事，慢慢就会找到感觉的。具体是哪方面纠结？',
  ]},
  // emo / 情绪低落
  { pattern: /(emo|好丧|丧了|想哭|哭了|难过|伤心|心情不好|情绪低落|自我怀疑|怀疑自己|好菜|感觉自己好差|不想学|学不进|学不下去|不想上课)/i, replies: [
    '抱抱你～每个人都会有低落的时候，这很正常的。今天就对自己温柔一点吧 🤗 发生什么事了？',
    '没关系的，允许自己偶尔不开心。想聊什么都可以跟我说～',
    '学不进去的时候就别硬学了，出去走走或者看个喜欢的视频放松一下吧 ☁️',
    '你已经很棒了！不要跟别人比，跟昨天的自己比就好 💗',
    '我当时也有过这种感觉…后来发现只是一个阶段，会过去的，相信我～',
  ]},
  // 无聊
  { pattern: /(无聊|好无聊|没事做|闲着|干啥|干什么|做什么|没意思)/i, replies: [
    '无聊的话来跟我聊天呀！我可有趣了（自封的）😎 最近有啥新鲜事吗？',
    '哈哈无聊就对了，大学嘛，偶尔发发呆也挺好的 😌',
    '那就随便聊聊呗～最近追剧了吗？看啥好看的？',
    '无聊的时候最适合八卦了，说说最近身边发生的事～',
  ]},
  // 吐槽期末 / 考试
  { pattern: /(期末|考试|ddl|deadline|论文|作业|赶due|交作业|期中|写不完|来不及)/i, replies: [
    '期末战士加油！💪 你不是一个人在战斗，大家都在肝呢～',
    'ddl 是第一生产力嘛！冲一波，过了这阵子就好了 🔥',
    '深呼吸，一件一件来～先搞最紧急的那个，其他的慢慢来',
    '辛苦了！哪门课最折磨？',
  ]},
  // 开心 / 积极
  { pattern: /(开心|高兴|太好了|耶|好棒|真棒|厉害|nice|哈哈|嘿嘿|哈哈哈|嘻嘻|lol|笑死)/i, replies: [
    '哈哈开心就好！分享快乐，快乐加倍 🎉 啥事这么开心？',
    '看到你开心我也开心！✨',
    '哈哈哈不错不错～今天心情很好嘛！说说发生啥好事了',
    '耶！好心情要保持住哦～ 😆',
  ]},
  // 吃饭 / 美食
  { pattern: /(吃什么|吃饭|吃啥|饿了|好饿|食堂|外卖|奶茶|咖啡|火锅|烧烤)/i, replies: [
    '推荐你去试试学校附近的那些小店！你平时喜欢吃什么类型的？',
    '饿了就去吃呀！别亏待自己的胃 🍜 想吃啥？',
    '吃饭选择困难症是吧？哈哈那就随机选一个，不好吃下次换一家～',
    '好问题！不过这个我确实帮不了太多，毕竟我是 AI，吃不了东西 😢 但我建议你点杯奶茶配着吃！',
  ]},
  // 天气
  { pattern: /(天气|下雨|太热|好冷|冷死|热死|出太阳|刮风)/i, replies: [
    '是呀～注意根据天气加减衣服哦！别感冒了 🌤️',
    '天气这种事我也没办法改变啦，不过待在室里也挺好的，正好可以学习或者放松～',
    '哈哈天气的事就随缘吧！重要的是心情好 ☀️',
  ]},
  // 简短回应 / 语气词（"嗯""哦""好的""知道了"）——表示用户在继续对话，但没具体话题
  { pattern: /^(嗯+|哦+|噢+|好的|好吧|知道了|ok|okay|行|可以|是啊|是的|对啊|对|嗯嗯|哦哦)$/i, replies: [
    '嗯嗯～还有啥想聊的吗？',
    '哈哈还在吗？有啥新鲜事可以说说～',
    '嘿嘿，要不要聊点别的？最近忙啥呢？',
    '那～今天过得咋样？',
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
// 泛用闲聊兜底回复池——DeepSeek 挂了、又没匹配到任何 pattern 时使用，
// 保证对话能延续，不出现"没找到文章，请换关键词"这种僵硬话术。
const GENERIC_CHAT_REPLIES = [
  '嗯嗯～可以多说点吗？我想再多听听你的想法',
  '哈哈好的～那你最近在忙啥呢？',
  '听到啦～要不你再展开讲讲？',
  '好呀～今天过得怎么样？',
  '嗯我在听，继续说～',
  '哦？那具体是怎么回事呀？',
  '嘿嘿，感觉你今天想聊天，那就聊呀～最近心情怎么样？',
  '好～想聊啥都可以，学习、生活、心情都行',
];

// 判断一个查询是否"明显在找文章"——只有明显意图时才走文章搜索路径，
// 否则走自然闲聊，避免 fallback 出现"没找到文章"这类话术。
function isLookingForArticles(query) {
  const q = query.toLowerCase();
  // 明确的"找文章/经验/分享"信号词
  const articleIntentSignals = [
    '文章', '经验', '分享', '攻略', '测评', '推荐', '分享吗', '经验吗',
    '有没有', '找找', '搜搜', '看看有没有', '哪篇', '哪一篇',
  ];
  return articleIntentSignals.some((s) => q.includes(s));
}

function localSearch(query, articles = articlesData) {
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

  // 3. 如果用户明显不是在找文章（比如单句闲聊、陈述、随口一句），
  //    直接给一个自然闲聊回复，而不是去搜关键词然后说"没找到"。
  const looksLikeArticleSearch = isLookingForArticles(trimmed);
  if (!looksLikeArticleSearch) {
    const reply = GENERIC_CHAT_REPLIES[Math.floor(Math.random() * GENERIC_CHAT_REPLIES.length)];
    return { text: reply, articles: [] };
  }

  // 智能提取关键词
  const keywords = extractKeywords(query);

  // 如果完全无法提取关键词，给出一个友好的闲聊式回复（不催用户换关键词）
  if (keywords.length === 0) {
    const reply = GENERIC_CHAT_REPLIES[Math.floor(Math.random() * GENERIC_CHAT_REPLIES.length)];
    return { text: reply, articles: [] };
  }

  const scored = articles.map((article) => {
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
    // 用户明确在找，但文章库没有 —— 用学长学姐口吻聊聊，而不是催换关键词
    const noMatchReplies = [
      '这方面暂时没翻到特别合适的分享诶… 你想了解哪块，我凭经验跟你聊聊？',
      '嗯… 这个话题目前分享得还不多，不过你要是想聊聊具体在纠结啥，我可以说说我的看法',
      '暂时没找到特别对口的文章，不过这个问题我挺有想法的，要不咱们直接聊？',
    ];
    return {
      text: noMatchReplies[Math.floor(Math.random() * noMatchReplies.length)],
      articles: [],
    };
  }

  // 根据匹配数量和关键词生成更自然的引导语。
  // 注意：不再把每篇文章的标题/摘要在文字里铺开（避免对文章内容的复述与评论），
  // 文章统一以下方可点击的卡片/链接形式呈现，用户点开链接自己看。
  const topicHint = keywords.slice(0, 2).join('、');
  const introText = matches.length === 1
    ? `找到 1 篇和"${topicHint}"相关的，点开看看吧 👇`
    : `帮你找到 ${matches.length} 篇和"${topicHint}"相关的，点开看看吧 👇`;

  return {
    text: introText,
    articles: matches.map((m) => m.article),
  };
}

// ========== 主入口 ==========
// userArticles：来自 SiteContent 的实时上传文章列表，确保助手读取最新内容。
export async function sendMessage(messages, userArticles = []) {
  // 尝试调用大模型 API
  const userMessages = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const allArticles = mergeArticles(userArticles);
  const llmReply = await callLLMApi(userMessages, buildArticlesContext(allArticles));

  if (llmReply) {
    // 回复里用 #n 引用文章 → 映射回真实文章，渲染成可点击卡片
    const idMatches = [...llmReply.matchAll(/#(\d+)/g)];
    const mentionedArticles = [];
    const seen = new Set();
    idMatches.forEach((m) => {
      const idx = parseInt(m[1], 10) - 1;
      const art = allArticles[idx];
      if (art && !seen.has(art.id)) {
        seen.add(art.id);
        mentionedArticles.push(art);
      }
    });

    // 文本里去掉裸露的 #n 编号，避免出现"只看到编号"的观感；卡片在下方单独渲染
    const cleanText = llmReply.replace(/\s*#\d+/g, '').replace(/[ \t]+\n/g, '\n').trim();

    return {
      text: cleanText,
      articles: mentionedArticles,
    };
  }

  // fallback: 智能本地搜索（支持自然对话 + 关键词提取）
  const lastUserMessage = messages[messages.length - 1]?.content || '';
  return localSearch(lastUserMessage, allArticles);
}
