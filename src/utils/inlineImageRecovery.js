import { supabase } from '../lib/supabase';

const STORAGE_PUBLIC_RE = /\/storage\/v1\/object\/public\/([^/?#]+)\/([^?#]+)/;
const UNSTABLE_EXTERNAL_IMAGE_RE = /https?:\/\/(?:[^/]+\.)?(?:feishu\.cn|larksuite\.com)\/space\/api\/box\/stream\/download\//i;

function decodePath(path = '') {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function inferStorageImageRef(src = '') {
  const match = String(src || '').match(STORAGE_PUBLIC_RE);
  if (!match) return null;
  return {
    bucket: match[1],
    path: decodePath(match[2]),
  };
}

export function getStoragePublicUrl(bucket, path) {
  if (!supabase || !bucket || !path) return '';
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || '';
}

export function isUnstableExternalImageUrl(src = '') {
  return UNSTABLE_EXTERNAL_IMAGE_RE.test(String(src || ''));
}

export function hasUnstableExternalImages(html = '') {
  const source = String(html || '');
  if (!source || !/<img\b/i.test(source) || !UNSTABLE_EXTERNAL_IMAGE_RE.test(source)) return false;
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(source, 'text/html');
      return Array.from(doc.querySelectorAll('img')).some((img) => (
        isUnstableExternalImageUrl(img.getAttribute('src') || img.getAttribute('href') || '')
      ));
    } catch {
      /* fall through to regex scan */
    }
  }
  const imgTagRe = /<img\b[^>]*>/gi;
  let match;
  while ((match = imgTagRe.exec(source)) !== null) {
    const attr = match[0].match(/\b(?:src|href)=["']([^"']+)["']/i)?.[1] || '';
    if (isUnstableExternalImageUrl(attr)) return true;
  }
  return false;
}

export function stampInlineImageStorageRef(html, sourceUrl, { bucket, path, publicUrl }) {
  if (!html || !sourceUrl || !bucket || !path || typeof DOMParser === 'undefined') {
    return String(html || '').split(sourceUrl).join(publicUrl || sourceUrl);
  }
  try {
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    doc.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || img.getAttribute('href') || '';
      if (src !== sourceUrl) return;
      if (publicUrl) img.setAttribute('src', publicUrl);
      img.setAttribute('data-storage-bucket', bucket);
      img.setAttribute('data-storage-path', path);
    });
    return doc.body.innerHTML;
  } catch {
    return String(html || '').split(sourceUrl).join(publicUrl || sourceUrl);
  }
}

export function hydrateInlineImageStorageRefs(html, fallbackBucket) {
  if (!html || typeof DOMParser === 'undefined') return html || '';
  try {
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    doc.querySelectorAll('img').forEach((img) => {
      const currentSrc = img.getAttribute('src') || '';
      let bucket = img.getAttribute('data-storage-bucket') || '';
      let path = img.getAttribute('data-storage-path') || '';
      if (!bucket || !path) {
        const inferred = inferStorageImageRef(currentSrc);
        if (!inferred) return;
        bucket = inferred.bucket || fallbackBucket || '';
        path = inferred.path || '';
        if (bucket) img.setAttribute('data-storage-bucket', bucket);
        if (path) img.setAttribute('data-storage-path', path);
      }
      const nextSrc = getStoragePublicUrl(bucket || fallbackBucket, path);
      if (nextSrc && nextSrc !== currentSrc) img.setAttribute('src', nextSrc);
    });
    return doc.body.innerHTML;
  } catch {
    return html || '';
  }
}

export function attachInlineImageRecovery(container, fallbackBucket) {
  if (!container) return () => {};
  const imgs = Array.from(container.querySelectorAll('img'));
  const cleanups = [];
  imgs.forEach((img) => {
    let bucket = img.getAttribute('data-storage-bucket') || '';
    let path = img.getAttribute('data-storage-path') || '';
    if (!bucket || !path) {
      const inferred = inferStorageImageRef(img.getAttribute('src') || '');
      bucket = inferred?.bucket || bucket || fallbackBucket || '';
      path = inferred?.path || path || '';
      if (bucket) img.setAttribute('data-storage-bucket', bucket);
      if (path) img.setAttribute('data-storage-path', path);
    }
    if (!bucket || !path) return;

    const recover = () => {
      const attempts = Number(img.getAttribute('data-storage-retry-count') || 0);
      if (attempts >= 2) return;
      img.setAttribute('data-storage-retry-count', String(attempts + 1));
      const publicUrl = getStoragePublicUrl(bucket, path);
      if (!publicUrl) return;
      const retryUrl = `${publicUrl}${publicUrl.includes('?') ? '&' : '?'}riemer_retry=${Date.now()}`;
      if (img.getAttribute('src') !== retryUrl) img.setAttribute('src', retryUrl);
    };

    img.addEventListener('error', recover);
    cleanups.push(() => img.removeEventListener('error', recover));
  });
  return () => cleanups.forEach((fn) => fn());
}

export function attachExternalImageFailureLabels(container) {
  if (!container) return () => {};
  const imgs = Array.from(container.querySelectorAll('img'));
  const cleanups = [];
  imgs.forEach((img) => {
    if (!isUnstableExternalImageUrl(img.getAttribute('src') || '')) return;
    const showExpired = () => {
      if (img.dataset.externalExpired === 'true') return;
      img.dataset.externalExpired = 'true';
      const note = document.createElement('span');
      note.className = 'msc-img-expired-note';
      note.textContent = '外部临时图片已失效，请重新上传图片';
      img.insertAdjacentElement('afterend', note);
    };
    if (img.complete && !img.naturalWidth) showExpired();
    img.addEventListener('error', showExpired);
    cleanups.push(() => img.removeEventListener('error', showExpired));
  });
  return () => cleanups.forEach((fn) => fn());
}
