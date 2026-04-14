import { useState, useCallback } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useWysiwyg } from '../../contexts/WysiwygContext';
import EditableText from '../../components/EditableText';
import { pinyinMatch } from '../../utils/pinyinSearch';
import {
  Share2,
  Plus,
  X,
  Search,
  Clock,
  User,
  Eye,
  Trash2,
  FileText,
  Code2,
  ThumbsUp,
  ExternalLink,
} from 'lucide-react';
import './MemberSharing.css';

const SHARING_KEY = 'riemer_member_sharing';
const SHARING_VIEWS_KEY = 'riemer_sharing_views';

const categoryLabels = {
  course: '课程资料',
  history: '历史会议',
  experience: '成员经验分享',
};

const categoryColors = {
  course: '#5EAD8C',
  history: '#4FBFC4',
  experience: '#EC4899',
};

// 初始示例数据
const defaultSharings = [
  {
    id: 'sharing-1',
    title: '微观经济学期末复习要点整理',
    category: 'course',
    format: 'markdown',
    content: `# 微观经济学期末复习要点

## 一、消费者理论
- **效用最大化**：MRS = Px/Py
- 无差异曲线的性质：凸向原点、不相交、越远离原点效用越高
- 恩格尔曲线与收入消费曲线

## 二、生产者理论
- 短期与长期成本
- 利润最大化条件：MC = MR
- 规模报酬递增、递减与不变

## 三、市场结构
| 市场类型 | 企业数量 | 产品差异 | 进入壁垒 |
|---------|---------|---------|---------|
| 完全竞争 | 很多 | 无 | 无 |
| 垄断竞争 | 较多 | 有 | 低 |
| 寡头 | 少数 | 有/无 | 高 |
| 垄断 | 一个 | — | 极高 |

> 重点关注博弈论部分（纳什均衡、囚徒困境）

希望对大家有帮助！有问题欢迎在群里讨论 💪`,
    author: '林子墨',
    authorId: 'member-2',
    createdAt: '2025-04-10',
    likes: [
      { userId: 'member-1', userName: '陈思雨' },
      { userId: 'member-3', userName: '周悦然' },
    ],
  },
  {
    id: 'sharing-2',
    title: '第九期分享会会议纪要',
    category: 'history',
    format: 'word',
    content: `<h1>第九期 RIEMer's Space 分享会 · 会议纪要</h1>
<p><strong>时间：</strong>2025 年 3 月 15 日（周六）14:00-16:00</p>
<p><strong>形式：</strong>线上（腾讯会议）</p>
<p><strong>主题：</strong>数模备赛经验分享</p>
<h2>一、分享内容概要</h2>
<p>本期邀请了三位数学建模竞赛获奖选手，从<strong>选题策略</strong>、<strong>建模方法</strong>、<strong>论文撰写</strong>三个维度进行了系统分享。</p>
<h3>1. 选题策略</h3>
<ul>
  <li>通读所有题目后再做选择，不要急于动手</li>
  <li>评估队伍擅长的方向（优化、统计、机器学习等）</li>
  <li>C 题（数据分析类）通常适合经管背景同学</li>
</ul>
<h3>2. 建模方法</h3>
<ul>
  <li>常用模型：线性规划、层次分析法、灰色预测、TOPSIS</li>
  <li>注意模型假设的合理性与局限性说明</li>
</ul>
<h3>3. 论文撰写</h3>
<ul>
  <li>摘要是评审重点，需包含问题、方法、结果</li>
  <li>图表清晰规范，代码放附录</li>
</ul>
<h2>二、Q&A 环节</h2>
<p>同学们就<em>组队建议</em>、<em>软件工具推荐</em>、<em>时间分配</em>等问题进行了互动交流。</p>
<h2>三、后续安排</h2>
<p>下期分享会暂定主题：快消行业与职业选择经验分享。</p>`,
    author: '张一帆',
    authorId: 'member-4',
    createdAt: '2025-03-16',
    likes: [
      { userId: 'member-2', userName: '林子墨' },
    ],
  },
  {
    id: 'sharing-3',
    title: '我的实习面试经验总结',
    category: 'experience',
    format: 'markdown',
    content: `# 实习面试经验总结

经历了大概 20+ 场面试后，总结一些通用的经验分享给大家。

## 面试前准备

1. **简历优化**：STAR 法则（Situation-Task-Action-Result）描述经历
2. **公司调研**：了解业务、近期动态、竞品分析
3. **自我介绍**：准备 1 分钟和 3 分钟两个版本

## 常见问题

### 行为面试
- "说一个你面对困难/冲突的经历"
- "说一个你主动推动的项目"
- "你最大的优缺点是什么"

### 专业知识（经管向）
- 宏观经济热点（利率、汇率、CPI）
- 行业分析框架（波特五力、PEST）
- 财务报表三张表的关系

## 面试中技巧

- 🎯 回答要有**结构**，不要想到什么说什么
- 🤝 保持**眼神交流**和适度的肢体语言
- ❓ 面试最后的"你有什么想问的"一定要准备 2-3 个问题

## 心态调整

> 每一场面试都是一次练习，被拒绝不代表你不优秀，只是不匹配。

加油！ 🌟`,
    author: '周悦然',
    authorId: 'member-3',
    createdAt: '2025-04-05',
    likes: [
      { userId: 'member-1', userName: '陈思雨' },
      { userId: 'member-4', userName: '张一帆' },
      { userId: 'member-5', userName: '李明远' },
    ],
  },
];

// 从 localStorage 加载
function loadSharings() {
  try {
    const stored = localStorage.getItem(SHARING_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return defaultSharings;
}

function saveSharings(data) {
  localStorage.setItem(SHARING_KEY, JSON.stringify(data));
}

function loadViews() {
  try {
    const stored = localStorage.getItem(SHARING_VIEWS_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return {};
}

export default function MemberSharing() {
  const { isAuthenticated, isAdmin, user } = useAuth();
  const { internalConfig, updateInternalConfig } = useSiteContent();
  useWysiwyg();

  const sc = internalConfig.memberSharing || {};
  const updateSC = useCallback(
    (key, val) => updateInternalConfig({ memberSharing: { [key]: val } }),
    [updateInternalConfig],
  );

  const [sharings, setSharings] = useState(loadSharings);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [showCreate, setShowCreate] = useState(false);
  const [newPost, setNewPost] = useState({
    title: '',
    category: 'experience',
    format: 'markdown',
    content: '',
  });
  const views = loadViews();

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const categories = ['全部', 'course', 'history', 'experience'];

  const filtered = sharings.filter((s) => {
    const matchSearch =
      !searchTerm ||
      pinyinMatch(s.title, searchTerm) ||
      pinyinMatch(s.author, searchTerm);
    const matchCat = selectedCategory === '全部' || s.category === selectedCategory;
    return matchSearch && matchCat;
  });

  const handleCreate = (e) => {
    e.preventDefault();
    if (!newPost.title.trim() || !newPost.content.trim()) return;

    const post = {
      id: `sharing-${Date.now()}`,
      title: newPost.title.trim(),
      category: newPost.category,
      format: newPost.format,
      content: newPost.content,
      author: user?.nickname || user?.name || 'Unknown',
      authorId: user?.id || null,
      createdAt: new Date().toISOString().split('T')[0],
      likes: [],
    };

    const updated = [post, ...sharings];
    setSharings(updated);
    saveSharings(updated);
    setNewPost({ title: '', category: 'experience', format: 'markdown', content: '' });
    setShowCreate(false);
  };

  const handleDelete = (id) => {
    if (!window.confirm('确定要删除这篇分享吗？')) return;
    const updated = sharings.filter((s) => s.id !== id);
    setSharings(updated);
    saveSharings(updated);
  };

  const handleLike = (id, e) => {
    if (e) e.preventDefault();
    if (!user) return;
    const updated = sharings.map((s) => {
      if (s.id !== id) return s;
      const likes = s.likes || [];
      const already = likes.some((l) => l.userId === user.id);
      return {
        ...s,
        likes: already
          ? likes.filter((l) => l.userId !== user.id)
          : [...likes, { userId: user.id, userName: user.nickname || user.name || user.email }],
      };
    });
    setSharings(updated);
    saveSharings(updated);
  };

  const hasLiked = (post) => {
    if (!user || !post.likes) return false;
    return post.likes.some((l) => l.userId === user.id);
  };

  const canModify = (post) => {
    if (isAdmin) return true;
    if (post.authorId && post.authorId === user?.id) return true;
    return false;
  };

  // 获取文本的纯文摘要（前 120 字）
  const getExcerpt = (post) => {
    let text = post.content;
    if (post.format === 'word') {
      text = text.replace(/<[^>]+>/g, ' ');
    } else {
      // Markdown: 去掉标记
      text = text
        .replace(/#{1,6}\s/g, '')
        .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[>\-|`~]/g, ' ')
        .replace(/!\[.*?\]\(.*?\)/g, '');
    }
    text = text.replace(/\s+/g, ' ').trim();
    return text.length > 120 ? text.slice(0, 120) + '…' : text;
  };

  return (
    <div className="ms-page">
      <div className="container">
        {/* Header */}
        <div className="ms-page__header">
          <div>
            <h1>
              <Share2 size={28} />{' '}
              <EditableText
                value={sc.pageTitle || '成员内部分享'}
                configKey="memberSharing.pageTitle"
                onChange={(v) => updateSC('pageTitle', v)}
                as="span"
              />
            </h1>
            <p>
              <EditableText
                value={sc.pageDesc || '浏览课程资料、历史会议记录及成员经验分享，支持 Word 与 Markdown 格式'}
                configKey="memberSharing.pageDesc"
                onChange={(v) => updateSC('pageDesc', v)}
                as="span"
              />
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>
            {showCreate ? <X size={18} /> : <Plus size={18} />}
            {showCreate ? '取消' : '发布分享'}
          </button>
        </div>

        {/* Create Form */}
        {showCreate && (
          <div className="ms-create card">
            <h3><Plus size={18} /> 发布新分享</h3>
            <form onSubmit={handleCreate} className="ms-create__form">
              <div className="ms-create__row">
                <div className="ms-create__field ms-create__field--grow">
                  <label>标题</label>
                  <input
                    type="text"
                    className="ms-create__input"
                    value={newPost.title}
                    onChange={(e) => setNewPost({ ...newPost, title: e.target.value })}
                    placeholder="请输入分享标题"
                    required
                  />
                </div>
                <div className="ms-create__field">
                  <label>分类</label>
                  <select
                    className="ms-create__input ms-create__select"
                    value={newPost.category}
                    onChange={(e) => setNewPost({ ...newPost, category: e.target.value })}
                  >
                    {Object.entries(categoryLabels).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 格式切换 */}
              <div className="ms-create__field">
                <label>内容格式</label>
                <div className="ms-create__format-toggle">
                  <button
                    type="button"
                    className={`ms-create__format-btn ${newPost.format === 'markdown' ? 'ms-create__format-btn--active' : ''}`}
                    onClick={() => setNewPost({ ...newPost, format: 'markdown' })}
                  >
                    <Code2 size={14} /> Markdown
                  </button>
                  <button
                    type="button"
                    className={`ms-create__format-btn ${newPost.format === 'word' ? 'ms-create__format-btn--active' : ''}`}
                    onClick={() => setNewPost({ ...newPost, format: 'word' })}
                  >
                    <FileText size={14} /> Word (HTML)
                  </button>
                </div>
              </div>

              <div className="ms-create__field">
                <label>
                  内容
                  <span className="ms-create__hint">
                    {newPost.format === 'markdown'
                      ? '支持 Markdown 语法：标题用 #，加粗用 **，列表用 -'
                      : '支持 HTML 标签：<h1> <p> <strong> <ul> <li> 等'}
                  </span>
                </label>
                <textarea
                  className="ms-create__textarea"
                  value={newPost.content}
                  onChange={(e) => setNewPost({ ...newPost, content: e.target.value })}
                  placeholder={
                    newPost.format === 'markdown'
                      ? '# 标题\n\n正文内容...\n\n- 列表项 1\n- 列表项 2'
                      : '<h1>标题</h1>\n<p>正文内容...</p>\n<ul>\n  <li>列表项 1</li>\n</ul>'
                  }
                  rows={12}
                  required
                />
              </div>

              <button type="submit" className="btn btn-primary">
                <Share2 size={16} /> 发布分享
              </button>
            </form>
          </div>
        )}

        {/* Filters */}
        <div className="ms-filters">
          <div className="ms-filters__search">
            <Search size={18} className="ms-filters__icon" />
            <input
              type="text"
              placeholder="搜索分享..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="ms-filters__input"
            />
          </div>
          <div className="ms-filters__categories">
            {categories.map((cat) => (
              <button
                key={cat}
                className={`ms-filters__cat ${selectedCategory === cat ? 'ms-filters__cat--active' : ''}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat === '全部' ? '全部' : categoryLabels[cat]}
              </button>
            ))}
          </div>
        </div>

        {/* Sharing List */}
        <div className="ms-list">
          {filtered.map((post) => (
            <div key={post.id} className="ms-card card">
              <div className="ms-card__accent" style={{ background: categoryColors[post.category] }} />
              <div className="ms-card__body">
                <div className="ms-card__top">
                  <span
                    className="ms-card__badge"
                    style={{
                      color: categoryColors[post.category],
                      background: `${categoryColors[post.category]}15`,
                    }}
                  >
                    {categoryLabels[post.category]}
                  </span>
                  <span className="ms-card__format-tag">
                    {post.format === 'markdown' ? <><Code2 size={11} /> Markdown</> : <><FileText size={11} /> Word</>}
                  </span>
                </div>

                <Link to={`/internal/member-sharing/${post.id}`} className="ms-card__title-link">
                  <h4 className="ms-card__title">{post.title}</h4>
                </Link>

                <p className="ms-card__excerpt">{getExcerpt(post)}</p>

                <div className="ms-card__meta">
                  <span className="ms-card__author">
                    <User size={12} /> {post.author}
                  </span>
                  <span className="ms-card__date">
                    <Clock size={12} /> {post.createdAt}
                  </span>
                  <span className="ms-card__views">
                    <Eye size={12} /> {views[post.id] || 0}
                  </span>
                </div>
              </div>

              <div className="ms-card__bottom" onClick={(e) => e.stopPropagation()}>
                <div className="ms-card__bottom-left">
                  <button
                    className={`ms-card__like-btn ${hasLiked(post) ? 'ms-card__like-btn--active' : ''}`}
                    onClick={(e) => handleLike(post.id, e)}
                  >
                    <ThumbsUp size={14} />
                    <span>{(post.likes || []).length}</span>
                  </button>
                  {(post.likes || []).length > 0 && (
                    <div className="ms-card__like-names">
                      {post.likes.map((l, idx) => (
                        <span key={l.userId}>
                          {l.userName}{idx < post.likes.length - 1 ? '、' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="ms-card__bottom-right">
                  <Link
                    to={`/internal/member-sharing/${post.id}`}
                    className="ms-card__action-icon"
                    title="查看全文"
                  >
                    <ExternalLink size={14} />
                  </Link>
                  {canModify(post) && (
                    <button
                      className="ms-card__action-icon ms-card__action-icon--danger"
                      onClick={() => handleDelete(post.id)}
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="ms-empty">
            <Share2 size={48} />
            <h3>暂无分享</h3>
            <p>点击"发布分享"按钮开始分享内容</p>
          </div>
        )}
      </div>
    </div>
  );
}
