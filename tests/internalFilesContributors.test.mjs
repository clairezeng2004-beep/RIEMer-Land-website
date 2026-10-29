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
