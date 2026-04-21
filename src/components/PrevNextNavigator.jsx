import { ChevronLeft, ChevronRight, User } from 'lucide-react';
import { Link } from 'react-router-dom';
import './PrevNextNavigator.css';

/**
 * 通用"上一篇 / 下一篇"导航条，放在文章详情页底部。
 *
 * 视觉上：左右各一张卡，分别展示 "上一篇 / 下一篇" 的方向字样 + 文章标题。
 * 两张卡都是可点击链接，跳到对应条目。没有 prev 或 next 时占位空白，保持两列布局稳定。
 * 若某边是"同作者推荐"，右上角会显示一个小徽标表明"同作者"，让读者一眼看出
 * 这条是平台主动推荐而非单纯的列表相邻。
 *
 * 通过 renderLink prop 把"怎么跳"这件事交给调用方决定——
 * 不同模块的详情路由格式各自不同（/internal/article/:id、
 * /internal/member-sharing/:id、/internal/process-templates/:id 等），
 * 组件本身不做硬编码。
 *
 * @param {Object} props
 * @param {Object|null} props.prev        上一篇条目（或 null）
 * @param {Object|null} props.next        下一篇条目（或 null）
 * @param {boolean}    [props.prevSameAuthor=false]  prev 是否来自"同作者"推荐集合
 * @param {boolean}    [props.nextSameAuthor=false]  next 是否来自"同作者"推荐集合
 * @param {(item:Object)=>string} props.getHref      必填，由条目生成跳转 URL（Link to）
 * @param {(item:Object)=>string} [props.getTitle]   取标题，默认 item.title
 * @param {(item:Object)=>string} [props.getAuthor]  取作者文字，默认 item.author；为空则不显示
 * @param {string}    [props.className]              外层样式类，便于各详情页微调间距
 * @param {string}    [props.sameAuthorHint='同作者推荐']  徽标文字
 */
export default function PrevNextNavigator({
  prev,
  next,
  prevSameAuthor = false,
  nextSameAuthor = false,
  getHref,
  getTitle = (x) => x?.title || '',
  getAuthor = (x) => x?.author || '',
  className = '',
  sameAuthorHint = '同作者推荐',
}) {
  if (!prev && !next) return null;

  const renderCard = (item, direction, sameAuthor) => {
    if (!item) {
      // 用空白占位保证左右两列等宽；没有 prev 时右侧的 next 仍靠右对齐
      return <div className="prev-next__slot prev-next__slot--empty" aria-hidden="true" />;
    }
    const title = getTitle(item);
    const author = getAuthor(item);
    const href = getHref(item);
    const Icon = direction === 'prev' ? ChevronLeft : ChevronRight;
    return (
      <Link
        to={href}
        className={`prev-next__slot prev-next__slot--${direction}${
          sameAuthor ? ' prev-next__slot--same-author' : ''
        }`}
        title={title}
      >
        <div className="prev-next__direction">
          {direction === 'prev' && <Icon size={14} aria-hidden="true" />}
          <span>{direction === 'prev' ? '上一篇' : '下一篇'}</span>
          {direction === 'next' && <Icon size={14} aria-hidden="true" />}
        </div>
        <div className="prev-next__title">{title || '（无标题）'}</div>
        {(author || sameAuthor) && (
          <div className="prev-next__footer">
            {author && (
              <span className="prev-next__author">
                <User size={11} aria-hidden="true" />
                {author}
              </span>
            )}
            {sameAuthor && (
              <span className="prev-next__badge" title={sameAuthorHint}>
                {sameAuthorHint}
              </span>
            )}
          </div>
        )}
      </Link>
    );
  };

  return (
    <nav
      className={`prev-next${className ? ` ${className}` : ''}`}
      aria-label="上下篇导航"
    >
      {renderCard(prev, 'prev', prevSameAuthor)}
      {renderCard(next, 'next', nextSameAuthor)}
    </nav>
  );
}
