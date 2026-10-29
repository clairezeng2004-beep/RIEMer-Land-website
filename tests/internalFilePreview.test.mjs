import { test } from 'node:test';
import assert from 'node:assert/strict';
import { internalFilePreviewType } from '../src/utils/internalFilePreview.js';

test('detects preview formats after renaming and leaves unsupported files undownloaded', () => {
  const file = (name, mimeType = '') => ({ name, mimeType, url: 'https://example.com/file' });
  assert.equal(internalFilePreviewType(file('课程.PDF')), 'pdf');
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
