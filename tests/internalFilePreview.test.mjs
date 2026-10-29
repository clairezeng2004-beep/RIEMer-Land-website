import { test } from 'node:test';
import assert from 'node:assert/strict';
import { internalFilePreviewType, namedInternalFileDownloadUrl } from '../src/utils/internalFilePreview.js';

test('detects preview formats after renaming and leaves unsupported files undownloaded', () => {
  const file = (name, mimeType = '') => ({ name, mimeType, url: 'https://example.com/file' });
  assert.equal(internalFilePreviewType(file('课程.PDF')), 'pdf');
  assert.equal(internalFilePreviewType(file('课程笔记.txt')), 'text');
  assert.equal(internalFilePreviewType(file('笔记', 'text/plain;charset=utf-8')), 'text');
  assert.equal(internalFilePreviewType(file('重命名资料', 'application/pdf')), 'pdf');
  assert.equal(internalFilePreviewType(file('照片.png')), 'image');
  assert.equal(internalFilePreviewType(file('重命名照片', 'image/jpeg')), 'image');
  assert.equal(internalFilePreviewType(file('资料.DOCX')), 'word');
  assert.equal(internalFilePreviewType(file('资料', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')), 'word');
  assert.equal(internalFilePreviewType(file('旧文档.doc', 'application/msword')), null);
  assert.equal(internalFilePreviewType(file('资料.xlsx')), null);
  assert.equal(internalFilePreviewType(file('资料.zip')), null);
  assert.equal(internalFilePreviewType(file('网盘.pdf', 'text/x-url')), null);
  assert.equal(internalFilePreviewType({ name: 'missing.pdf' }), null);
  assert.equal(internalFilePreviewType({ ...file('folder.pdf'), isFolder: true }), null);
});

test('storage downloads explicitly request the displayed Unicode filename', () => {
  const file = {
    url: 'https://example.supabase.co/storage/v1/object/public/internal-files/u/1730-random.pdf?download=old.pdf#page=2',
    name: '高等数学 期末 & 答案 #1（修改版）.pdf',
  };
  const url = new URL(namedInternalFileDownloadUrl(file));
  assert.equal(url.searchParams.get('download'), file.name);
  assert.equal(url.pathname, '/storage/v1/object/public/internal-files/u/1730-random.pdf');
  assert.equal(url.hash, '');
  assert.equal(new URL(namedInternalFileDownloadUrl({ ...file, name: '已重命名.pdf' })).searchParams.get('download'), '已重命名.pdf');
  assert.equal(namedInternalFileDownloadUrl({ url: 'blob:https://example.com/id', name: '资料.pdf' }), null);
  assert.equal(namedInternalFileDownloadUrl({ url: 'https://example.com/document.pdf' }), null);
  assert.equal(namedInternalFileDownloadUrl({}), null);
});
