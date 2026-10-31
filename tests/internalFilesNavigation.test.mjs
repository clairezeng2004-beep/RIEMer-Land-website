import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

// Exercise the page's real loading callbacks with delayed responses, without a browser or extra test framework.
const source = await readFile(new URL('../src/pages/internal/InternalFiles.jsx', import.meta.url), 'utf8');
function callback(name) {
  const start = source.indexOf(`const ${name} = useCallback(`) + `const ${name} = useCallback(`.length;
  return source.slice(start, source.indexOf('\n  }, [', start) + 4);
}
function harness() {
  const state = { items: [{id:'old'}], folderId:null, loading:false, loadingMore:false, hasMore:true, error:'' };
  const requests = [];
  const context = createContext({
    requestRef:{current:0}, inflightRef:{current:false}, CHILDREN_PAGE_SIZE:50,
    console:{error() {}}, readCache:() => null, writeCache() {}, refreshContribs() {},
    sortNodes:(items) => [...items], fetchBreadcrumb:async (id) => [{id}],
    fetchChildrenPage:(id, options) => new Promise((resolve,reject) => requests.push({id,options,resolve,reject})),
  });
  for (const key of ['items','folderId','loadingMore','hasMore']) Object.defineProperty(context,key,{get:() => state[key]});
  for (const name of ['Error','Items','Total','HasMore','Breadcrumb','FolderContribs','Loading','LoadingMore']) {
    const key = name[0].toLowerCase()+name.slice(1);
    context[`set${name}`] = (value) => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  }
  const load = runInContext(`(${callback('load')})`,context);
  const loadMore = runInContext(`(${callback('loadMore')})`,context);
  return {state,requests,context,load,loadMore};
}
const page = (id) => ({items:[{id}],total:1,hasMore:false});

test('navigation starts while a cached folder refresh is pending; stale responses cannot overwrite the latest folder', async () => {
  const h = harness();
  const first = h.load('A');
  const second = h.load('B');
  assert.equal(h.requests.length,2);
  h.requests[1].resolve(page('B-file')); await second;
  h.requests[0].resolve(page('A-file')); await first;
  assert.equal(h.state.items[0].id,'B-file');
  assert.equal(h.state.breadcrumb[0].id,'B');
  assert.equal(h.state.loading,false);
});

test('an old failure must not clear the new loading state or report an error in the new folder', async () => {
  const h = harness();
  const first = h.load('A'); const second = h.load('B');
  h.requests[0].reject(new Error('old failure')); await first;
  assert.equal(h.state.loading,true);
  assert.equal(h.context.inflightRef.current,true);
  assert.equal(h.state.error,'');
  h.requests[1].resolve(page('B-file')); await second;
  assert.equal(h.state.items[0].id,'B-file');
});

test('late pagination cannot append files to another folder; failed navigation clears previous items', async () => {
  const h = harness();
  h.state.folderId='A';
  const more = h.loadMore(); const next = h.load('B');
  h.requests[1].resolve(page('B-file')); await next;
  h.requests[0].resolve(page('A-page-2')); await more;
  assert.equal(h.state.items.length,1);
  assert.equal(h.state.items[0].id,'B-file');
  const failed = h.load('C');
  assert.equal(h.state.items.length,0);
  h.requests[2].reject(new Error('network failure')); await failed;
  assert.equal(h.state.error,'network failure');
  assert.equal(h.state.items.length,0);
});
