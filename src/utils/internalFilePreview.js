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
