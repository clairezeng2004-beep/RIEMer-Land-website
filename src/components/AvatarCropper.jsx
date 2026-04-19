/**
 * AvatarCropper —— 个人主页头像裁剪 / 缩放 / 拖拽组件
 * ----------------------------------------------------------------
 * 功能：
 *  - 用户选择图片后弹出的遮罩式裁剪弹窗
 *  - 圆形裁剪区，图片可在裁剪区内自由拖拽移动（鼠标 / 触摸）
 *  - 缩放三种方式：底部滑竿、双指 pinch（移动端）、鼠标滚轮（桌面）
 *  - 约束图片始终覆盖圆形裁剪框（不会出现白边）
 *  - 最终输出 512×512 JPEG（base64 DataURL），质量 0.9
 *
 * 不引入第三方依赖；纯原生 React + Canvas 实现。
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, ZoomIn, ZoomOut, Check } from 'lucide-react';
import './AvatarCropper.css';

// 裁剪框显示尺寸（px）—— 视觉尺寸，不是最终输出尺寸
const CROP_SIZE = 280;
// 最终输出尺寸（px）—— 导出为正方形 JPEG
const OUTPUT_SIZE = 512;
// 缩放边界（基于"使图片最短边 === 裁剪框边长"的基准比例）
const MIN_SCALE = 1;   // 下限：图片刚好铺满裁剪框
const MAX_SCALE = 4;   // 上限：放大 4 倍

export default function AvatarCropper({ imageSrc, onCancel, onConfirm }) {
  // 原图尺寸
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  // 基准比例：让图片最短边 === CROP_SIZE
  const baseScaleRef = useRef(1);
  // 当前缩放倍数（在 base 之上的额外倍率），1 = 刚好铺满
  const [scale, setScale] = useState(1);
  // 图片中心相对于裁剪框中心的偏移（px）
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // 拖拽状态
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  // 双指 pinch 状态
  const pinchRef = useRef(null); // { startDist, startScale }

  // 加载图片拿到原始尺寸
  useEffect(() => {
    if (!imageSrc) return;
    const img = new Image();
    img.onload = () => {
      setNatural({ w: img.naturalWidth, h: img.naturalHeight });
      // 基准比例：图片最短边占满裁剪框
      const base = CROP_SIZE / Math.min(img.naturalWidth, img.naturalHeight);
      baseScaleRef.current = base;
      setScale(1);
      setOffset({ x: 0, y: 0 });
    };
    img.src = imageSrc;
  }, [imageSrc]);

  // 将 offset 约束在"图片始终覆盖裁剪框"的边界内
  const clampOffset = useCallback((nextOffset, nextScale) => {
    const base = baseScaleRef.current;
    const dispW = natural.w * base * nextScale;
    const dispH = natural.h * base * nextScale;
    // 允许偏移的最大半径（图片比裁剪框多出的那部分的一半）
    const maxX = Math.max(0, (dispW - CROP_SIZE) / 2);
    const maxY = Math.max(0, (dispH - CROP_SIZE) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, nextOffset.x)),
      y: Math.min(maxY, Math.max(-maxY, nextOffset.y)),
    };
  }, [natural]);

  // 拖拽：mousedown / touchstart
  const handlePointerDown = (clientX, clientY) => {
    draggingRef.current = true;
    dragStartRef.current = {
      x: clientX,
      y: clientY,
      ox: offset.x,
      oy: offset.y,
    };
  };
  const handlePointerMove = (clientX, clientY) => {
    if (!draggingRef.current) return;
    const dx = clientX - dragStartRef.current.x;
    const dy = clientY - dragStartRef.current.y;
    const raw = {
      x: dragStartRef.current.ox + dx,
      y: dragStartRef.current.oy + dy,
    };
    setOffset(clampOffset(raw, scale));
  };
  const handlePointerUp = () => {
    draggingRef.current = false;
    pinchRef.current = null;
  };

  // 鼠标事件
  const onMouseDown = (e) => {
    e.preventDefault();
    handlePointerDown(e.clientX, e.clientY);
  };
  useEffect(() => {
    const onMove = (e) => handlePointerMove(e.clientX, e.clientY);
    const onUp = () => handlePointerUp();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, offset, natural]);

  // 触摸事件（单指拖拽 / 双指 pinch）
  const onTouchStart = (e) => {
    if (e.touches.length === 1) {
      handlePointerDown(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = {
        startDist: Math.hypot(dx, dy),
        startScale: scale,
      };
      draggingRef.current = false;
    }
  };
  const onTouchMove = (e) => {
    if (e.touches.length === 1 && draggingRef.current) {
      e.preventDefault();
      handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / pinchRef.current.startDist;
      const nextScale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, pinchRef.current.startScale * ratio)
      );
      setScale(nextScale);
      setOffset((prev) => clampOffset(prev, nextScale));
    }
  };
  const onTouchEnd = () => handlePointerUp();

  // 鼠标滚轮缩放
  const onWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const nextScale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, scale + delta)
    );
    setScale(nextScale);
    setOffset((prev) => clampOffset(prev, nextScale));
  };

  // 滑竿缩放
  const onRangeChange = (e) => {
    const nextScale = parseFloat(e.target.value);
    setScale(nextScale);
    setOffset((prev) => clampOffset(prev, nextScale));
  };

  // 确认裁剪：用 canvas 把裁剪区内的像素画出来
  const handleConfirm = () => {
    if (!natural.w) return;
    const base = baseScaleRef.current;
    const dispScale = base * scale; // 显示时每个原始像素对应的屏幕像素
    // 裁剪区左上角相对于图片显示的原点（屏幕坐标）
    // 图片中心 = 裁剪框中心 + offset → 左上角 = 中心 - dispW/2
    // 裁剪区左上角相对于图片左上角的像素偏移：
    //   = (图片显示左上角到裁剪框左上角)
    //   = -((offset.x) - CROP_SIZE/2 - (-dispW/2))
    // 简化：把坐标系建在裁剪框左上角
    //   图片左上角在屏幕上 = (CROP_SIZE/2 + offset.x - dispW/2, ...)
    //   所以裁剪框 (0,0) 对应图片像素 = (-左上角) / dispScale
    const dispW = natural.w * dispScale;
    const dispH = natural.h * dispScale;
    const imgLeft = CROP_SIZE / 2 + offset.x - dispW / 2;
    const imgTop = CROP_SIZE / 2 + offset.y - dispH / 2;
    const srcX = -imgLeft / dispScale;
    const srcY = -imgTop / dispScale;
    const srcSize = CROP_SIZE / dispScale;

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    // 高质量缩放
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(
        img,
        srcX, srcY, srcSize, srcSize,
        0, 0, OUTPUT_SIZE, OUTPUT_SIZE
      );
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      onConfirm(dataUrl);
    };
    img.src = imageSrc;
  };

  // 图片显示样式
  const base = baseScaleRef.current;
  const dispW = natural.w * base * scale;
  const dispH = natural.h * base * scale;

  return (
    <div className="avatar-cropper__overlay" role="dialog" aria-label="裁剪头像">
      <div className="avatar-cropper__dialog" onClick={(e) => e.stopPropagation()}>
        <div className="avatar-cropper__header">
          <h3 className="avatar-cropper__title">调整头像</h3>
          <button
            type="button"
            className="avatar-cropper__close"
            onClick={onCancel}
            aria-label="取消"
          >
            <X size={18} />
          </button>
        </div>

        <div className="avatar-cropper__hint">
          拖动图片可调整位置，滑动下方滑竿可放大缩小
        </div>

        <div
          className="avatar-cropper__stage"
          style={{ width: CROP_SIZE, height: CROP_SIZE }}
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onWheel={onWheel}
        >
          {natural.w > 0 && (
            <img
              src={imageSrc}
              alt=""
              draggable={false}
              className="avatar-cropper__image"
              style={{
                width: dispW,
                height: dispH,
                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
          )}
          {/* 圆形蒙版：stage 整体是正方形，我们用一个绝对定位的圆形描边覆盖在上面，
              外部的半透明遮罩通过 box-shadow 的超大 spread 值制造。 */}
          <div className="avatar-cropper__mask" />
        </div>

        <div className="avatar-cropper__controls">
          <button
            type="button"
            className="avatar-cropper__icon-btn"
            onClick={() => {
              const next = Math.max(MIN_SCALE, scale - 0.1);
              setScale(next);
              setOffset((prev) => clampOffset(prev, next));
            }}
            aria-label="缩小"
          >
            <ZoomOut size={16} />
          </button>
          <input
            type="range"
            className="avatar-cropper__range"
            min={MIN_SCALE}
            max={MAX_SCALE}
            step={0.01}
            value={scale}
            onChange={onRangeChange}
          />
          <button
            type="button"
            className="avatar-cropper__icon-btn"
            onClick={() => {
              const next = Math.min(MAX_SCALE, scale + 0.1);
              setScale(next);
              setOffset((prev) => clampOffset(prev, next));
            }}
            aria-label="放大"
          >
            <ZoomIn size={16} />
          </button>
        </div>

        <div className="avatar-cropper__footer">
          <button
            type="button"
            className="avatar-cropper__btn avatar-cropper__btn--ghost"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="avatar-cropper__btn avatar-cropper__btn--primary"
            onClick={handleConfirm}
          >
            <Check size={16} />
            使用裁剪图
          </button>
        </div>
      </div>
    </div>
  );
}
