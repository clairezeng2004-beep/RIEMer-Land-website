import { supabase } from '../lib/supabase';

const STORAGE_PUBLIC_RE = /\/storage\/v1\/object\/public\/([^/?#]+)\/([^?#]+)/;

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
