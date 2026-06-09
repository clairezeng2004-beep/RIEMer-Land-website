import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import './ImageLightbox.css';

/**
 * 文章详情页图片放大查看：点击正文里的图片，弹出全屏大图。
 *
 * Props:
 *   containerRef — 文章正文容器 ref；在其中点击 <img> 即放大查看
 */
export default function ImageLightbox({ containerRef }) {
  const [src, setSrc] = useState(null);

  // 监听正文里的图片点击
  useEffect(() => {
    const el = containerRef?.current;
    if (!el) return undefined;
    el.classList.add('imglb-scope'); // 让正文图片显示放大光标
    const onClick = (e) => {
      const img = e.target instanceof HTMLElement ? e.target.closest('img') : null;
      if (!img || !el.contains(img)) return;
      // 编辑态（contenteditable）里不放大，交给编辑器处理（选中/拖拽等）
      if (img.closest('[contenteditable="true"]')) return;
      // 图片被包在链接里时，让链接正常跳转，不拦截
      if (img.closest('a')) return;
      e.preventDefault();
      setSrc(img.currentSrc || img.src);
    };
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('click', onClick);
      el.classList.remove('imglb-scope');
    };
  }, [containerRef]);

  // 打开时：Esc 关闭 + 锁定背景滚动
  useEffect(() => {
    if (!src) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setSrc(null); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [src]);

  if (!src) return null;

  return createPortal(
    <div
      className="imglb__overlay"
      onClick={() => setSrc(null)}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        className="imglb__close"
        onClick={() => setSrc(null)}
        aria-label="关闭大图"
      >
        <X size={22} />
      </button>
      {/* 点击图片本身不关闭，便于查看；点击周围暗色区域关闭 */}
      <img
        className="imglb__img"
        src={src}
        alt=""
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body
  );
}
