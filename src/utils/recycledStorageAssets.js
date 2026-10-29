export const RECYCLE_BUCKETS = ['documents', 'member-sharing-attachments', 'article-covers'];
export const RECYCLE_SOURCE_TABLES = {
  document: 'documents', member_sharing: 'member_sharing', article: 'articles',
};
export const RECYCLE_DEFAULT_BUCKETS = {
  document: 'documents', member_sharing: 'member-sharing-attachments', article: 'article-covers',
};

// 仅识别本项目受管的 Storage 对象，忽略外链、Base64 和不安全路径。
export function collectRecycledStorageAssets(value, baseUrl, defaultBucket) {
  const assets = new Map();
  const origin = new URL(baseUrl).origin;
  const add = (bucket, path) => {
    if (!RECYCLE_BUCKETS.includes(bucket) || typeof path !== 'string' || !path || [...path].some((char) => char.codePointAt(0) < 32)
      || path.split('/').some((part) => part === '..' || part === '.')) return;
    assets.set(`${bucket}/${path}`, { bucket, path });
  };
  const visit = (item) => {
    if (typeof item === 'string') {
      for (const match of item.matchAll(/https?:\/\/[^\s<>"'\)\]]+/g)) {
        try {
          const url = new URL(match[0].replace(/&amp;/g, '&'));
          if (url.origin !== origin) continue;
          const parts = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/);
          if (parts) add(parts[1], decodeURIComponent(parts[2]));
        } catch { /* 非法地址不作为删除目标 */ }
      }
      // 正文图片即使 src 已失效，仍可通过上传时保存的属性恢复其路径。
      for (const [tag] of item.matchAll(/<img\b[^>]*>/gi)) {
        const bucket = tag.match(/\bdata-storage-bucket=["']([^"']+)["']/i)?.[1];
        const path = tag.match(/\bdata-storage-path=["']([^"']+)["']/i)?.[1];
        if (bucket && path) add(bucket, path.replace(/&amp;/g, '&'));
      }
    } else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') {
      const bucket = item.bucket || defaultBucket;
      if (item.kind !== 'link' && item.type !== 'link') {
        add(bucket, item.storagePath || item.storage_path);
        add(bucket, item.thumbPath || item.thumb_path);
      }
      Object.values(item).forEach(visit);
    }
  };
  visit(value);
  return [...assets.values()];
}
