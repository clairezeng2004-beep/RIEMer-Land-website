import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import './ImageLightbox.css';

/**
 * 文章详情页图片放大查看：点击正文里的图片，弹出全屏大图。
 *
 * Props:
 *   containerRef — 文章正文容器 ref；在其中点击 <img> 即放大查看
 */
export default function ImageLightbox({ containerRef }) {
  const [lightbox, setLightbox] = useState(null);
  const isOpen = Boolean(lightbox?.images?.length);
  const activeIndex = lightbox?.index ?? 0;
  const activeImage = lightbox?.images?.[activeIndex] ?? null;

  const closeLightbox = () => setLightbox(null);

  const moveLightbox = (direction) => {
    setLightbox((prev) => {
      if (!prev?.images?.length) return prev;
      const nextIndex = (prev.index + direction + prev.images.length) % prev.images.length;
      return { ...prev, index: nextIndex };
    });
  };

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
      const imageElements = Array.from(el.querySelectorAll('img'))
        .filter((item) => !item.closest('[contenteditable="true"]'))
        .filter((item) => !item.closest('a'));
      const articleImages = imageElements
        .map((item) => ({
          src: item.currentSrc || item.src,
          alt: item.alt || '',
        }))
        .filter((item) => item.src);
      const clickedSrc = img.currentSrc || img.src;
      const clickedIndex = Math.max(0, imageElements.indexOf(img));
      setLightbox({
        images: articleImages.length ? articleImages : [{ src: clickedSrc, alt: img.alt || '' }],
        index: clickedIndex,
      });
    };
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('click', onClick);
      el.classList.remove('imglb-scope');
    };
  }, [containerRef]);

  // 打开时：Esc 关闭，左右方向键切换，并锁定背景滚动
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        closeLightbox();
      } else if (e.key === 'ArrowLeft') {
        moveLightbox(-1);
      } else if (e.key === 'ArrowRight') {
        moveLightbox(1);
      }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  if (!activeImage) return null;
  const hasMultipleImages = lightbox.images.length > 1;

  return createPortal(
    <div
      className="imglb__overlay"
      onClick={closeLightbox}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        className="imglb__close"
        onClick={closeLightbox}
        aria-label="关闭大图"
      >
        <X size={22} />
      </button>
      {hasMultipleImages && (
        <>
          <button
            type="button"
            className="imglb__nav imglb__nav--prev"
            onClick={(e) => {
              e.stopPropagation();
              moveLightbox(-1);
            }}
            aria-label="查看上一张图片"
          >
            <ChevronLeft size={30} />
          </button>
          <button
            type="button"
            className="imglb__nav imglb__nav--next"
            onClick={(e) => {
              e.stopPropagation();
              moveLightbox(1);
            }}
            aria-label="查看下一张图片"
          >
            <ChevronRight size={30} />
          </button>
        </>
      )}
      {/* 点击图片本身不关闭，便于查看；点击周围暗色区域关闭 */}
      <img
        className="imglb__img"
        src={activeImage.src}
        alt={activeImage.alt}
        onClick={(e) => e.stopPropagation()}
      />
      {hasMultipleImages && (
        <div className="imglb__counter">
          {activeIndex + 1} / {lightbox.images.length}
        </div>
      )}
    </div>,
    document.body
  );
}
