import { useState, useEffect, useRef } from 'react';
import './CoverImage.css';

/**
 * 封面图片组件 — 加载稳定展示，避免刷新时变形
 * 1. 图片未加载时显示纯色占位背景
 * 2. 图片加载完成后淡入
 * 3. 使用浏览器缓存时几乎无感切换
 */
export default function CoverImage({ src, alt, className = '' }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const imgRef = useRef(null);

  // 如果图片已在浏览器缓存中（complete = true），立即标记为已加载
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current?.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [src]);

  // src 变化时重置状态
  useEffect(() => {
    setLoaded(false);
    setError(false);
  }, [src]);

  if (!src || error) {
    return null; // 让外部的 placeholder 处理
  }

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt || ''}
      className={`cover-image ${loaded ? 'cover-image--loaded' : ''} ${className}`}
      onLoad={() => setLoaded(true)}
      onError={() => setError(true)}
      // 不使用 loading="lazy"，因为封面图是首屏内容，应尽早加载
      decoding="async"
    />
  );
}
