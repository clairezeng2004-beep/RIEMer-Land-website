import { CalendarDays, Clock, MapPin, Video, ExternalLink, X } from 'lucide-react';
import './EventPreviewModal.css';

/**
 * 活动「中间卡片」预览弹窗。
 * 点击活动卡片后先出现这张卡片做衔接，而不是直接跳转原文链接。
 * 样式与首页访客访问的活动预览（replay-modal--event-preview）保持一致。
 *
 * Props:
 *   event           —— 活动对象（title/date/location/category/excerpt/officialUrl/hasReplay/replayUrl）
 *   onClose         —— 关闭弹窗
 *   onOpenOfficial  —— 点击「打开公众号推文」（父级负责 window.open + 关闭）
 *   onReplay        —— 点击「查看活动回放」（父级负责弹密码框）
 */
export default function EventPreviewModal({ event, onClose, onOpenOfficial, onReplay }) {
  if (!event) return null;

  const hasOfficial = Boolean(event.officialUrl && /^https?:\/\//i.test(event.officialUrl));
  const hasReplay = Boolean(event.hasReplay && event.replayUrl);

  return (
    <div className="evp__overlay" onClick={onClose}>
      <div
        className="evp"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="evp-title"
      >
        <button type="button" className="evp__close" onClick={onClose} aria-label="关闭">
          <X size={18} />
        </button>

        <div className="evp__icon">
          <CalendarDays size={32} />
        </div>

        <h3 id="evp-title" className="evp__title">{event.title}</h3>

        <div className="evp__meta">
          {event.date && (
            <span className="evp__meta-item">
              <Clock size={14} /> {event.date}
            </span>
          )}
          {event.location && (
            <span className="evp__meta-item">
              <MapPin size={14} /> {event.location}
            </span>
          )}
          {event.category && (
            <span className="evp__category">{event.category}</span>
          )}
        </div>

        <p className="evp__desc">{event.excerpt || '暂无活动简介'}</p>

        <div className="evp__actions">
          {hasOfficial && (
            <button
              type="button"
              className="btn btn-primary evp__primary"
              onClick={() => onOpenOfficial?.(event)}
            >
              <ExternalLink size={16} /> 打开公众号推文
            </button>
          )}
          {hasReplay && (
            <button
              type="button"
              className="btn btn-primary evp__primary"
              onClick={() => onReplay?.(event)}
            >
              <Video size={16} /> 查看活动回放
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            返回
          </button>
        </div>
      </div>
    </div>
  );
}
