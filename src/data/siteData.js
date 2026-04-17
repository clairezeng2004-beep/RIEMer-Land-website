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

export const articlesData = [];

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
