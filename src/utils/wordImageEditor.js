/**
 * wordImageEditor
 * ---------------
 * 给 contentEditable 的 Word 风格富文本编辑器挂载"图片能力"：
 *
 *   1. 粘贴（剪贴板）图片 → 插入
 *   2. 拖拽文件/系统图片 → 插入
 *   3. 点击插入按钮/快捷方法 → 选文件插入
 *   4. 选中图片可像 Word 一样拖动 8 个手柄调整大小（等比 / 自由）
 *
 * 插入格式：每张图独占一个段落，水平居中：
 *   <p class="msc-img-wrap" style="text-align:center">
 *     <img src="..." class="msc-img" style="width:XXXpx" />
 *   </p>
 *   <p class="msc-img-caption" style="text-align:center">图片注释</p>
 *
 * 使用方式：
 *   const api = attachWordImageEditor(editorEl, {
 *     onChange: (html) => setContent(html),
 *   });
 *   // 卸载时：
 *   api.destroy();
 *
 *   // 主动插入图片（例如工具栏按钮）：
 *   api.insertImageFromFile(file);
 *   // 或弹起系统选择器：
 *   api.pickImage();
 */

import {
  EDITOR_IMAGE_COMPRESSION_OPTIONS,
  imageDataUrlToCompressedDataUrl,
  imageFileToCompressedDataUrl,
} from './imageCompression';

const DETAIL_CONTENT_IMAGE_MAX_WIDTH = 808;
const EDITOR_IMAGE_RECOMPRESS_MIN_CHARS = 120000;

function imageFileToEditorDataUrl(file) {
  return imageFileToCompressedDataUrl(file, EDITOR_IMAGE_COMPRESSION_OPTIONS);
}

/** 获取 img 原始尺寸（等图片加载完） */
function whenImgLoaded(img) {
  return new Promise((resolve) => {
    if (img.complete && img.naturalWidth) return resolve();
    const done = () => {
      img.removeEventListener('load', done);
      img.removeEventListener('error', done);
      resolve();
    };
    img.addEventListener('load', done);
    img.addEventListener('error', done);
  });
}

/** 在节点后补一个空段落，并把光标放进去，方便继续输入 */
function insertTrailingParagraphAfter(node) {
  const trailer = document.createElement('p');
  trailer.style.textAlign = 'left';
  trailer.setAttribute('align', 'left');
  trailer.innerHTML = '<br />';
  node.parentNode?.insertBefore(trailer, node.nextSibling);

  try {
    const sel = window.getSelection();
    if (!sel) return trailer;
    const range = document.createRange();
    range.selectNodeContents(trailer);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch { /* ignore */ }

  return trailer;
}

function getImageContainerWidth(editor, img) {
  const col = img.closest('.msc-col');
  const container = col || editor;
  const rectWidth = container.getBoundingClientRect?.().width || 0;
  const clientWidth = container.clientWidth || rectWidth || editor.clientWidth;
  const availableWidth = Math.max(32, Math.round(clientWidth - 8));
  return col ? availableWidth : Math.min(availableWidth, DETAIL_CONTENT_IMAGE_MAX_WIDTH);
}

function getNodeElement(node) {
  if (!node) return null;
  return node.nodeType === 1 ? node : node.parentElement;
}

function getActiveColumn(editor) {
  const sel = window.getSelection();
  if (sel?.rangeCount) {
    const range = sel.getRangeAt(0);
    const startEl = getNodeElement(range.startContainer);
    const col = startEl?.closest?.('.msc-col');
    if (col && editor.contains(col)) return col;
  }

  const selected = editor.querySelector('.msc-col--selected');
  return selected && editor.contains(selected) ? selected : null;
}

function getFirstColumnContent(col) {
  return [...col.children].find((child) => {
    if (child.classList?.contains('msc-col-resizer')) return false;
    if (child.classList?.contains('msc-col-adder')) return false;
    return true;
  }) || null;
}

function isColumnEmptyForImage(col) {
  if (!col) return false;
  return [...col.childNodes].every((node) => {
    if (node.nodeType === 3) return !String(node.textContent || '').replace(/\u200B/g, '').trim();
    if (node.nodeType !== 1) return true;
    if (node.classList?.contains('msc-col-resizer') || node.classList?.contains('msc-col-adder')) return true;
    return isEmptyParagraph(node);
  });
}

function getImageWrap(img) {
  return img?.closest?.('.msc-img-wrap') || null;
}

function getImageCaption(img) {
  const wrap = getImageWrap(img);
  const next = wrap?.nextElementSibling;
  return next?.classList?.contains('msc-img-caption') ? next : null;
}

function isEmptyParagraph(node) {
  if (!node || node.nodeType !== 1 || node.tagName.toLowerCase() !== 'p') return false;
  if (node.querySelector('img, video, table, iframe')) return false;
  const text = String(node.textContent || '').replace(/\u200B/g, '').trim();
  if (text) return false;
  return [...node.childNodes].every((child) => {
    if (child.nodeType === 3) return !String(child.textContent || '').replace(/\u200B/g, '').trim();
    if (child.nodeType !== 1) return true;
    return child.tagName.toLowerCase() === 'br';
  });
}

function isEmptyEditableBlock(node) {
  if (!node || node.nodeType !== 1) return false;
  const tag = node.tagName.toLowerCase();
  if (!['p', 'h1', 'h2', 'h3', 'h4', 'li', 'blockquote'].includes(tag)) return false;
  if (node.querySelector('img, video, table, iframe')) return false;
  const text = String(node.textContent || '').replace(/\u200B/g, '').trim();
  if (text) return false;
  return true;
}

function getDirectEditorBlock(editor, node) {
  let el = node?.nodeType === 1 ? node : node?.parentElement;
  while (el && el !== editor && el.parentElement !== editor && el.parentElement?.classList?.contains('msc-col') !== true) {
    el = el.parentElement;
  }
  if (el && editor.contains(el)) return el;
  return null;
}

function cleanupDraggedSourceBlock(block) {
  if (!block?.isConnected || !isEmptyEditableBlock(block)) return false;
  const list = block.closest('ul, ol');
  block.remove();
  if (list?.isConnected && !String(list.textContent || '').replace(/\u200B/g, '').trim() && !list.querySelector('img')) {
    list.remove();
  }
  return true;
}

function placeCaretAtStart(node) {
  try {
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } catch { /* ignore */ }
}

function ensureLeftTrailingParagraphAfter(node) {
  if (!node?.parentNode) return null;
  let trailer = node.nextElementSibling;
  while (trailer && isEmptyParagraph(trailer)) {
    const next = trailer.nextElementSibling;
    trailer.remove();
    trailer = next;
  }

  const p = document.createElement('p');
  p.style.textAlign = 'left';
  p.setAttribute('align', 'left');
  p.innerHTML = '<br />';
  node.parentNode.insertBefore(p, node.nextSibling);
  placeCaretAtStart(p);
  return p;
}

function normalizeColumnImageInsertion(editor, wrap, img) {
  const col = img.closest('.msc-col');
  const container = col?.closest('.msc-cols');
  if (!col || !container || !editor.contains(container)) return false;

  img.style.width = '100%';
  img.style.height = 'auto';

  if (wrap.parentNode === col) {
    while (wrap.previousElementSibling && isEmptyParagraph(wrap.previousElementSibling)) {
      wrap.previousElementSibling.remove();
    }
    while (wrap.nextElementSibling && isEmptyParagraph(wrap.nextElementSibling)) {
      wrap.nextElementSibling.remove();
    }
    [...col.childNodes].forEach((node) => {
      if (node.nodeType === 3 && !String(node.textContent || '').replace(/\u200B/g, '').trim()) {
        node.remove();
      }
    });
    const firstContent = [...col.children].find((child) => (
      child === wrap
      || (!isEmptyParagraph(child) && !child.classList?.contains('msc-col-resizer') && !child.classList?.contains('msc-col-adder'))
    ));
    if (firstContent && firstContent !== wrap) {
      col.insertBefore(wrap, firstContent);
    }
  }

  container.querySelectorAll('.msc-col--selected').forEach((item) => item.classList.remove('msc-col--selected'));
  ensureLeftTrailingParagraphAfter(container);
  return true;
}

async function normalizeExistingEditorImages(editor, onChange) {
  const imgs = Array.from(editor.querySelectorAll('img.msc-img, img'));
  let changed = false;
  for (const img of imgs) {
    const src = img.getAttribute('src') || '';
    if (!src.startsWith('data:image/')) continue;
    if (src.startsWith('data:image/gif') || src.startsWith('data:image/svg')) continue;
    if (src.length < EDITOR_IMAGE_RECOMPRESS_MIN_CHARS) continue;
    // eslint-disable-next-line no-await-in-loop
    const next = await imageDataUrlToCompressedDataUrl(src, EDITOR_IMAGE_COMPRESSION_OPTIONS);
    if (next && next !== src && next.length < src.length) {
      img.setAttribute('src', next);
      changed = true;
    }
  }
  if (changed) onChange?.(editor.innerHTML);
}

/**
 * 在当前光标处（或编辑器末尾）插入一张图片段落
 * 返回插入的 <img> 元素
 */
async function insertImageHtmlAtCaret(editor, dataUrl, { initialWidthRatio = 1 } = {}) {
  // 构造要插入的节点
  const wrap = document.createElement('p');
  wrap.className = 'msc-img-wrap';
  wrap.style.textAlign = 'center';

  const img = document.createElement('img');
  img.src = dataUrl;
  img.className = 'msc-img';
  // 允许选中后随光标拖拽移动（编辑器内）
  img.setAttribute('draggable', 'true');
  img.setAttribute('loading', 'lazy');
  img.setAttribute('decoding', 'async');
  img.alt = '';

  wrap.appendChild(img);

  // 分栏内插图必须落在具体栏里，不能插成 .msc-cols 的额外 grid 子项。
  const activeCol = getActiveColumn(editor);
  if (activeCol) {
    if (isColumnEmptyForImage(activeCol)) {
      activeCol.innerHTML = '';
      activeCol.appendChild(wrap);
    } else {
      activeCol.insertBefore(wrap, getFirstColumnContent(activeCol));
    }
    await whenImgLoaded(img);
    normalizeColumnImageInsertion(editor, wrap, img);
    return img;
  }

  // 插到当前 selection 位置，若光标不在 editor 内，则追加到末尾
  const sel = window.getSelection();
  let inserted = false;
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      range.deleteContents();
      range.insertNode(wrap);
      inserted = true;
    }
  }
  if (!inserted) {
    editor.appendChild(wrap);
  }

  // 图片加载后默认撑满当前输入区域：普通正文撑满编辑器，分栏内撑满当前栏。
  await whenImgLoaded(img);
  try {
    if (normalizeColumnImageInsertion(editor, wrap, img)) {
      return img;
    }
    const maxW = getImageContainerWidth(editor, img);
    const targetW = Math.round(maxW * initialWidthRatio);
    img.style.width = `${targetW}px`;
    img.style.height = 'auto';
  } catch { /* noop */ }

  // 插入图片后默认另起一个空段落，同栏文字只能从图片下方继续输入。
  insertTrailingParagraphAfter(wrap);

  return img;
}

/** 创建可视化 resize overlay，处于编辑器内部、相对定位。 */
function createResizer(editor, getImg, onResizeChange) {
  // overlay：绝对定位到编辑器内，覆盖在选中 img 上
  const overlay = document.createElement('div');
  overlay.className = 'msc-img-resizer';
  overlay.style.display = 'none';

  // 8 个手柄：nw, n, ne, e, se, s, sw, w
  const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((pos) => {
    const h = document.createElement('span');
    h.className = `msc-img-resizer__handle msc-img-resizer__handle--${pos}`;
    h.dataset.pos = pos;
    overlay.appendChild(h);
    return h;
  });

  editor.parentElement?.appendChild(overlay);

  function layout() {
    const img = getImg();
    if (!img || !editor.parentElement) {
      overlay.style.display = 'none';
      return;
    }
    const wrapRect = editor.parentElement.getBoundingClientRect();
    const r = img.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = `${r.left - wrapRect.left}px`;
    overlay.style.top = `${r.top - wrapRect.top}px`;
    overlay.style.width = `${r.width}px`;
    overlay.style.height = `${r.height}px`;
  }

  let dragging = null;

  function onMouseDown(e) {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.classList.contains('msc-img-resizer__handle')) return;
    const img = getImg();
    if (!img) return;
    e.preventDefault();
    const rect = img.getBoundingClientRect();
    const ratio = rect.height > 0 ? rect.width / rect.height : 1;
    dragging = {
      pos: target.dataset.pos,
      startX: e.clientX,
      startY: e.clientY,
      startW: rect.width,
      startH: rect.height,
      ratio,
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e) {
    if (!dragging) return;
    const img = getImg();
    if (!img || !editor.parentElement) return;
    const dx = e.clientX - dragging.startX;
    const dy = e.clientY - dragging.startY;

    // 根据手柄位置决定宽度/高度的变化方向
    let w = dragging.startW;
    let h = dragging.startH;
    const { pos, startW, startH, ratio } = dragging;
    if (pos.includes('e')) w = startW + dx;
    if (pos.includes('w')) w = startW - dx;
    if (pos.includes('s')) h = startH + dy;
    if (pos.includes('n')) h = startH - dy;

    // Shift 键自由缩放；否则保持等比（以 width 为主）
    const freeMode = e.shiftKey;
    if (!freeMode) {
      // 取变化更大的那一边作为主导，反推另一边
      const dW = Math.abs(w - startW);
      const dH = Math.abs(h - startH);
      if (dW >= dH) {
        h = w / ratio;
      } else {
        w = h * ratio;
      }
    }

    // 限制范围
    const maxW = getImageContainerWidth(editor, img);
    w = Math.max(32, Math.min(w, maxW));
    h = Math.max(24, h);

    img.style.width = `${Math.round(w)}px`;
    img.style.height = freeMode ? `${Math.round(h)}px` : 'auto';
    layout();
  }

  function onMouseUp() {
    if (!dragging) return;
    dragging = null;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    if (onResizeChange) onResizeChange();
  }

  overlay.addEventListener('mousedown', onMouseDown);
  // 编辑器滚动或窗口 resize 时同步 overlay 位置
  const onScrollOrResize = () => layout();
  window.addEventListener('resize', onScrollOrResize);
  editor.addEventListener('scroll', onScrollOrResize);
  editor.parentElement?.addEventListener('scroll', onScrollOrResize);

  return {
    layout,
    hide() {
      overlay.style.display = 'none';
    },
    destroy() {
      overlay.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      editor.removeEventListener('scroll', onScrollOrResize);
      editor.parentElement?.removeEventListener('scroll', onScrollOrResize);
      overlay.remove();
    },
  };
}

/** 主函数 */
export function attachWordImageEditor(editor, { onChange } = {}) {
  if (!editor) return { destroy() {} };
  let normalizeTimer = null;

  const scheduleNormalizeExistingImages = () => {
    if (normalizeTimer) clearTimeout(normalizeTimer);
    normalizeTimer = setTimeout(() => {
      normalizeTimer = null;
      normalizeExistingEditorImages(editor, onChange);
    }, 0);
  };

  scheduleNormalizeExistingImages();

  // 确保 overlay 的定位容器是 position:relative
  if (editor.parentElement) {
    const cs = getComputedStyle(editor.parentElement);
    if (cs.position === 'static') {
      editor.parentElement.style.position = 'relative';
    }
  }

  let selectedImg = null;
  // 正在被拖拽移动的编辑器内图片（用于和「文件拖入」区分）
  let draggingImg = null;
  let draggingSourceBlock = null;

  // 触发 onChange：把 editor.innerHTML 回写到 state
  const fireChange = () => {
    if (onChange) onChange(editor.innerHTML);
  };

  // resizer
  const resizer = createResizer(editor, () => selectedImg, fireChange);

  // 图片选择/取消选择
  function selectImage(img) {
    // 取消旧的
    editor.querySelectorAll('img.msc-img--selected').forEach((el) => {
      el.classList.remove('msc-img--selected');
    });
    selectedImg = img || null;
    if (img) {
      img.classList.add('msc-img--selected');
      // 让浏览器选区包住这张图：这样 Ctrl+C / Ctrl+X（剪切/复制）以及拖拽都能直接作用于它
      try {
        const range = document.createRange();
        range.selectNode(img);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      } catch { /* ignore */ }
      resizer.layout();
    } else {
      resizer.hide();
    }
  }

  function onEditorClick(e) {
    const target = e.target;
    if (target instanceof HTMLImageElement && target.classList.contains('msc-img')) {
      selectImage(target);
    } else {
      selectImage(null);
    }
  }

  // 粘贴：剪贴板里的图片
  function onEditorPaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    if (e.clipboardData?.getData('text/html')) {
      scheduleNormalizeExistingImages();
      return;
    }
    const imgs = Array.from(items).filter((it) => it.kind === 'file' && it.type.startsWith('image/'));
    if (imgs.length === 0) return; // 不拦截纯文本粘贴，交给外层原有逻辑处理
    e.preventDefault();
    e.stopPropagation();
    (async () => {
      for (const it of imgs) {
        const file = it.getAsFile();
        if (!file) continue;
        const dataUrl = await imageFileToEditorDataUrl(file);
        await insertImageHtmlAtCaret(editor, dataUrl);
      }
      fireChange();
    })();
  }

  // 落点 → caret Range（兼容不同浏览器 API）
  function caretRangeFromPoint(x, y) {
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (!p) return null;
      const r = document.createRange();
      r.setStart(p.offsetNode, p.offset);
      r.collapse(true);
      return r;
    }
    return null;
  }

  // 开始拖拽编辑器内的图片
  function onDragStart(e) {
    const t = e.target;
    const sel = window.getSelection();
    draggingSourceBlock = null;
    if (t instanceof HTMLImageElement && t.classList.contains('msc-img')) {
      draggingImg = t;
      draggingSourceBlock = t.closest('.msc-img-wrap') || getDirectEditorBlock(editor, t);
      selectImage(null); // 拖动时先隐藏 resize 手柄
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', ''); // 某些浏览器需要有 data 才能拖
      } catch { /* ignore */ }
    } else {
      draggingImg = null;
      const anchor = sel?.rangeCount ? sel.getRangeAt(0).commonAncestorContainer : t;
      draggingSourceBlock = getDirectEditorBlock(editor, anchor);
    }
  }
  function onDragEnd() {
    draggingImg = null;
    draggingSourceBlock = null;
    editor.classList.remove('msc-form__word-editor--drag');
  }

  // 拖拽经过：图片移动允许放置；文件拖入显示高亮
  function onDragOver(e) {
    const dt = e.dataTransfer;
    if (!dt) return;
    if (draggingImg) {
      e.preventDefault();
      dt.dropEffect = 'move';
      return;
    }
    const hasFile = Array.from(dt.items || []).some((it) => it.kind === 'file');
    if (hasFile) {
      e.preventDefault();
      e.stopPropagation();
      dt.dropEffect = 'copy';
      editor.classList.add('msc-form__word-editor--drag');
    }
  }
  function onDragLeave() {
    editor.classList.remove('msc-form__word-editor--drag');
  }
  function onDrop(e) {
    const dt = e.dataTransfer;
    if (!dt) return;

    // 1) 编辑器内图片移动：把图片所在块移动到落点光标处
    if (draggingImg) {
      e.preventDefault();
      e.stopPropagation();
      const img = draggingImg;
      draggingImg = null;
      editor.classList.remove('msc-form__word-editor--drag');
      const range = caretRangeFromPoint(e.clientX, e.clientY);
      if (!range) return;
      // 要移动的块：正文图片用 .msc-img-wrap；分栏内裸图则包成居中段落一起搬出
      let node = img.closest('.msc-img-wrap');
      const caption = getImageCaption(img);
      const staleTrailingParagraph = (caption || node)?.nextElementSibling || null;
      let moveNode = node;
      if (!node) {
        const wrap = document.createElement('p');
        wrap.className = 'msc-img-wrap';
        wrap.style.textAlign = 'center';
        wrap.appendChild(img);
        node = wrap;
        moveNode = wrap;
      } else if (caption) {
        const bundle = document.createDocumentFragment();
        bundle.appendChild(node);
        bundle.appendChild(caption);
        moveNode = bundle;
      }
      // 落点若在被拖块内部则放弃，避免把块塞进自己
      if (node.contains(range.startContainer)) return;
      try {
        range.insertNode(moveNode); // 节点已在文档中时会被移动到此处
        if (staleTrailingParagraph?.isConnected && isEmptyParagraph(staleTrailingParagraph)) {
          staleTrailingParagraph.remove();
        }
        cleanupDraggedSourceBlock(draggingSourceBlock);
        const after = document.createRange();
        after.setStartAfter(caption || node);
        after.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(after);
      } catch { /* ignore */ }
      fireChange();
      return;
    }

    // 2) 普通文字/块由浏览器执行默认移动；完成后清理源位置留下的空行
    const files = Array.from(dt.files || []).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) {
      const source = draggingSourceBlock;
      if (source) {
        setTimeout(() => {
          if (cleanupDraggedSourceBlock(source)) fireChange();
          if (draggingSourceBlock === source) draggingSourceBlock = null;
        }, 0);
      }
      return;
    }

    // 3) 从系统拖入图片文件
    e.preventDefault();
    e.stopPropagation();
    editor.classList.remove('msc-form__word-editor--drag');
    const range = caretRangeFromPoint(e.clientX, e.clientY);
    if (range) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    (async () => {
      for (const f of files) {
        const dataUrl = await imageFileToEditorDataUrl(f);
        await insertImageHtmlAtCaret(editor, dataUrl);
      }
      fireChange();
    })();
  }

  // 删除选中图片
  function onKeyDown(e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedImg) {
      e.preventDefault();
      // 阻止同一编辑器上后挂载的「分栏退格」处理器接着把空栏/整块删掉
      e.stopImmediatePropagation();
      const img = selectedImg;
      const col = img.closest('.msc-col');
      const wrap = img.closest('.msc-img-wrap');
      selectImage(null);

      if (col && !wrap) {
        // 分栏内的图片：只删图片，保留这一栏（变回可编辑空栏），不删整栏
        img.remove();
        // 若删图后这一栏没有可落脚的块，补一个空段落，保证仍可编辑/再插图
        if (!col.querySelector('img') && !col.querySelector('p, h1, h2, h3, h4, ul, ol, blockquote')) {
          const p = document.createElement('p');
          p.style.textAlign = 'left';
          p.setAttribute('align', 'left');
          p.innerHTML = '<br />';
          col.appendChild(p);
        }
        // 光标落到该栏，方便继续输入或重新插图
        try {
          const target = col.querySelector('p, h1, h2, h3, h4, ul, ol, blockquote') || col;
          const range = document.createRange();
          range.selectNodeContents(target);
          range.collapse(true);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        } catch { /* ignore */ }
        fireChange();
        return;
      }

      // 普通正文图片：删除整段容器，让整行随之消失
      const block = wrap || img.parentElement;
      const caption = getImageCaption(img);
      caption?.remove();
      if (block && block.parentElement) block.parentElement.removeChild(block);
      else if (img.parentElement) img.parentElement.removeChild(img);
      fireChange();
    }
  }

  // 原生剪切（Ctrl/Cmd+X）选中的图片后，内容已改变 → 同步并清理选中态
  function onCut() {
    setTimeout(() => {
      selectImage(null);
      fireChange();
    }, 0);
  }

  // 点击编辑器外 → 取消选中
  function onDocClick(e) {
    if (!editor.contains(e.target) && !resizer) return;
    if (editor.contains(e.target)) return;
    // 点到 overlay（resizer）也算在编辑里
    if (e.target instanceof HTMLElement && e.target.classList.contains('msc-img-resizer__handle')) return;
    if (e.target instanceof HTMLElement && e.target.classList.contains('msc-img-resizer')) return;
    selectImage(null);
  }

  editor.addEventListener('click', onEditorClick);
  editor.addEventListener('paste', onEditorPaste, true /* capture：优先处理图片 */);
  editor.addEventListener('dragstart', onDragStart);
  editor.addEventListener('dragend', onDragEnd);
  editor.addEventListener('dragover', onDragOver);
  editor.addEventListener('dragleave', onDragLeave);
  editor.addEventListener('drop', onDrop);
  editor.addEventListener('keydown', onKeyDown);
  editor.addEventListener('cut', onCut);
  document.addEventListener('mousedown', onDocClick);

  return {
    /** 主动插入一张图片 */
    async insertImageFromFile(file) {
      if (!file) return;
      const dataUrl = await imageFileToEditorDataUrl(file);
      await insertImageHtmlAtCaret(editor, dataUrl);
      fireChange();
    },
    /** 弹起系统文件选择器 */
    pickImage() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = async () => {
        const files = Array.from(input.files || []);
        for (const f of files) {
          const dataUrl = await imageFileToEditorDataUrl(f);
          await insertImageHtmlAtCaret(editor, dataUrl);
        }
        fireChange();
      };
      input.click();
    },
    destroy() {
      if (normalizeTimer) clearTimeout(normalizeTimer);
      editor.removeEventListener('click', onEditorClick);
      editor.removeEventListener('paste', onEditorPaste, true);
      editor.removeEventListener('dragstart', onDragStart);
      editor.removeEventListener('dragend', onDragEnd);
      editor.removeEventListener('dragover', onDragOver);
      editor.removeEventListener('dragleave', onDragLeave);
      editor.removeEventListener('drop', onDrop);
      editor.removeEventListener('keydown', onKeyDown);
      editor.removeEventListener('cut', onCut);
      document.removeEventListener('mousedown', onDocClick);
      resizer.destroy();
    },
  };
}
