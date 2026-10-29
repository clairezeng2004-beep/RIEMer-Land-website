export function internalFilePreviewType(file) {
  if (!file?.url || file.isFolder || file.mimeType === 'text/x-url') return null;
  const name = (file.name || '').toLowerCase();
  const mime = (file.mimeType || '').toLowerCase();
  if (mime.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(name)) return 'image';
  // 现有 WordPreview 使用 mammoth，仅支持 docx，不把旧版 doc 误判为可预览。
  if (mime.includes('wordprocessingml') || name.endsWith('.docx')) return 'word';
  return null;
}

// Supabase 通过 download 参数设置响应中的保存文件名，跨域下载也生效。
export function namedInternalFileDownloadUrl(file) {
  try {
    const url = new URL(file.url);
    if (!/^https?:$/.test(url.protocol)
      || !url.pathname.startsWith('/storage/v1/object/public/internal-files/')) return null;
    url.searchParams.set('download', file.name || '附件');
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}
