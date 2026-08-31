// ============================================
// RIEMer Land — 文章封面 Storage 服务
// ============================================
// 新上传封面存入公开 bucket；历史 Base64/URL 继续兼容读取。

import { supabase, isSupabaseConfigured } from '../lib/supabase';

export const ARTICLE_COVERS_BUCKET = 'article-covers';
const MAX_COVER_BYTES = 10 * 1024 * 1024;

const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp|gif|avif));base64,([a-z0-9+/=\s]+)$/i;
const MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

export function isImageDataUrl(value) {
  return typeof value === 'string' && DATA_URL_RE.test(value);
}

function dataUrlToBlob(dataUrl) {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) {
    throw new Error('封面图片格式不受支持，请使用 JPG、PNG、WebP、GIF 或 AVIF。');
  }

  const mimeType = match[1].toLowerCase();
  const binary = atob(match[2].replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { blob: new Blob([bytes], { type: mimeType }), mimeType };
}

function createObjectPath(userId, mimeType) {
  const objectId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${userId}/${objectId}.${MIME_EXTENSIONS[mimeType]}`;
}

export async function uploadArticleCover(dataUrl, userId) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase 未配置，封面无法上传到云端。');
  }
  if (!userId) {
    throw new Error('登录信息已失效，请重新登录后上传封面。');
  }

  const { blob, mimeType } = dataUrlToBlob(dataUrl);
  if (blob.size > MAX_COVER_BYTES) {
    throw new Error('封面图片不能超过 10 MB。');
  }
  const path = createObjectPath(userId, mimeType);
  const { error } = await supabase.storage
    .from(ARTICLE_COVERS_BUCKET)
    .upload(path, blob, {
      contentType: mimeType,
      cacheControl: '31536000',
      upsert: false,
    });

  if (error) {
    throw new Error(`封面上传失败：${error.message}`);
  }

  const { data } = supabase.storage.from(ARTICLE_COVERS_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) {
    await removeArticleCover(path);
    throw new Error('封面已上传，但没有生成公开访问地址。');
  }

  return { publicUrl: data.publicUrl, path };
}

export async function removeArticleCover(path) {
  if (!path || !supabase) return { success: true, error: null };
  const { error } = await supabase.storage.from(ARTICLE_COVERS_BUCKET).remove([path]);
  return error
    ? { success: false, error: error.message }
    : { success: true, error: null };
}

export function getManagedArticleCoverPath(value) {
  if (!value || !supabase) return null;
  const { data } = supabase.storage.from(ARTICLE_COVERS_BUCKET).getPublicUrl('');
  const prefix = data?.publicUrl || '';
  return prefix && value.startsWith(prefix)
    ? decodeURIComponent(value.slice(prefix.length)).replace(/^\/+/, '')
    : null;
}
