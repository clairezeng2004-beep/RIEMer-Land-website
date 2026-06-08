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

/** 文件 → dataURL */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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
  return Math.max(32, Math.round(clientWidth - 8));
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
  img.setAttribute('draggable', 'false');
  img.alt = '';

  wrap.appendChild(img);

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
    if (img.closest('.msc-col')) {
      img.style.width = '100%';
      img.style.height = 'auto';
      insertTrailingParagraphAfter(wrap);
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

  // 确保 overlay 的定位容器是 position:relative
  if (editor.parentElement) {
    const cs = getComputedStyle(editor.parentElement);
    if (cs.position === 'static') {
      editor.parentElement.style.position = 'relative';
    }
  }

  let selectedImg = null;

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
    const imgs = Array.from(items).filter((it) => it.kind === 'file' && it.type.startsWith('image/'));
    if (imgs.length === 0) return; // 不拦截纯文本粘贴，交给外层原有逻辑处理
    e.preventDefault();
    e.stopPropagation();
    (async () => {
      for (const it of imgs) {
        const file = it.getAsFile();
        if (!file) continue;
        const dataUrl = await fileToDataUrl(file);
        await insertImageHtmlAtCaret(editor, dataUrl);
      }
      fireChange();
    })();
  }

  // 拖拽：拦截文件拖放
  function onDragOver(e) {
    const dt = e.dataTransfer;
    if (!dt) return;
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
    const files = Array.from(dt.files || []).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return; // 非图片交给默认
    e.preventDefault();
    e.stopPropagation();
    editor.classList.remove('msc-form__word-editor--drag');
    // 把光标移到 drop 位置
    try {
      const range =
        document.caretRangeFromPoint?.(e.clientX, e.clientY) ||
        (document.caretPositionFromPoint && (() => {
          const p = document.caretPositionFromPoint(e.clientX, e.clientY);
          if (!p) return null;
          const r = document.createRange();
          r.setStart(p.offsetNode, p.offset);
          r.collapse(true);
          return r;
        })());
      if (range) {
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    } catch { /* ignore */ }
    (async () => {
      for (const f of files) {
        const dataUrl = await fileToDataUrl(f);
        await insertImageHtmlAtCaret(editor, dataUrl);
      }
      fireChange();
    })();
  }

  // 删除选中图片
  function onKeyDown(e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedImg) {
      e.preventDefault();
      const wrap = selectedImg.closest('.msc-img-wrap') || selectedImg.parentElement;
      const img = selectedImg;
      selectImage(null);
      // 删除段落容器，让整行随之消失
      if (wrap && wrap.parentElement) wrap.parentElement.removeChild(wrap);
      else if (img.parentElement) img.parentElement.removeChild(img);
      fireChange();
    }
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
  editor.addEventListener('dragover', onDragOver);
  editor.addEventListener('dragleave', onDragLeave);
  editor.addEventListener('drop', onDrop);
  editor.addEventListener('keydown', onKeyDown);
  document.addEventListener('mousedown', onDocClick);

  return {
    /** 主动插入一张图片 */
    async insertImageFromFile(file) {
      if (!file) return;
      const dataUrl = await fileToDataUrl(file);
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
          const dataUrl = await fileToDataUrl(f);
          await insertImageHtmlAtCaret(editor, dataUrl);
        }
        fireChange();
      };
      input.click();
    },
    destroy() {
      editor.removeEventListener('click', onEditorClick);
      editor.removeEventListener('paste', onEditorPaste, true);
      editor.removeEventListener('dragover', onDragOver);
      editor.removeEventListener('dragleave', onDragLeave);
      editor.removeEventListener('drop', onDrop);
      editor.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onDocClick);
      resizer.destroy();
    },
  };
}
