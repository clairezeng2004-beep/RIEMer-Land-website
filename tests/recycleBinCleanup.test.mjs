import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import * as assets from '../src/utils/recycledStorageAssets.js';

const base = 'https://our-project.supabase.co/storage/v1/object/public/documents/';
const assetUrl = (bucket, path) => `https://our-project.supabase.co/storage/v1/object/public/${bucket}/${path}`;
const entry = { id: 'rb-1', itemType: 'document', originalId: 'doc-1', payload: {
  attachments: [{ storagePath: 'u/notes.pdf', url: assetUrl('documents', 'u/notes.pdf') }],
  content: `<img src="${assetUrl('documents', 'u/photo.png')}">`,
} };

test('collects nested attachments, inline images and covers, ignores external/unsafe assets, and deduplicates', () => {
  const payload = { ...entry.payload, fileUrl: assetUrl('documents', 'u/notes.pdf'),
    cover: assetUrl('article-covers', 'u/cover.jpg'),
    html: '<img src="broken" data-storage-path="u/inline.png" data-storage-bucket="documents">',
    external: 'https://other-project.supabase.co/storage/v1/object/public/documents/u/foreign.pdf',
    unrelated: assetUrl('avatars', 'u/avatar.png'), data: 'data:image/png;base64,abc',
    unsafe: [{ storagePath: '../bad.pdf' }, { storagePath: { invalid: true } }],
  };
  assert.deepEqual(assets.collectRecycledStorageAssets(payload, base, 'documents').map((a) => `${a.bucket}/${a.path}`).sort(),
    ['article-covers/u/cover.jpg', 'documents/u/inline.png', 'documents/u/notes.pdf', 'documents/u/photo.png']);
  assert.equal(assets.collectRecycledStorageAssets({ fileUrl: assetUrl('documents', 'u/%E4%B8%AD%E6%96%87.pdf?download=x') }, base)[0].path, 'u/中文.pdf');
});

async function service(options = {}) {
  const calls = [];
  let cached = JSON.stringify([entry]);
  const context = createContext({ URL, console, setTimeout, clearTimeout,
    localStorage: { getItem: () => cached, setItem: (_, value) => { cached = value; } } });
  const dbEntry = { id: entry.id, item_type: entry.itemType, original_id: entry.originalId, payload: entry.payload };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'admin' } } }) },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: base } }) }) },
    from(table) {
      let id;
      let deleting = false;
      return {
        select() {
          if (deleting) { calls.push(['delete', table, id]); return Promise.resolve(options.rowError ? { error: new Error('row denied') } : { data: [{ id }] }); }
          return this;
        },
        eq(_, value) { id = value; return this; },
        single: async () => ({ data: { role: options.role || 'admin' } }),
        maybeSingle: async () => table === 'recycle_bin' ? { data: dbEntry }
          : options.snapshotError ? { error: new Error('snapshot failed') }
          : { data: { id, title: '完整文档', content: '完整正文', attachments: entry.payload.attachments } },
        insert: async (row) => { calls.push(['insert', table, row]); return { error: null }; },
        order() { return this; },
        range: async () => options.scanError ? { error: new Error('scan denied') }
          : { data: table === 'documents' && options.shared ? [{ id: 'another', file_url: assetUrl('documents', 'u/notes.pdf') }] : [] },
        delete() { deleting = true; return this; },
      };
    },
  };
  const source = await readFile(new URL('../src/services/recycleBinService.js', import.meta.url), 'utf8');
  const module = new SourceTextModule(source, { context });
  await module.link((specifier) => {
    let exports;
    if (specifier.includes('/supabase')) exports = { supabase, isSupabaseConfigured: true };
    else if (specifier.includes('recycledStorageAssets')) exports = assets;
    else if (specifier.includes('storageCleanupService')) exports = { removeStorageObjects: async (bucket, paths) => {
      calls.push(['storage', bucket, Array.from(paths)]);
      if (options.storageError) throw new Error('storage denied');
    } };
    else if (specifier.includes('memberSharingService')) exports = { addSharing: async () => {} };
    else if (specifier.includes('articleDbService')) exports = { addArticleToDb: async () => {} };
    else if (specifier.includes('documentsService')) exports = { createDoc: async () => {} };
    else exports = { SITE_KEYS: {}, fetchSetting: async () => ({}), saveSetting: async () => ({}) };
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return { api: module.namespace, calls, local: () => JSON.parse(cached) };
}

test('purge protects shared assets, cleans before deleting the row, then clears local cache', async () => {
  const { api, calls, local } = await service({ shared: true });
  const result = await api.purgeItem(entry);
  assert.equal(result.success, true);
  assert.equal(result.shared, 1);
  assert.deepEqual(calls, [['storage', 'documents', ['u/photo.png']], ['delete', 'recycle_bin', 'rb-1']]);
  assert.deepEqual(local(), []);
});

test('storage/scan/row failures preserve the recycle entry; non-admin cannot purge', async () => {
  for (const option of ['storageError', 'scanError', 'rowError']) {
    const { api, calls, local } = await service({ [option]: true });
    assert.equal((await api.purgeItem(entry)).success, false, option);
    assert.equal(local().length, 1, option);
    if (option !== 'rowError') assert.equal(calls.some((c) => c[0] === 'delete'), false, option);
    if (option === 'scanError') assert.equal(calls.length, 0);
  }
  const { api, calls } = await service({ role: 'member' });
  assert.equal((await api.purgeItem(entry)).success, false);
  assert.deepEqual(calls, []);
});

test('recycling a list item hydrates the complete attachment snapshot and stops on read failure', async () => {
  const { api, calls } = await service();
  assert.equal((await api.moveToRecycleBin({ itemType: 'document', item: { id: 'doc-1', title: '列表摘要' } })).success, true);
  const payload = calls.find((c) => c[0] === 'insert')[2].payload;
  assert.equal(payload.content, '完整正文');
  assert.equal(payload.attachments.length, 1);
  const failed = await service({ snapshotError: true });
  assert.equal((await failed.api.moveToRecycleBin({ itemType: 'document', item: { id: 'doc-1' } })).success, false);
  assert.deepEqual(failed.calls, []);
});

test('restore reports row cleanup failures and preserves local recovery metadata', async () => {
  const { api, local } = await service({ rowError: true });
  assert.equal((await api.restoreItem(entry)).success, false);
  assert.equal(local().length, 1);
});

test('storage deletion reports silent non-deletion and supports missing-object retries', async () => {
  for (const mode of ['gone', 'still-present', 'remove-error', 'list-error']) {
    const supabase = { storage: { from: () => ({
      remove: async () => mode === 'remove-error' ? { error: new Error('remove denied') } : {},
      list: async () => mode === 'list-error' ? { error: new Error('list denied') }
        : { data: mode === 'still-present' ? [{ name: 'notes.pdf' }] : [] },
    }) } };
    const mod = new SourceTextModule(await readFile(new URL('../src/services/storageCleanupService.js', import.meta.url), 'utf8'));
    await mod.link(() => new SyntheticModule(['supabase'], function () { this.setExport('supabase', supabase); }));
    await mod.evaluate();
    const promise = mod.namespace.removeStorageObjects('documents', ['u/notes.pdf']);
    if (mode === 'gone') await promise;
    else await assert.rejects(promise);
  }
});

test('large folders and albums collect all storage paths; cleanup failure stops record deletion', async () => {
  for (const kind of ['folder', 'album']) {
    const removed = [];
    const deletes = [];
    let failCleanup = false;
    const rows = Array.from({ length: 501 }, (_, index) => ({ id: String(index),
      storage_path: `u/${index}.jpg`, thumb_path: `u/${index}-thumb.jpg`, is_folder: false }));
    const supabase = { from(table) { let deleting = false; return {
      select() { if (deleting) { deletes.push(table); return Promise.resolve({ data: [{ id: 'root' }] }); } return this; },
      in() { return this; }, eq() { return this; }, order() { return this; },
      range: async (start, end) => ({ data: rows.slice(start, end + 1) }),
      delete() { deleting = true; return this; },
    }; } };
    const file = kind === 'folder' ? 'internalFilesService.js' : 'albumService.js';
    const mod = new SourceTextModule(await readFile(new URL(`../src/services/${file}`, import.meta.url), 'utf8'));
    await mod.link((specifier) => {
      const exports = specifier.includes('storageCleanupService') ? { removeStorageObjects: async (_, paths) => {
        if (failCleanup) throw new Error('cleanup failed');
        removed.push(...paths);
      } } : specifier.includes('supabase') ? { supabase, isSupabaseConfigured: true }
        : specifier === 'pinyin-pro' ? { pinyin: (value) => value } : { parseSharedLink() {}, linkSourceLabel() {} };
      return new SyntheticModule(Object.keys(exports), function () {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
      });
    });
    await mod.evaluate();
    const remove = () => kind === 'folder' ? mod.namespace.deleteNode({ id: 'root', isFolder: true })
      : mod.namespace.deleteAlbum({ id: 'root', _fromDb: true, photos: [] });
    await remove();
    assert.equal(removed.length, kind === 'folder' ? 501 : 1002);
    assert.equal(deletes.length, 1);
    failCleanup = true;
    await assert.rejects(remove(), /cleanup failed/);
    assert.equal(deletes.length, 1);
  }
});
