const DEFAULT_MAX_WIDTH = 1600;
const DEFAULT_MAX_HEIGHT = 1600;
const DEFAULT_QUALITY = 0.78;

export const EDITOR_IMAGE_COMPRESSION_OPTIONS = {
  maxWidth: 960,
  maxHeight: 960,
  quality: 0.68,
  outputType: 'image/webp',
};

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

function shouldSkipCompression(file) {
  const type = String(file?.type || '').toLowerCase();
  return !type.startsWith('image/') || type === 'image/gif' || type === 'image/svg+xml';
}

async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fallback to HTMLImageElement */
    }
  }

  const dataUrl = await fileToDataUrl(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

export async function imageFileToCompressedDataUrl(file, {
  maxWidth = DEFAULT_MAX_WIDTH,
  maxHeight = DEFAULT_MAX_HEIGHT,
  quality = DEFAULT_QUALITY,
  outputType = 'image/webp',
} = {}) {
  if (!file) return '';
  if (shouldSkipCompression(file)) return fileToDataUrl(file);

  try {
    const bitmap = await loadBitmap(file);
    const sourceWidth = bitmap.width || bitmap.naturalWidth;
    const sourceHeight = bitmap.height || bitmap.naturalHeight;
    if (!sourceWidth || !sourceHeight) return fileToDataUrl(file);

    const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: outputType !== 'image/jpeg' });
    if (!ctx) return fileToDataUrl(file);
    ctx.drawImage(bitmap, 0, 0, width, height);

    if (typeof bitmap.close === 'function') bitmap.close();

    let blob = await canvasToBlob(canvas, outputType, quality);
    if (!blob && outputType !== 'image/jpeg') {
      blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    }
    if (!blob) return fileToDataUrl(file);

    if (blob.size >= file.size && scale === 1) return fileToDataUrl(file);
    return fileToDataUrl(blob);
  } catch {
    return fileToDataUrl(file);
  }
}

export async function imageDataUrlToCompressedDataUrl(dataUrl, options = {}) {
  if (!String(dataUrl || '').startsWith('data:image/')) return dataUrl;
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    if (!blob?.type?.startsWith('image/')) return dataUrl;
    return imageFileToCompressedDataUrl(blob, options);
  } catch {
    return dataUrl;
  }
}
