import { useState, useEffect, useRef, useCallback } from 'react';
import './CoverImage.css';

/**
 * 封面图片组件 — 加载稳定展示，避免刷新时闪动
 * 1. 图片未加载时显示纯色占位背景
 * 2. 首次加载完成后淡入，缓存命中时无感展示（不闪动）
 * 3. 合并 useEffect 消除竞态问题
 */
export default function CoverImage({ src, alt, className = '' }) {
  const imgRef = useRef(null);
  const prevSrcRef = useRef(src);

  // 初始化时立即检测缓存，避免先 opacity:0 再 opacity:1 的闪动
  const getInitialLoaded = () => {
    // SSR 安全：仅在浏览器环境下检查
    if (typeof window === 'undefined') return false;
    // 如果 src 不变且已经有缓存，可以直接显示
    return false; // 首次挂载无法同步检查 DOM，由 effect 处理
  };

  const [loaded, setLoaded] = useState(getInitialLoaded);
  const [error, setError] = useState(false);

  // 单一 effect：src 变化时重置并检查缓存
  useEffect(() => {
    const img = imgRef.current;

    // 如果 src 变了才重置（避免首次挂载闪动）
    if (prevSrcRef.current !== src) {
      setLoaded(false);
      setError(false);
      prevSrcRef.current = src;
    }

    // 同步检查：图片已在浏览器缓存中（complete = true），立即标记
    if (img?.complete && img?.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [src]);

  const handleLoad = useCallback(() => setLoaded(true), []);
  const handleError = useCallback(() => setError(true), []);

  if (!src || error) {
    return null; // 让外部的 placeholder 处理
  }

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt || ''}
      className={`cover-image ${loaded ? 'cover-image--loaded' : ''} ${className}`}
      onLoad={handleLoad}
      onError={handleError}
      // 不使用 loading="lazy"，因为封面图是首屏内容，应尽早加载
      decoding="async"
    />
  );
}
