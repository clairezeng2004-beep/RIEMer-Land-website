// Run: node --experimental-vm-modules --test tests/internalFilesContributors.test.mjs
import { readFile } from 'node:fs/promises';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('contributor edits persist separately, reset to automatic, and report failures', async () => {
  let patch;
  let result = { data: [{ id: 'file' }], error: null };
  const supabase = {
    from(table) {
      assert.equal(table, 'internal_files');
      return {
        update(value) { patch = value; return this; },
        eq(key, value) {
          assert.equal(key, 'id');
          assert.equal(value, 'file');
          return this;
        },
        async select() { return result; },
      };
    },
  };
  const source = await readFile(new URL('../src/services/internalFilesService.js', import.meta.url), 'utf8');
  const service = new SourceTextModule(source);
  await service.link((specifier) => {
    const exports = specifier.includes('supabase')
      ? { supabase, isSupabaseConfigured: true }
      : { parseSharedLink() {}, linkSourceLabel() {} };
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    });
  });
  await service.evaluate();
  const { updateContributors } = service.namespace;
  await updateContributors({ id: 'file' }, ' 张三， 李四;王五 ');
  assert.equal(patch.contributors_override, '张三、李四、王五');
  assert.deepEqual(Object.keys(patch).sort(), ['contributors_override', 'updated_at']);
  await updateContributors({ id: 'file' }, ' 、 ');
  assert.equal(patch.contributors_override, null);
  await assert.rejects(updateContributors({ id: 'file' }, '名'.repeat(501)), /500/);
  result = { data: [], error: null };
  await assert.rejects(updateContributors({ id: 'file' }, '张三'), /只有上传者/);
  result = { data: null, error: new Error('database unavailable') };
  await assert.rejects(updateContributors({ id: 'file' }, '张三'), /database unavailable/);
});


test('publishing persists metadata with files and nested folders, preserving upload ownership', async () => {
  const rows = [];
  const supabase = {
    from() {
      let row;
      return {
        insert(value) { row = value; rows.push(value); return this; },
        select() { return this; },
        async single() { return { data: { ...row, id: `node-${rows.length}` }, error: null }; },
      };
    },
    storage: { from() { return {
      async upload() { return { error: null }; },
      getPublicUrl() { return { data: { publicUrl: 'https://example.com/file' } }; },
    }; } },
  };
  const service = new SourceTextModule(await readFile(new URL('../src/services/internalFilesService.js', import.meta.url), 'utf8'));
  await service.link((specifier) => {
    const exports = specifier.includes('supabase') ? { supabase, isSupabaseConfigured: true }
      : { parseSharedLink: (url) => ({ url }), linkSourceLabel() {} };
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    });
  });
  await service.evaluate();
  const { uploadFiles, uploadFolderTree, createLink } = service.namespace;
  const user = { id: 'uploader', name: '实际上传者' };
  const metadata = { name: '自定义标题.pdf', note: ' 期末资料 ', contributors: '张三, 李四' };
  const result = await uploadFiles('destination', [{ name: 'original.pdf' }], user, null, metadata);
  assert.equal(result.errors.length, 0);
  assert.equal(rows[0].name, '自定义标题.pdf');
  assert.equal(rows[0].note, '期末资料');
  assert.equal(rows[0].contributors_override, '张三、李四');
  assert.equal(rows[0].created_by_id, 'uploader');
  assert.equal(rows[0].parent_id, 'destination');
  rows.length = 0;
  await uploadFolderTree('destination', [{ name: 'a.pdf', webkitRelativePath: '课程/a.pdf' }], user, null,
    { ...metadata, name: '' });
  assert.equal(rows[0].name, '课程');
  assert.equal(rows[1].name, 'a.pdf');
  assert.equal(rows[1].parent_id, 'node-1');
  assert.ok(rows.every((row) => row.contributors_override === '张三、李四' && row.note === '期末资料'));
  await createLink('destination', { name: '链接', url: 'https://example.com', ...metadata }, user);
  assert.equal(rows.at(-1).contributors_override, '张三、李四');
  await createLink('destination', { name: '自动名单', url: 'https://example.com' }, user);
  assert.equal('contributors_override' in rows.at(-1), false);
});
