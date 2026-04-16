// ============================================
// RIEMer Land — Site Data
// ============================================

export const clubInfo = {
  name: 'RIEMer Land',
  fullName: 'RIEMer Land',
  slogan: '在交流中成长，一起找到更好的自己',
  description:
    'RIEMer Land 是由西南财经大学经济与管理研究院（RIEM）学生自主发起的互助平台，旨在促进 RIEM 校友和在校学子的经验交流与共享。在这里，你将获得 RIEMers 真实多元的心得，在朋辈的生动分享中看到属于自己的那一份可能性。',
  mission: [
    '促进 RIEM 校友与在校学子的经验交流',
    '提供真实多元的学习与职业发展心得',
    '搭建朋辈互助与信息共享平台',
    '帮助每一位 RIEMer 找到属于自己的可能性',
  ],
  stats: [
    { label: '活动讲座', value: '10+' },
    { label: '文章分享', value: '30+' },
    { label: '公众号累计阅读', value: '20000+' },
    { label: '成立时间', value: '2024' },
  ],
  contact: {
    email: 'riemerland@swufe.edu.cn',
    location: '西南财经大学 经济与管理研究院',
  },
};

export const timelineData = [
  {
    year: '2024',
    month: '9',
    title: '平台创立',
    description:
      'RIEMer Land 由西南财经大学 RIEM 学生自主发起，致力于搭建校友与在校学子的经验互助平台。',
    highlight: true,
  },
  {
    year: '2025',
    month: '1',
    title: '「听 RIEMer 说」系列上线',
    description:
      '推出「听 RIEMer 说」访谈系列，邀请 RIEM 校友分享就业、考研、留学等多元经验。',
    highlight: true,
  },
  {
    year: '2025',
    month: '3',
    title: 'RIEMer\'s Space 分享会启动',
    description: '举办线上线下分享会，覆盖数模备赛、快消行业、职业选择等实用主题。',
  },
  {
    year: '2025',
    month: '5',
    title: '课程测评与专业方向指南发布',
    description: '发布 RIEM 专业方向课测评和大一下专业必修与方向课测评，帮助学弟学妹选课参考。',
    highlight: true,
  },
  {
    year: '2025',
    month: '6',
    title: '保研经验专题',
    description: '推出保研论文答疑解惑系列，解答同学们最关心的八大问题。',
  },
  {
    year: '2025',
    month: '8',
    title: '辩论赛经验分享',
    description: '发布「爱情之美的时间尺度」辩论表演赛经验分享，RIEM 与法学院联合呈现。',
  },
  {
    year: '2025',
    month: '10',
    title: '主理团队招新',
    description: 'RIEMer Land 主理团队面向全院招新，壮大平台运营力量。',
    highlight: true,
  },
];

export const membersData = [
  {
    id: '1',
    name: '陈思雨',
    role: '主理人',
    avatar: null,
    bio: '2022 级经济学，RIEMer Land 发起人，负责平台整体运营与内容方向把控。',
  },
  {
    id: '2',
    name: '林子墨',
    role: '内容策划',
    avatar: null,
    bio: '2022 级管理科学，主导「听 RIEMer 说」系列访谈策划与文稿编审。',
  },
  {
    id: '3',
    name: '周悦然',
    role: '访谈采编',
    avatar: null,
    bio: '2023 级金融学，负责访谈对象联络、采访执行与音视频剪辑。',
  },
  {
    id: '4',
    name: '张一帆',
    role: '活动组织',
    avatar: null,
    bio: '2023 级应用经济学，负责线上线下分享会的策划与执行落地。',
  },
  {
    id: '5',
    name: '李明远',
    role: '运营推广',
    avatar: null,
    bio: '2023 级数据科学，负责公众号运营、数据分析与用户增长策略。',
  },
  {
    id: '6',
    name: '王诗涵',
    role: '视觉设计',
    avatar: null,
    bio: '2024 级经济学，负责品牌视觉、海报设计与网站 UI 优化。',
  },
];

export const eventsData = [
  {
    id: '6',
    title: 'RIEMer\'s Space 第十二期：大数据与金融科技前沿分享',
    date: '2026-04-18',
    category: '分享会',
    location: '西南财经大学 格致楼 305',
    leaderId: 'member-4',
    excerpt:
      '邀请在金融科技领域深耕的 RIEM 校友，聊聊大数据、AI 在金融行业的真实应用场景，以及如何提前布局相关技能。',
    hasReplay: false,
    replayUrl: '',
    replayPassword: '',
  },
  {
    id: '5',
    title: '2026 春季学期保研&考研经验交流会',
    date: '2026-05-10',
    category: '分享会',
    location: '西南财经大学 格致楼 201',
    leaderId: 'member-1',
    excerpt:
      '邀请多位成功保研、考研上岸的 RIEM 学长学姐，分享从择校到复试的全流程经验，助力 2027 届同学备战升学。',
    hasReplay: false,
    replayUrl: '',
    replayPassword: '',
  },
  {
    id: '1',
    title: '快消行业与职业选择经验分享',
    date: '2025-03-06',
    category: '分享会',
    location: '线上',
    leaderId: 'member-4',
    excerpt:
      '第十期分享会聚焦快消行业，邀请学长学姐分享求职经验与职业选择心得，帮助同学们了解行业全貌。',
    hasReplay: true,
    replayUrl: 'https://meeting.tencent.com/dm/replay-demo-001',
    replayPassword: 'riem2025',
  },
  {
    id: '2',
    title: '数模备赛经验分享',
    date: '2025-08-12',
    category: '分享会',
    location: '线上',
    leaderId: 'member-4',
    excerpt:
      '第九期分享会邀请数学建模竞赛获奖选手，从选题、建模到论文撰写全流程分享备赛经验。',
    hasReplay: true,
    replayUrl: 'https://meeting.tencent.com/dm/replay-demo-002',
    replayPassword: 'math2025',
  },
  {
    id: '3',
    title: '关于保研论文的答疑解惑',
    date: '2025-03-02',
    category: '经验分享',
    location: '线上',
    leaderId: 'member-2',
    excerpt:
      '你关心的八个问题都在这里！针对保研论文的常见疑问，为大家一一解答。',
    hasReplay: false,
    replayUrl: '',
    replayPassword: '',
  },
  {
    id: '4',
    title: 'RIEMer Land 主理团队招新',
    date: '2025-07-28',
    category: '团队招新',
    location: '西南财经大学',
    leaderId: 'member-1',
    excerpt:
      'RIEMer Land 主理团队面向全院同学招新，期待更多热爱分享、乐于助人的 RIEMers 加入。',
    hasReplay: false,
    replayUrl: '',
    replayPassword: '',
  },
];

// 封面图（校园实拍照片，循环使用）
const COVER_PHOTOS = [
  '/covers/IMG_4864.JPG',  // 水中倒影
  '/covers/IMG_4865.JPG',  // 钟楼近景
  '/covers/IMG_4868.JPG',  // 钟楼远景
  '/covers/IMG_4867.JPG',  // 钟楼与花
];
const COVER_PLACEHOLDERS = Array.from({ length: 16 }, (_, i) => COVER_PHOTOS[i % COVER_PHOTOS.length]);

// 示例头像（ui-avatars 生成字母头像，未来替换为真实头像）
function avatarUrl(name) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=5B8C3E&color=fff&size=80&font-size=0.4&rounded=true`;
}

export const articlesData = [
  {
    id: '1',
    title: '字节 ToB 销售学姐专访',
    author: 'RIEMer Land',
    avatar: avatarUrl('RL'),
    coverImage: COVER_PLACEHOLDERS[0],
    leaderId: 'member-3',
    date: '2025-03-09',
    category: '听 RIEMer 说系列',
    tags: ['求职', '互联网', '经验分享'],
    excerpt:
      '对话字节跳动 ToB 销售岗学姐，了解从校园到职场的真实经历，为有志于互联网行业的同学提供参考。',
    content: `本期「听 RIEMer 说」邀请到在字节跳动从事 ToB 销售工作的 RIEM 校友，分享从求职到入职的心路历程。

## 求职准备

学姐回顾了自己的求职时间线，从简历准备到笔试面试各环节的注意事项，给出了实用建议。

## 岗位日常

ToB 销售岗位的日常工作内容、团队协作模式，以及互联网公司的工作节奏。

## 给学弟学妹的话

不要给自己设限，勇敢尝试不同的可能性。`,
  },
  {
    id: '2',
    title: '丁成：科技行业经济学就业分享',
    author: 'RIEMer Land',
    avatar: avatarUrl('丁成'),
    coverImage: COVER_PLACEHOLDERS[1],
    leaderId: 'member-3',
    date: '2025-08-30',
    category: '听 RIEMer 说系列',
    tags: ['科技行业', '经济学', '就业'],
    excerpt:
      '丁成学长分享经济学背景在科技行业的就业路径与发展前景，为经济学专业同学提供职业规划新思路。',
    content: `本期邀请到在科技行业工作的 RIEM 校友丁成，聊聊经济学专业的另一种可能。

## 为什么选择科技行业

经济学的分析框架和量化思维在科技行业同样大有用武之地。

## 求职路径

从实习到全职的完整经历，包括如何准备行业知识、技术面试等。

## 职业发展

在科技行业中，经济学背景的独特优势与未来成长空间。`,
  },
  {
    id: '3',
    title: 'W 同学：经济学考研经验分享',
    author: 'RIEMer Land',
    avatar: avatarUrl('W'),
    coverImage: COVER_PLACEHOLDERS[2],
    leaderId: 'member-2',
    date: '2025-08-19',
    category: '听 RIEMer 说系列',
    tags: ['考研', '经济学', '经验分享'],
    excerpt:
      'W 同学详细回顾经济学考研备考全过程，从择校到各科复习方法，为准备考研的同学提供全方位指导。',
    content: `考研是许多 RIEM 学子的重要选择之一。本期分享来自 W 同学的考研经验。

## 择校与目标设定

如何根据自身情况合理选择目标院校和专业方向。

## 各科复习策略

数学、政治、英语和专业课的时间分配与复习方法。

## 心态调整

备考过程中的压力管理与心态保持，坚持到最后就是胜利。`,
  },
  {
    id: '4',
    title: '爱情之美的时间尺度｜辩论表演赛 · 经济与管理研究院 & 法学院',
    author: 'RIEMer Land',
    avatar: avatarUrl('RL'),
    coverImage: COVER_PLACEHOLDERS[3],
    leaderId: 'member-4',
    date: '2025-09-17',
    category: '校园活动',
    tags: ['辩论赛', '跨院合作', '校园活动'],
    excerpt:
      'RIEM 与法学院联合举办辩论表演赛，围绕"爱情之美的时间尺度"展开精彩交锋，展现跨学科碰撞的魅力。',
    content: `一场关于爱情与时间的思辨之旅，RIEM 与法学院的精彩碰撞。

## 赛事背景

本次辩论表演赛由经济与管理研究院和法学院联合举办，旨在促进跨院交流。

## 精彩观点

正反方围绕爱情之美究竟在于瞬间的绚烂还是长久的陪伴展开激辩。

## 赛后感想

辩论不仅是观点的碰撞，更是思维方式的交流与成长。`,
  },
  {
    id: '5',
    title: 'RIEM 专业方向课测评',
    author: 'RIEMer Land',
    avatar: avatarUrl('RL'),
    coverImage: COVER_PLACEHOLDERS[4],
    leaderId: 'member-2',
    date: '2025-12-28',
    category: '课程测评',
    tags: ['选课指南', '课程测评', 'RIEM'],
    excerpt:
      '汇集多位学长学姐的真实选课体验，对 RIEM 各专业方向课程进行详细测评，为你的选课提供参考。',
    content: `选课季又到了，这份来自学长学姐的课程测评希望能帮到你。

## 测评维度

从课程内容、考核方式、老师风格、课程难度等多个维度进行评价。

## 热门方向

金融学、应用经济学、管理科学等热门方向课的详细介绍。

## 选课建议

结合自身兴趣和未来规划，合理搭配必修与选修课程。`,
  },
  {
    id: '6',
    title: 'RIEMer 课程测评｜RIEM 大一下专业必修与方向课测评',
    author: 'RIEMer Land',
    avatar: avatarUrl('RL'),
    coverImage: COVER_PLACEHOLDERS[5],
    leaderId: 'member-2',
    date: '2025-12-28',
    category: '课程测评',
    tags: ['选课指南', '课程测评', '大一'],
    excerpt:
      '专为大一同学准备的下学期课程测评，覆盖专业必修和方向选修，助你提前了解课程全貌。',
    content: `大一下的课程选择至关重要，这份测评来自亲身经历的学长学姐。

## 专业必修课

微观经济学、宏观经济学、统计学等核心课程的学习体验和备考建议。

## 方向选修课

各方向入门课程的特点与适合人群。

## 学习建议

大一下是打好专业基础的关键时期，合理安排时间，兼顾学业与个人发展。`,
  },
  {
    id: '7',
    title: '陈蕴甜：老油条的保研秘笈',
    author: 'RIEMer Land',
    avatar: avatarUrl('陈蕴甜'),
    coverImage: COVER_PLACEHOLDERS[6],
    leaderId: 'member-3',
    date: '2025-12-05',
    category: '听 RIEMer 说系列',
    tags: ['保研', '经验分享', '学术'],
    excerpt:
      '陈蕴甜学姐以"老油条"的自谦视角，分享保研路上的实战经验与独家秘笈，从信息收集到材料准备，干货满满。',
    content: `本期「听 RIEMer 说」邀请到成功保研的陈蕴甜学姐，用轻松幽默的方式聊聊她的"保研秘笈"。

## 保研准备时间线

从大一到大三的关键节点，如何提前规划、步步为营。

## 材料准备技巧

个人陈述、推荐信、科研经历等材料的撰写要点与常见误区。

## 面试应对策略

各类面试形式的准备方法与临场发挥技巧。

## 给学弟学妹的话

保研是一场信息战，早准备、多交流、不放弃。`,
  },
  {
    id: '8',
    title: '梁晶晶：一尺阳光云雾散，半山鹧鸪半山青',
    author: 'RIEMer Land',
    avatar: avatarUrl('梁晶晶'),
    coverImage: COVER_PLACEHOLDERS[7],
    leaderId: 'member-3',
    date: '2025-12-02',
    category: '听 RIEMer 说系列',
    tags: ['保研', '心路历程', '经验分享'],
    excerpt:
      '梁晶晶学姐以诗意的笔触回顾保研之路，分享在迷茫与坚持中找到方向的心路历程，温暖而有力量。',
    content: `"一尺阳光云雾散，半山鹧鸪半山青"——本期分享来自梁晶晶学姐的保研故事。

## 选择的迷茫

在多条路径之间犹豫不决时，如何倾听内心的声音。

## 备战的日子

那些熬夜改论文、反复准备面试的日子，虽然辛苦却也充实。

## 云雾散后

当收到录取通知的那一刻，所有努力都有了最好的注脚。

## 想说的话

每个人都有属于自己的时区，不必焦虑，坚定前行。`,
  },
  {
    id: '9',
    title: '课程测评分享征稿',
    author: 'RIEMer Land',
    avatar: avatarUrl('RL'),
    coverImage: COVER_PLACEHOLDERS[8],
    leaderId: 'member-5',
    date: '2025-11-26',
    category: '课程测评',
    tags: ['征稿', '课程测评', '参与'],
    excerpt:
      'RIEMer Land 面向全院同学征集课程测评稿件，分享你的真实选课体验，帮助更多同学做出明智选择。',
    content: `RIEMer Land 课程测评板块面向全院同学公开征稿！

## 征稿范围

RIEM 开设的所有专业必修课、方向选修课、通识课程均可投稿。

## 稿件要求

真实的选课体验、客观的课程评价，包括课程内容、考核方式、老师授课风格等。

## 投稿方式

通过问卷链接或直接联系主理团队提交你的测评。

## 你的一份分享

可能帮助到无数纠结选课的学弟学妹，期待你的参与！`,
  },
  {
    id: '10',
    title: '周越：You are very much ON TIME in your TIME ZONE',
    author: 'RIEMer Land',
    avatar: avatarUrl('周越'),
    coverImage: COVER_PLACEHOLDERS[9],
    leaderId: 'member-2',
    date: '2025-11-24',
    category: '听 RIEMer 说系列',
    tags: ['成长', '心态', '经验分享'],
    excerpt:
      '周越用一句"You are very much ON TIME in your TIME ZONE"鼓励每一位 RIEMer：不必与他人比较，在自己的时区里你刚刚好。',
    content: `本期「听 RIEMer 说」邀请到周越同学，聊聊关于节奏、比较与自我成长的话题。

## 关于焦虑

身边的人保研、出国、工作，似乎每个人都在快速前进，而你好像原地踏步？

## 找到自己的节奏

每个人的起点、路径和目标都不同，横向比较毫无意义。

## ON TIME in your TIME ZONE

你不需要和任何人赛跑，在属于自己的时区里，你每一步都踩在了正确的时间点上。

## 给同路人

放下焦虑，专注当下，你会发现自己一直在成长。`,
  },
  {
    id: '11',
    title: '李苇行：申请经历分享——我最真实的故事',
    author: 'RIEMer Land',
    avatar: avatarUrl('李苇行'),
    coverImage: COVER_PLACEHOLDERS[10],
    leaderId: 'member-3',
    date: '2025-11-20',
    category: '听 RIEMer 说系列',
    tags: ['申请', '留学', '经验分享'],
    excerpt:
      '李苇行用最真实的笔触记录申请过程中的起伏与感悟，一个关于勇气、坚持和选择的真实故事。',
    content: `本期「听 RIEMer 说」是李苇行同学的申请经历分享——没有修饰，只有最真实的故事。

## 申请的起点

为什么选择这条路？最初的想法和后来的变化。

## 过程中的低谷

被拒、自我怀疑、方向摇摆……这些都是真实发生的事。

## 转折与收获

在最困难的时候，是什么让自己坚持了下来。

## 最真实的建议

不要美化过程，申请之路没有捷径，但每一步都算数。`,
  },
  {
    id: '12',
    title: '李正阳：中国人民大学财政金融学院金融直博保研分享',
    author: 'RIEMer Land',
    avatar: avatarUrl('李正阳'),
    coverImage: COVER_PLACEHOLDERS[11],
    leaderId: 'member-2',
    date: '2025-11-16',
    category: '听 RIEMer 说系列',
    tags: ['保研', '直博', '金融'],
    excerpt:
      '李正阳学长分享从西财 RIEM 到人大财金学院金融直博的保研经历，为有志于学术深造的同学提供宝贵参考。',
    content: `本期「听 RIEMer 说」邀请到成功保研中国人民大学财政金融学院金融直博项目的李正阳学长。

## 为什么选择直博

学术志趣的萌发与对金融研究的热爱，让他坚定了直博的决心。

## 科研准备

本科阶段的科研经历积累，包括论文写作、课题参与和学术交流。

## 保研面试

人大财金学院面试的流程与重点，以及应对技巧。

## 学术之路的思考

做学术需要耐心和热爱，选择直博意味着选择了一种生活方式。`,
  },
  {
    id: '13',
    title: '林飞扬：从西财到南开——我的保研旅程与成长记录',
    author: 'RIEMer Land',
    avatar: avatarUrl('林飞扬'),
    coverImage: COVER_PLACEHOLDERS[12],
    leaderId: 'member-3',
    date: '2025-11-06',
    category: '听 RIEMer 说系列',
    tags: ['保研', '南开大学', '成长'],
    excerpt:
      '林飞扬学长记录从西财到南开大学的保研全过程，分享在这段旅程中的成长与蜕变，为学弟学妹点亮前路。',
    content: `从西南财经大学到南开大学，林飞扬学长的保研旅程是一段关于成长的故事。

## 保研动机

对经济学研究的热忱和对南开学术氛围的向往。

## 准备过程

绩点维护、科研经历积累、夏令营和预推免的时间规划。

## 关键节点

夏令营面试经历、与导师的沟通、最终的选择与决定。

## 成长感悟

保研不只是一个结果，更是认识自己、突破自己的过程。回望来路，每一段经历都不会浪费。`,
  },
  {
    id: '14',
    title: '李沛欣：保研经验分享——经济学学术方向',
    author: 'RIEMer Land',
    avatar: avatarUrl('李沛欣'),
    coverImage: COVER_PLACEHOLDERS[13],
    leaderId: 'member-2',
    date: '2025-10-18',
    category: '听 RIEMer 说系列',
    tags: ['保研', '经济学', '学术'],
    excerpt:
      '李沛欣学姐聚焦经济学学术方向，详细分享保研备战的策略与心得，为走学术路线的同学提供系统性指导。',
    content: `本期「听 RIEMer 说」邀请到保研经济学学术方向的李沛欣学姐，分享她的备战经验。

## 方向选择

为什么选择经济学学术方向？兴趣与职业规划的考量。

## 学术积累

本科阶段如何进行有效的学术积累：论文阅读、课题参与、学术竞赛。

## 院校选择与信息收集

如何筛选目标院校、获取招生信息、联系潜在导师。

## 面试准备

经济学学术方向面试的常见问题与准备策略，从专业知识到研究计划。`,
  },
  {
    id: '15',
    title: '牟馨怡：经管跨保人工智能——跨保思路及经验分享',
    author: 'RIEMer Land',
    avatar: avatarUrl('牟馨怡'),
    coverImage: COVER_PLACEHOLDERS[14],
    leaderId: 'member-3',
    date: '2025-10-12',
    category: '听 RIEMer 说系列',
    tags: ['跨专业保研', '人工智能', '经验分享'],
    excerpt:
      '牟馨怡学姐分享从经管跨保人工智能的大胆尝试，从跨保思路到具体准备，为想要跨专业的同学打开新视野。',
    content: `经管跨保人工智能？听起来不可思议，但牟馨怡学姐做到了！本期来听听她的故事。

## 跨保的勇气

从经管到人工智能，这个决定背后的思考和动力。

## 知识储备

如何在经管专业的基础上，补充计算机和 AI 相关的知识。

## 跨保策略

目标院校的选择、申请材料的准备、如何向导师展示跨学科的优势。

## 面试经历

跨专业面试的挑战与应对，以及面试官最关心的问题。

## 给想跨保的同学

勇敢迈出第一步，跨学科的背景反而可能成为你独特的竞争力。`,
  },
  {
    id: '16',
    title: '陈忠怡：人大应经硕博直通项目保研分享',
    author: 'RIEMer Land',
    avatar: avatarUrl('陈忠怡'),
    coverImage: COVER_PLACEHOLDERS[15],
    leaderId: 'member-2',
    date: '2025-09-30',
    category: '听 RIEMer 说系列',
    tags: ['保研', '硕博直通', '人大'],
    excerpt:
      '陈忠怡学姐分享保研至中国人民大学应用经济学硕博直通项目的完整经历，为有志于深度学术研究的同学提供详尽参考。',
    content: `本期「听 RIEMer 说」邀请到成功保研人大应用经济学硕博直通项目的陈忠怡学姐。

## 项目介绍

人大应经硕博直通项目的特点、培养模式和招生要求。

## 申请准备

从绩点、科研到竞赛，全方位的申请材料准备经验。

## 夏令营与面试

参加夏令营的经历、笔试面试的具体内容和准备建议。

## 为什么选择硕博直通

对学术的热爱与对未来的规划，硕博直通是一条需要决心的路。

## 对学弟学妹的寄语

明确目标，脚踏实地，学术之路虽远，但每一步都值得。`,
  },
];

export const documentsData = [
  {
    id: '1',
    title: '2025 年度运营计划',
    type: 'process',
    fileType: 'pdf',
    fileUrl: null,
    uploadedBy: 'Admin',
    date: '2025-01-10',
    description: '2025 年度 RIEMer Land 内容规划与活动安排。',
    size: '1.5 MB',
    viewCount: 12,
    likes: [
      { userId: 'member-1', userName: '陈思雨' },
      { userId: 'member-2', userName: '林子墨' },
    ],
  },
  {
    id: '2',
    title: '「听 RIEMer 说」访谈指南',
    type: 'process',
    fileType: 'pdf',
    fileUrl: null,
    uploadedBy: 'Admin',
    date: '2025-02-01',
    description: '访谈系列的策划流程、采访提纲模板和发布规范。',
    size: '800 KB',
    viewCount: 24,
    likes: [
      { userId: 'member-3', userName: '周悦然' },
    ],
  },
  {
    id: '3',
    title: 'RIEMer\'s Space 分享会 SOP',
    type: 'process',
    fileType: 'pdf',
    fileUrl: null,
    uploadedBy: 'Admin',
    date: '2025-03-01',
    description: '分享会从策划到执行的标准操作流程。',
    size: '1.1 MB',
    viewCount: 18,
    likes: [],
  },
  {
    id: '4',
    title: '课程测评收集模板',
    type: 'course',
    fileType: 'docx',
    fileUrl: null,
    uploadedBy: 'Admin',
    date: '2025-06-15',
    description: '面向全院同学征集课程测评的问卷模板与整理规范。',
    size: '600 KB',
    viewCount: 8,
    likes: [
      { userId: 'member-1', userName: '陈思雨' },
      { userId: 'member-2', userName: '林子墨' },
      { userId: 'member-3', userName: '周悦然' },
    ],
  },
  {
    id: '5',
    title: '主理团队招新方案',
    type: 'regulation',
    fileType: 'pdf',
    fileUrl: null,
    uploadedBy: 'Admin',
    date: '2025-07-20',
    description: '新学期主理团队的招新宣传方案与面试流程。',
    size: '900 KB',
    viewCount: 15,
    likes: [],
  },
];

export const taskCategories = ['线上分享', '课程测评', '公众号文章', '其他'];
export const taskStatuses = ['待启动', '进行中', '已完成', '已取消'];

// 成员数据（用于负责人 / 协助人选择）
export const teamMembers = [
  { id: 'member-1', name: '陈思雨', role: '主理人', avatar: avatarUrl('陈思雨'), profileUrl: '/timeline#team' },
  { id: 'member-2', name: '林子墨', role: '内容策划', avatar: avatarUrl('林子墨'), profileUrl: '/timeline#team' },
  { id: 'member-3', name: '周悦然', role: '访谈采编', avatar: avatarUrl('周悦然'), profileUrl: '/timeline#team' },
  { id: 'member-4', name: '张一帆', role: '活动组织', avatar: avatarUrl('张一帆'), profileUrl: '/timeline#team' },
  { id: 'member-5', name: '李明远', role: '运营推广', avatar: avatarUrl('李明远'), profileUrl: '/timeline#team' },
  { id: 'member-6', name: '王诗涵', role: '视觉设计', avatar: avatarUrl('王诗涵'), profileUrl: '/timeline#team' },
];

export const notificationsData = [
  {
    id: '1',
    title: '请同步更新本周活动资料',
    message: '第十一期分享会的相关资料请各位主理成员尽快上传至文档管理页面。',
    type: 'progress',
    date: '2025-04-10',
    read: true,
  },
  {
    id: '2',
    title: '课程测评征集已开启',
    message: '大二上课程测评征集问卷已发放，请相关负责人关注填写进度。',
    type: 'progress',
    date: '2025-04-08',
    read: true,
  },
  {
    id: '3',
    title: '新成员加入团队',
    message: '欢迎新成员加入 RIEMer Land 主理团队！请到用户管理页面完成授权。',
    type: 'other',
    date: '2025-04-05',
    read: true,
  },
  {
    id: '4',
    title: '内容策划会议纪要已上传',
    message: '3月底内容策划会议纪要已上传至文档管理，请查阅。',
    type: 'sharing',
    date: '2025-03-30',
    read: true,
  },
];

export const initialTasks = [
  {
    id: '1',
    title: '策划「听 RIEMer 说」第十一期',
    description: '确定访谈对象、拟定采访提纲、排期发布',
    category: '线上分享',
    status: '进行中',
    assignee: 'member-1',
    helpers: ['member-3'],
    createdAt: '2025-03-20',
  },
  {
    id: '2',
    title: '征集大二上课程测评',
    description: '面向全院征集大二上学期各方向课程评价',
    category: '课程测评',
    status: '待启动',
    assignee: 'member-3',
    helpers: [],
    createdAt: '2025-03-15',
  },
  {
    id: '3',
    title: '筹备 RIEMer\'s Space 第十一期分享会',
    description: '确定主题、邀请分享人、制作宣传海报',
    category: '线上分享',
    status: '待启动',
    assignee: 'member-2',
    helpers: ['member-1'],
    createdAt: '2025-03-18',
  },
  {
    id: '4',
    title: '公众号推文排版优化',
    description: '统一推文排版风格，更新封面模板',
    category: '公众号文章',
    status: '进行中',
    assignee: 'member-2',
    helpers: [],
    createdAt: '2025-03-10',
  },
  {
    id: '5',
    title: '整理历史推文归档',
    description: '将公众号所有历史文章分类整理，同步到网站',
    category: '公众号文章',
    status: '已完成',
    assignee: 'member-1',
    helpers: ['member-2', 'member-3'],
    createdAt: '2025-02-15',
  },
];
