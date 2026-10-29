import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { randomUUID } from 'node:crypto';

async function setup(canWrite = true) {
  let post = { id: 'post', title: '资料', format: 'folder', author: '成员', authorId: 'owner', attachments: [
    { name: 'B.pdf', url: 'https://example.com/b.pdf', size: 20 },
    { id: 'a', name: 'A.pdf', url: 'https://example.com/a.pdf', size: 10 },
  ] };
  let fail = false;
  const recycled = [];
  const context = createContext({ crypto: { randomUUID }, File, FileReader: class {
    readAsDataURL(file) { file.arrayBuffer().then((data) => { this.result = `data:${file.type};base64,${Buffer.from(data).toString('base64')}`; this.onload(); }); }
  } });
  const module = new SourceTextModule(await readFile(new URL('../src/services/memberSharingFolderService.js', import.meta.url), 'utf8'), { context });
  await module.link((path) => {
    const exports = path.includes('memberSharingService') ? {
      fetchSharingById: async (_id, options) => { assert.equal(options.strict, true); if (fail) throw new Error('read failed'); return structuredClone(post); },
      updateSharing: async (_id, update) => {
        const attachments = update.attachments.map((item) => {
          if (!item.dataUrl) return item;
          const { dataUrl, ...rest } = item;
          return { ...rest, url: `https://example.com/${item.id}`, storagePath: `owner/post/${item.id}` };
        });
        post = { ...post, attachments: structuredClone(attachments) };
        return { attachments };
      },
    } : path.includes('recycleBinService') ? { moveToRecycleBin: async ({item}) => { recycled.push(item); return {success:true}; } }
      : path.includes('internalFilesService') ? { sortNodes: (items) => items.sort((a,b) => a.name.localeCompare(b.name)), LINK_MIME:'text/x-url', ZIP_EXTRACT_MAX_BYTES:200*1024*1024 }
      : { hasInternalTextContent: (text) => !!text.trim(), sanitizeInternalTextHtml: (text) => text };
    return new SyntheticModule(Object.keys(exports), function () { for (const [key,value] of Object.entries(exports)) this.setExport(key,value); }, {context});
  });
  await module.evaluate();
  return { api: module.namespace.createMemberSharingFolderService('post', {id:'owner',name:'成员'}, canWrite), post: () => post, recycled, fail: () => {fail=true;} };
}

test('shared folder browser supports legacy files, folders, uploads, metadata, moves and recoverable deletion', async () => {
  const {api,post,recycled,fail} = await setup();
  let page = await api.fetchChildrenPage(null, {limit:1});
  assert.equal(page.items[0].name,'A.pdf'); assert.equal(page.hasMore,true);
  assert.equal((await api.fetchNode('a')).name,'A.pdf');
  assert.equal(await api.fetchNode('missing'),null);
  assert.equal(api.textHref({id:'a'}),'/internal/member-sharing/folder/post/text/a');
  const folder = await api.createFolder(null,'子目录');
  const child = await api.createFolder(folder.id,'下级');
  assert.equal((await api.fetchBreadcrumb(child.id)).length,2);
  await assert.rejects(api.moveNodes([folder],child.id), /下级文件夹/);
  const original = (await api.fetchChildrenPage(null)).items.find((item) => item.name==='B.pdf');
  await api.moveNodes([original],folder.id);
  await api.renameNode(original,'新名称.pdf');
  await api.updateNote(original,'完整备注'); await api.updateContributors(original,'甲、乙');
  page = await api.fetchChildrenPage(folder.id);
  const moved = page.items.find((item) => item.id===original.id);
  assert.equal(moved.note,'完整备注'); assert.equal(moved.contributorsOverride,'甲、乙');
  await api.uploadFiles(folder.id,[new File(['hello'],'新增.txt',{type:'text/plain'})]);
  assert.equal(post().attachments.filter((item) => item.parentId===folder.id).length,3);
  assert.equal((await api.fetchChildrenPage(folder.id)).items.find((item) => item.name==='新增.txt').mimeType,'text/plain');
  await api.createLink(folder.id,{name:'链接',url:'https://example.com'});
  assert.equal((await api.fetchChildrenPage(folder.id)).items.find((item) => item.name==='链接').mimeType,'text/x-url');
  await api.deleteNode(folder);
  assert.equal(post().attachments.length,1);
  assert.equal(recycled.length,1); assert.equal(recycled[0].attachments.length,5);
  assert.equal(recycled[0].attachments.find((item) => item.id===folder.id).parentId,null);
  fail(); await assert.rejects(api.fetchChildrenPage(null), /read failed/);
});

test('read-only sharing folders cannot upload or change contents', async () => {
  const {api,post} = await setup(false);
  assert.equal((await api.fetchChildrenPage(null)).items.length,2);
  await assert.rejects(api.createFolder(null,'禁止'), /贡献者/);
  await assert.rejects(api.uploadFiles(null,[new File(['x'],'x.txt')]), /上传权限/);
  assert.equal(post().attachments.length,2);
});

test('folder trees and rich text publication preserve paths, format and metadata', async () => {
  const {api} = await setup();
  const file = new File(['notes'],'notes.txt',{type:'text/plain'});
  Object.defineProperty(file,'webkitRelativePath',{value:'课程/章节/notes.txt'});
  await api.uploadFolderTree(null,[file]);
  const course = (await api.fetchChildrenPage(null)).items.find((item) => item.name==='课程');
  const chapter = (await api.fetchChildrenPage(course.id)).items[0];
  assert.equal(chapter.name,'章节');
  assert.equal((await api.fetchChildrenPage(chapter.id)).items[0].name,'notes.txt');
  await api.createTextMaterial(chapter.id,{name:'正文',content:'<h1>标题</h1>',format:'word',note:'说明',contributors:'甲'});
  const text = (await api.fetchChildrenPage(chapter.id)).items.find((item) => item.name==='正文.html');
  assert.equal(text.mimeType,'text/x-riemer-html'); assert.equal(text.note,'说明'); assert.equal(text.contributorsOverride,'甲');
  await assert.rejects(api.createTextMaterial(null,{name:'空正文',content:'',format:'markdown'}), /标题和正文/);
});
