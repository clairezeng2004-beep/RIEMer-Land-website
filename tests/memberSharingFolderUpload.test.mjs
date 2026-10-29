import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

test('folder append preserves existing items, deduplicates retries, and preserves cache on failure', async () => {
  let row = { id: 'folder', format: 'folder', title: '资料', attachments: [{ id: 'old', name: '已有文件.pdf', url: 'https://example.com/old.pdf' }] };
  let readError = false;
  let writeError = false;
  let writes = 0;
  const cache = new Map();
  const context = createContext({ console, setTimeout, clearTimeout,
    localStorage: { getItem: (key) => cache.get(key) || null, setItem: (key, value) => cache.set(key, value) } });
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
    from: () => ({
      select() { return this; },
      update(value) { this.value = value; return this; },
      eq() {
        if (!this.value) return this;
        writes++;
        if (writeError) return Promise.resolve({ error: { message: 'write denied' } });
        row = { ...row, ...this.value };
        return Promise.resolve({});
      },
      maybeSingle: async () => readError ? { error: { message: 'read failed' } } : { data: row },
    }),
  };
  const module = new SourceTextModule(await readFile(new URL('../src/services/memberSharingService.js', import.meta.url), 'utf8'), { context });
  await module.link((specifier) => {
    const exports = specifier.includes('supabase') ? { supabase, isSupabaseConfigured: true }
      : { hasUnstableExternalImages: () => false, stampInlineImageStorageRef: () => {} };
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  const api = module.namespace;
  const item = { id: 'new', kind: 'link', type: 'link', name: '新资料', url: 'https://example.com/new' };
  const saved = await api.appendSharingFolderItems('folder', [item]);
  assert.equal(saved.attachments.length, 2);
  assert.equal(saved.attachments[0].name, '已有文件.pdf');
  await api.appendSharingFolderItems('folder', [item]);
  assert.equal(row.attachments.length, 2);
  readError = true;
  const priorWrites = writes;
  await assert.rejects(api.appendSharingFolderItems('folder', [item]), /read failed/);
  assert.equal(writes, priorWrites);
  readError = false;
  writeError = true;
  await assert.rejects(api.appendSharingFolderItems('folder', [{ ...item, id: 'failed' }]), /write denied/);
  assert.equal(JSON.parse(cache.get('riemer_member_sharing'))[0].attachments.length, 2);
  writeError = false;
  row = { ...row, format: 'word' };
  await assert.rejects(api.appendSharingFolderItems('folder', [item]), /文件夹已不存在/);
});
