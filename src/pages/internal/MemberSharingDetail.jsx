import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Navigate, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { marked } from 'marked';
import {
  ChevronLeft,
  Clock,
  User,
  Eye,
  ThumbsUp,
  Code2,
  FileText,
  Share2,
  Paperclip,
  Download,
  File,
  Image,
  FileSpreadsheet,
  FileArchive,
  List,
  X,
} from 'lucide-react';
import './MemberSharingDetail.css';

const SHARING_KEY = 'riemer_member_sharing';
const SHARING_VIEWS_KEY = 'riemer_sharing_views';
const CATEGORIES_KEY = 'riemer_sharing_categories';

// 默认分类
const DEFAULT_CATEGORIES = [
  { key: 'course', label: '课程资料', color: '#5EAD8C' },
  { key: 'history', label: '历史会议', color: '#4FBFC4' },
  { key: 'experience', label: '成员经验分享', color: '#EC4899' },
];

function loadCategories() {
  try {
    const stored = localStorage.getItem(CATEGORIES_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return DEFAULT_CATEGORIES;
}

function buildCategoryMaps(cats) {
  const labels = {};
  const colors = {};
  cats.forEach((c) => {
    labels[c.key] = c.label;
    colors[c.key] = c.color;
  });
  return { labels, colors };
}

/* 附件辅助函数 */
function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return Image;
  if (['pdf'].includes(ext)) return FileText;
  if (['xls', 'xlsx', 'csv'].includes(ext)) return FileSpreadsheet;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return FileArchive;
  if (['doc', 'docx', 'ppt', 'pptx', 'txt', 'md'].includes(ext)) return FileText;
  return File;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function downloadFile(attachment) {
  const a = document.createElement('a');
  a.href = attachment.dataUrl;
  a.download = attachment.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// 初始示例数据（与 MemberSharing 保持一致）
const defaultSharings = [
  {
    id: 'sharing-1',
    title: '微观经济学期末复习要点整理',
    category: 'course',
    format: 'markdown',
    content: `# 微观经济学期末复习要点\n\n## 一、消费者理论\n- **效用最大化**：MRS = Px/Py\n- 无差异曲线的性质：凸向原点、不相交、越远离原点效用越高\n- 恩格尔曲线与收入消费曲线\n\n## 二、生产者理论\n- 短期与长期成本\n- 利润最大化条件：MC = MR\n- 规模报酬递增、递减与不变\n\n## 三、市场结构\n| 市场类型 | 企业数量 | 产品差异 | 进入壁垒 |\n|---------|---------|---------|----------|\n| 完全竞争 | 很多 | 无 | 无 |\n| 垄断竞争 | 较多 | 有 | 低 |\n| 寡头 | 少数 | 有/无 | 高 |\n| 垄断 | 一个 | — | 极高 |\n\n> 重点关注博弈论部分（纳什均衡、囚徒困境）\n\n希望对大家有帮助！有问题欢迎在群里讨论 💪`,
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
    content: `<h1>第九期 RIEMer's Space 分享会 · 会议纪要</h1><p><strong>时间：</strong>2025 年 3 月 15 日（周六）14:00-16:00</p><p><strong>形式：</strong>线上（腾讯会议）</p><p><strong>主题：</strong>数模备赛经验分享</p><h2>一、分享内容概要</h2><p>本期邀请了三位数学建模竞赛获奖选手，从<strong>选题策略</strong>、<strong>建模方法</strong>、<strong>论文撰写</strong>三个维度进行了系统分享。</p><h3>1. 选题策略</h3><ul><li>通读所有题目后再做选择，不要急于动手</li><li>评估队伍擅长的方向（优化、统计、机器学习等）</li><li>C 题（数据分析类）通常适合经管背景同学</li></ul><h3>2. 建模方法</h3><ul><li>常用模型：线性规划、层次分析法、灰色预测、TOPSIS</li><li>注意模型假设的合理性与局限性说明</li></ul><h3>3. 论文撰写</h3><ul><li>摘要是评审重点，需包含问题、方法、结果</li><li>图表清晰规范，代码放附录</li></ul><h2>二、Q&A 环节</h2><p>同学们就<em>组队建议</em>、<em>软件工具推荐</em>、<em>时间分配</em>等问题进行了互动交流。</p><h2>三、后续安排</h2><p>下期分享会暂定主题：快消行业与职业选择经验分享。</p>`,
    author: '张一帆',
    authorId: 'member-4',
    createdAt: '2025-03-16',
    likes: [{ userId: 'member-2', userName: '林子墨' }],
  },
  {
    id: 'sharing-3',
    title: '我的实习面试经验总结',
    category: 'experience',
    format: 'markdown',
    content: `# 实习面试经验总结\n\n经历了大概 20+ 场面试后，总结一些通用的经验分享给大家。\n\n## 面试前准备\n\n1. **简历优化**：STAR 法则（Situation-Task-Action-Result）描述经历\n2. **公司调研**：了解业务、近期动态、竞品分析\n3. **自我介绍**：准备 1 分钟和 3 分钟两个版本\n\n## 常见问题\n\n### 行为面试\n- "说一个你面对困难/冲突的经历"\n- "说一个你主动推动的项目"\n- "你最大的优缺点是什么"\n\n### 专业知识（经管向）\n- 宏观经济热点（利率、汇率、CPI）\n- 行业分析框架（波特五力、PEST）\n- 财务报表三张表的关系\n\n## 面试中技巧\n\n- 🎯 回答要有**结构**，不要想到什么说什么\n- 🤝 保持**眼神交流**和适度的肢体语言\n- ❓ 面试最后的"你有什么想问的"一定要准备 2-3 个问题\n\n## 心态调整\n\n> 每一场面试都是一次练习，被拒绝不代表你不优秀，只是不匹配。\n\n加油！ 🌟`,
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

function saveViews(data) {
  localStorage.setItem(SHARING_VIEWS_KEY, JSON.stringify(data));
}

export default function MemberSharingDetail() {
  const { isAuthenticated, user } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const contentRef = useRef(null);

  // 动态分类
  const { labels: categoryLabels, colors: categoryColors } = buildCategoryMaps(loadCategories());

  const [sharings, setSharings] = useState(loadSharings);
  const post = sharings.find((s) => s.id === id);

  // 浏览次数统计
  useEffect(() => {
    if (!post) return;
    const views = loadViews();
    views[post.id] = (views[post.id] || 0) + 1;
    saveViews(views);
  }, [post?.id]);

  // 配置 marked
  const renderedContent = useMemo(() => {
    if (!post) return '';
    if (post.format === 'markdown') {
      marked.setOptions({
        breaks: true,
        gfm: true,
      });
      return marked.parse(post.content);
    }
    // word (HTML) 格式直接返回
    return post.content;
  }, [post]);

  // ========== 目录导航（TOC） ==========
  const [toc, setToc] = useState([]);           // [{ id, text, level }]
  const [activeTocId, setActiveTocId] = useState('');
  const [tocOpenMobile, setTocOpenMobile] = useState(false);

  // 内容渲染完毕后提取标题，并给每个标题打 id
  useEffect(() => {
    if (!contentRef.current) return;
    const root = contentRef.current;
    const headings = root.querySelectorAll('h1, h2, h3');
    const items = [];
    const slugCount = {};
    headings.forEach((el, idx) => {
      const raw = (el.textContent || '').trim();
      if (!raw) return;
      // 生成稳定的 id
      let slug = raw
        .toLowerCase()
        .replace(/[\s\u3000]+/g, '-')
        .replace(/[^\w\u4e00-\u9fa5-]/g, '')
        .slice(0, 50) || `heading-${idx}`;
      if (slugCount[slug]) {
        slugCount[slug] += 1;
        slug = `${slug}-${slugCount[slug]}`;
      } else {
        slugCount[slug] = 1;
      }
      el.id = slug;
      el.classList.add('msd-heading-anchor');
      items.push({
        id: slug,
        text: raw,
        level: Number(el.tagName.substring(1)), // 1/2/3
      });
    });
    setToc(items);
    setActiveTocId(items[0]?.id || '');
  }, [renderedContent]);

  // 滚动时高亮当前章节
  useEffect(() => {
    if (!toc.length || !contentRef.current) return;
    const headings = toc
      .map((t) => document.getElementById(t.id))
      .filter(Boolean);
    if (!headings.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // 所有交叉中的标题，取最接近顶部的那个
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.target.getBoundingClientRect().top - b.target.getBoundingClientRect().top);
        if (visible[0]) {
          setActiveTocId(visible[0].target.id);
        }
      },
      {
        rootMargin: '-80px 0px -70% 0px',
        threshold: 0,
      },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [toc]);

  const handleTocClick = useCallback((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const offset = 80; // 顶栏高度预留
    const top = el.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top, behavior: 'smooth' });
    setActiveTocId(id);
    setTocOpenMobile(false);
  }, []);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (!post) {
    return (
      <div className="msd-page">
        <div className="msd-topbar">
          <button className="msd-topbar__back" onClick={() => navigate('/internal/member-sharing')}>
            <ChevronLeft size={20} /> 返回列表
          </button>
        </div>
        <div className="msd-content">
          <div className="msd-not-found">
            <Share2 size={48} />
            <h3>找不到该分享</h3>
            <p>内容可能已被删除或链接不正确</p>
            <button className="btn btn-secondary" onClick={() => navigate('/internal/member-sharing')}>
              <ChevronLeft size={16} /> 返回列表
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleLike = () => {
    if (!user) return;
    const updated = sharings.map((s) => {
      if (s.id !== post.id) return s;
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

  const hasLiked = post.likes?.some((l) => l.userId === user?.id);
  const views = loadViews();

  const showToc = toc.length > 0 && (post.format === 'markdown' || post.format === 'word');

  return (
    <div className="msd-page">
      {/* 顶部导航栏 — 类似 MemberSharingCreate */}
      <div className="msd-topbar">
        <button className="msd-topbar__back" onClick={() => navigate('/internal/member-sharing')}>
          <ChevronLeft size={20} /> 返回列表
        </button>
      </div>

      {/* 全屏内容区域 */}
      <div className="msd-content">
        <div className={`msd-content__inner ${showToc ? 'msd-content__inner--with-toc' : ''}`}>
          {/* 文章主体 */}
          <article className="msd-article">
            {/* 文章头部 */}
            <header className="msd-article__header">
              <span
                className="msd-article__badge"
                style={{
                  color: categoryColors[post.category] || '#6B7280',
                  background: `${categoryColors[post.category] || '#6B7280'}15`,
                }}
              >
                {categoryLabels[post.category] || post.category}
              </span>
              <span className="msd-article__format-tag">
                {post.format === 'markdown' ? <><Code2 size={12} /> Markdown</> : <><FileText size={12} /> Word</>}
              </span>

              <h1 className="msd-article__title">{post.title}</h1>

              {post.period && (
                <div className="msd-article__period">
                  <Clock size={13} /> 时间段：{post.period}
                </div>
              )}

              <div className="msd-article__meta">
                <span><User size={14} /> {post.author}</span>
                <span><Clock size={14} /> {post.createdAt}</span>
                <span><Eye size={14} /> {views[post.id] || 0} 次浏览</span>
              </div>
            </header>

            {/* 文章内容 */}
            <div
              ref={contentRef}
              className={`msd-article__content ${post.format === 'word' ? 'msd-article__content--word' : 'msd-article__content--markdown'}`}
              dangerouslySetInnerHTML={{ __html: renderedContent }}
            />

            {/* 附件列表 */}
            {post.attachments && post.attachments.length > 0 && (
              <div className="msd-attachments">
                <div className="msd-attachments__header">
                  <Paperclip size={16} />
                  <span>附件（{post.attachments.length}）</span>
                </div>
                <div className="msd-attachments__list">
                  {post.attachments.map((file) => {
                    const IconComp = getFileIcon(file.name);
                    return (
                      <button
                        key={file.id}
                        className="msd-attachments__item"
                        onClick={() => downloadFile(file)}
                        title={`下载 ${file.name}`}
                      >
                        <IconComp size={20} className="msd-attachments__item-icon" />
                        <div className="msd-attachments__item-info">
                          <span className="msd-attachments__item-name">{file.name}</span>
                          <span className="msd-attachments__item-size">{formatFileSize(file.size)}</span>
                        </div>
                        <Download size={16} className="msd-attachments__item-dl" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 底部点赞 */}
            <footer className="msd-article__footer">
              <button
                className={`msd-like-btn ${hasLiked ? 'msd-like-btn--active' : ''}`}
                onClick={handleLike}
              >
                <ThumbsUp size={16} />
                <span>{hasLiked ? '已赞' : '点赞'}</span>
              </button>
              {(post.likes || []).length > 0 && (
                <div className="msd-like-info">
                  <div className="msd-like-names">
                    {post.likes.map((l, idx) => (
                      <span key={l.userId}>
                        {l.userName}{idx < post.likes.length - 1 ? '、' : ''}
                      </span>
                    ))}
                  </div>
                  <span className="msd-like-count">
                    {post.likes.length} 人觉得有用
                  </span>
                </div>
              )}
            </footer>
          </article>

          {/* 目录导航（桌面端右侧 sticky） */}
          {showToc && (
            <aside className="msd-toc" aria-label="文章目录">
              <div className="msd-toc__header">
                <List size={14} />
                <span>目录</span>
              </div>
              <nav className="msd-toc__list">
                {toc.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`msd-toc__item msd-toc__item--l${item.level} ${activeTocId === item.id ? 'msd-toc__item--active' : ''}`}
                    onClick={() => handleTocClick(item.id)}
                    title={item.text}
                  >
                    <span className="msd-toc__dot" />
                    <span className="msd-toc__text">{item.text}</span>
                  </button>
                ))}
              </nav>
            </aside>
          )}
        </div>
      </div>

      {/* 移动端：浮动目录按钮 + 抽屉 */}
      {showToc && (
        <>
          <button
            type="button"
            className="msd-toc-fab"
            onClick={() => setTocOpenMobile(true)}
            aria-label="打开目录"
          >
            <List size={18} />
          </button>
          {tocOpenMobile && (
            <div
              className="msd-toc-drawer-mask"
              onClick={() => setTocOpenMobile(false)}
            >
              <div
                className="msd-toc-drawer"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="msd-toc-drawer__header">
                  <div className="msd-toc__header">
                    <List size={14} />
                    <span>目录</span>
                  </div>
                  <button
                    type="button"
                    className="msd-toc-drawer__close"
                    onClick={() => setTocOpenMobile(false)}
                    aria-label="关闭目录"
                  >
                    <X size={18} />
                  </button>
                </div>
                <nav className="msd-toc__list">
                  {toc.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`msd-toc__item msd-toc__item--l${item.level} ${activeTocId === item.id ? 'msd-toc__item--active' : ''}`}
                      onClick={() => handleTocClick(item.id)}
                      title={item.text}
                    >
                      <span className="msd-toc__dot" />
                      <span className="msd-toc__text">{item.text}</span>
                    </button>
                  ))}
                </nav>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
