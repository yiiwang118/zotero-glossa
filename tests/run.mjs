import { build } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeDocument, findAll, click, change, control } from './test-dom.mjs';
import { cliTests } from './cli-tests.mjs';
import { validateManifest } from '../scripts/manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(root, '.cache'), { recursive: true });
await build({ stdin: { resolveDir: root, contents: `
export * from './src/core/types'; export * from './src/core/store'; export * from './src/core/provider';
export * from './src/core/research'; export * from './src/host/zotero'; export * from './src/ui/panel';
export * from './src/index'; export * from './src/core/api-url';
export * from './src/core/cli'; export * from './src/core/history'; export * from './src/host/process';
export * from './src/ui/commands'; export * from './src/core/i18n';
export * from './src/ui/translation'; export * from './src/core/markdown'; export * from './src/ui/markdown'; export * from './src/ui/math';
` }, bundle: true, loader: { '.css': 'text' }, platform: 'node', format: 'cjs', outfile: path.join(root, '.cache/tests.cjs') });
const m = createRequire(import.meta.url)(path.join(root, '.cache/tests.cjs'));
const endpoint = { id: 'api', name: 'Fixture', baseUrl: 'https://example.test/v1', model: 'fixture-model', models: ['fixture-model'], apiStyle: 'openai', encryptedKey: '', effort: '' };
const paper = { libraryID: 1, key: 'PAPER001' };
const source = { id: 'S1', item: paper, title: 'Fixture paper', kind: 'selection', text: 'Evidence', attachmentKey: 'PDF00001', pageIndex: 3, pageLabel: 'iv' };
const snapshot = { items: [paper], titles: ['Fixture paper'], sources: [source], warnings: [] };
const copy = v => JSON.parse(JSON.stringify(v));
const deferred = () => { let resolve; let reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
async function until(predicate) { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 2)); } throw new Error('Timed out'); }
function sse(values, splits = 3) {
  const bytes = new TextEncoder().encode(values.map(v => `data: ${typeof v === 'string' ? v : JSON.stringify(v)}\r\n\r\n`).join(''));
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += splits) controller.enqueue(bytes.slice(i, i + splits));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}
const success = () => sse([{ choices: [{ delta: { content: '研究结论 [S1]' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, '[DONE]']);
async function chunks(response, ep = endpoint, signal = new AbortController().signal) {
  const out = []; for await (const chunk of m.stream(ep, '', 'System', [{ role: 'user', content: 'Question' }], signal, async () => response)) out.push(chunk); return out;
}
async function collect(response, ep = endpoint, signal) {
  return (await chunks(response, ep, signal)).filter(c => c.type === 'text').map(c => c.text).join('');
}
function fixture() {
  const writes = []; const notes = []; const requests = [];
  const store = new m.Store({ read: async () => null, write: async value => { writes.push(JSON.parse(value)); } });
  store.state.settings.endpoints = [copy(endpoint)]; store.state.settings.endpointID = 'api';
  const host = { snapshot: async () => copy(snapshot), controller: () => new AbortController(), decrypt: async value => value,
    encrypt: async value => `encrypted:${value}`, sourceURL: () => 'zotero://open-pdf/library/items/PDF00001?page=4', openSource: async () => {},
    saveNote: async (target, html) => { notes.push({ target, html }); return { libraryID: 1, key: 'NOTE0001' }; } };
  const fetcher = async (url, init) => { requests.push({ url, init }); return success(); };
  const research = new m.Research(store, host, fetcher);
  return { store, host, research, writes, notes, requests, fetcher };
}
function concurrentFixture() {
  const f = fixture(); const streams = [];
  const fetcher = async (_url, init) => new Response(new ReadableStream({ start(controller) {
    const value = { signal: init.signal, chunk(text) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)); },
      finish() { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n')); controller.close(); } };
    streams.push(value); value.chunk(`partial-${streams.length}`);
    init.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
  } }), { headers: { 'content-type': 'text/event-stream' } });
  const research = new m.Research(f.store, f.host, fetcher);
  const view = () => { const doc = new FakeDocument(); const body = doc.createElementNS('', 'div');
    const panel = new m.Panel(body, research, fetcher, { openWorkspace() {} }); panel.setContext([paper], ['Fixture']);
    return { panel, body, doc, button: text => control(body, text) }; };
  return { ...f, research, streams, view };
}

test('Zotero install manifest rejects missing required fields before packaging', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'addon/manifest.json'), 'utf8'));
  validateManifest(manifest);
  for (const field of ['id', 'update_url', 'strict_min_version', 'strict_max_version']) {
    const invalid = copy(manifest); delete invalid.applications.zotero[field];
    assert.throws(() => validateManifest(invalid), new RegExp(field));
  }
  const invalid = copy(manifest); invalid.applications.zotero.update_url = 'http://example.test/updates.json';
  assert.throws(() => validateManifest(invalid), /HTTPS/);
});
test('API URL normalization supports OpenAI and Anthropic endpoints', () => {
  assert.equal(m.customApiUrl(endpoint), 'https://example.test/v1/chat/completions');
  assert.equal(m.customApiUrl({ baseUrl: 'https://a.test', apiStyle: 'anthropic' }), 'https://a.test/v1/messages');
  assert.equal(m.customApiUrl({ baseUrl: 'https://a.test/v1/messages', apiStyle: 'anthropic' }, 'models'), 'https://a.test/v1/models');
});
test('reject unsafe endpoints before attaching credentials', () => {
  for (const baseUrl of ['file:///tmp/test', 'http://remote.test/v1', 'https://user:pass@host.test/v1', 'https://host.test/v1?key=secret']) assert.throws(() => m.validateEndpoint({ ...endpoint, baseUrl }));
  m.validateEndpoint({ ...endpoint, baseUrl: 'http://127.0.0.1:1234/v1' });
});
test('OpenAI SSE decodes fragmented Chinese UTF-8, ignores reasoning, completes once', async () => {
  const streamed = await chunks(sse([{ choices: [{ delta: { reasoning_content: '先想', content: '你好' } }] }, { choices: [{ delta: { content: '世界' }, finish_reason: 'stop' }] }], 1));
  assert.equal(streamed.filter(c => c.type === 'text').map(c => c.text).join(''), '你好世界');
  assert.equal(streamed.filter(c => c.type === 'reasoning').map(c => c.text).join(''), '先想', 'Reasoning is a separate, visible channel');
  assert.deepEqual(streamed[0], { type: 'status', status: 'connected' });
});
test('Anthropic stream extracts text only and requires terminal event', async () => {
  const events = [{ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'private' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'answer' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }];
  assert.equal(await collect(sse(events), { ...endpoint, apiStyle: 'anthropic' }), 'answer');
  await assert.rejects(collect(sse(events.slice(0, 2)), { ...endpoint, apiStyle: 'anthropic' }), /提前关闭/);
});
test('SSE multiline framing, comments and final line without delimiter', () => {
  const d = new m.SSEDecoder();
  assert.deepEqual(d.push(': heartbeat\n\nevent: chunk\ndata: {\ndata: "x": 1}\n\n'), ['{\n"x": 1}']);
  assert.deepEqual(d.push('data: [DONE]', true), ['[DONE]']);
});
test('error frames, malformed JSON, truncated output and HTTP errors fail visibly', async () => {
  await assert.rejects(collect(sse([{ error: { message: 'secret' } }])), /数据流返回错误/);
  await assert.rejects(collect(sse(['{bad'])), SyntaxError);
  await assert.rejects(collect(sse([{ choices: [{ delta: { content: 'partial' }, finish_reason: 'length' }] }])), /输出长度上限/);
  await assert.rejects(collect(sse([{ choices: [{ delta: { content: 'partial' }, finish_reason: 'tool_calls' }] }])), /未完整结束/);
  await assert.rejects(collect(new Response('secret key', { status: 401 })), error => !error.message.includes('secret') && /401/.test(error.message));
  // Structured provider messages are surfaced for diagnosis, bounded, with the key masked; raw HTML is never echoed.
  const json = JSON.stringify({ error: { message: `The model \`nope\` does not exist (key sk-test-SECRET-12345)${'x'.repeat(400)}` } });
  const failure = await m.stream({ ...endpoint }, 'sk-test-SECRET-12345', 'S', [{ role: 'user', content: 'Q' }], new AbortController().signal,
    async () => new Response(json, { status: 404 })).next().catch(error => error);
  assert.match(failure.message, /HTTP 404[\s\S]*does not exist/); assert.ok(!failure.message.includes('SECRET')); assert.ok(failure.message.length < 400);
  assert.equal(m.serviceDetail('<html><body>proxy secret</body></html>', 'k'), '');
});
test('DeepSeek thinking switch, split think tags, keep-alive queue status and reasoning-only replies', async () => {
  const ds = { ...endpoint, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash' };
  assert.deepEqual(m.effortOptions(ds), ['off', 'low', 'high', 'max']);
  assert.deepEqual(m.requestBody(ds, 'S', []).thinking, { type: 'enabled' }); assert.equal(m.requestBody(ds, 'S', []).reasoning_effort, undefined);
  assert.deepEqual(m.requestBody({ ...ds, effort: 'off' }, 'S', []).thinking, { type: 'disabled' });
  assert.equal(m.requestBody({ ...ds, effort: 'max' }, 'S', []).reasoning_effort, 'max');
  assert.deepEqual(m.requestBody(ds, 'S', [], { purpose: 'translate' }).thinking, { type: 'disabled' }, 'Quick translation skips thinking by default');
  assert.equal(m.requestBody({ ...endpoint, effort: 'off' }, 'S', []).reasoning_effort, undefined);
  assert.equal(m.requestBody(endpoint, 'S', []).thinking, undefined, 'Other services never receive DeepSeek-only fields');
  const tagged = await chunks(sse([{ choices: [{ delta: { content: '<thi' } }] }, { choices: [{ delta: { content: 'nk>first, ' } }] },
    { choices: [{ delta: { content: 'then</th' } }] }, { choices: [{ delta: { content: 'ink>\n\nAnswer' }, finish_reason: 'stop' }] }], 5));
  assert.equal(tagged.filter(c => c.type === 'text').map(c => c.text).join(''), 'Answer');
  assert.equal(tagged.filter(c => c.type === 'reasoning').map(c => c.text).join(''), 'first, then');
  const queued = new Response(': keep-alive\n\n: keep-alive\n\ndata: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    { headers: { 'content-type': 'text/event-stream' } });
  const statuses = (await chunks(queued)).filter(c => c.type === 'status').map(c => c.status);
  assert.deepEqual(statuses, ['connected', 'queued']);
  await assert.rejects(collect(sse([{ choices: [{ delta: { reasoning_content: 'only thinking' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }])), /只返回了思考过程/);
  const anthropic = await chunks(sse([{ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'plan' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'done' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }]), { ...endpoint, apiStyle: 'anthropic' });
  assert.deepEqual(anthropic.filter(c => c.type !== 'status'), [{ type: 'reasoning', text: 'plan' }, { type: 'text', text: 'done' }]);
  const busy = await m.stream(ds, 'k', 'S', [], new AbortController().signal, async () => Response.json({ error: { message: 'Service is too busy.' } }, { status: 503 })).next().catch(e => e);
  assert.match(busy.message, /HTTP 503[^]*繁忙[^]*Service is too busy/);
});
test('JSON responses and both protocol effort parameters work', async () => {
  assert.equal(await collect(Response.json({ choices: [{ message: { content: 'JSON reply' }, finish_reason: 'stop' }] })), 'JSON reply');
  assert.equal(await collect(Response.json({ content: [{ type: 'text', text: 'Claude' }], stop_reason: 'end_turn' }), { ...endpoint, apiStyle: 'anthropic' }), 'Claude');
  assert.equal(m.requestBody({ ...endpoint, effort: 'high' }, 's', []).reasoning_effort, 'high');
  assert.deepEqual(m.requestBody({ ...endpoint, apiStyle: 'anthropic', effort: 'high' }, 's', []).output_config, { effort: 'high' });
  assert.equal(m.requestBody(endpoint, 's', []).reasoning_effort, undefined);
});
test('model discovery deduplicates, respects cancellation and omits cookies/redirects', async () => {
  let init;
  const controller = new AbortController();
  const models = await m.discoverModels(endpoint, 'key', controller.signal, async (_url, options) => { init = options; return Response.json({ data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }] }); });
  assert.deepEqual(models, ['a', 'b']); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
  assert.equal(init.signal, controller.signal);
  controller.abort();
  await assert.rejects(m.discoverModels(endpoint, 'key', controller.signal, async (_url, options) => { options.signal.throwIfAborted(); return Response.json({ data: [] }); }), /abort/i);
});
test('corrupted and future storage stays untouched; interrupted messages become stopped', async () => {
  let writes = 0;
  const store = new m.Store({ read: async () => '{broken', write: async () => { writes++; } });
  await assert.rejects(store.load()); assert.equal(writes, 0);
  assert.throws(() => m.parseState('{"version":2}'), /不支持/);
  const f = fixture(); const c = f.store.newConversation([paper]);
  c.messages.push({ id: 'x', role: 'assistant', text: 'partial', status: 'streaming', sources: [source], createdAt: 0 });
  assert.equal(m.parseState(JSON.stringify(f.store.state)).conversations[0].messages[0].status, 'stopped');
});
test('serialized saves keep their snapshots and recover after a disk failure', async () => {
  const gate = deferred(); const values = []; let first = true;
  const store = new m.Store({ read: async () => null, write: async value => { if (first) { first = false; await gate.promise; throw new Error('disk full'); } values.push(JSON.parse(value)); } });
  const a = store.save(); store.state.settings.language = 'English'; const b = store.save();
  gate.resolve(); await assert.rejects(a, /disk full/); await b; assert.equal(values[0].settings.language, 'English');
});
test('removing folders never deletes conversations', () => {
  const { store } = fixture(); store.state.folders.push({ id: 'f', name: 'Research' });
  const c = store.newConversation(); c.folderID = 'f'; store.removeFolder('f');
  assert.equal(store.state.conversations.length, 1); assert.equal(c.folderID, '');
});
test('complete chat stores sources, endpoint snapshot and user message', async () => {
  const f = fixture(); const c = f.store.newConversation();
  await f.research.run(c, 'Summarize', [paper], undefined, endpoint, 'plan', () => {});
  assert.equal(c.messages[1].status, 'complete'); assert.equal(c.messages[1].text, '研究结论 [S1]');
  assert.deepEqual(c.items, [paper]); assert.deepEqual(c.messages[1].sources, [source]);
  const body = JSON.parse(f.requests[0].init.body); assert.match(body.messages[0].content, /untrusted/); assert.match(body.messages[1].content, /Evidence/);
  assert.equal(f.research.busy(c.id), false); assert.ok(f.writes.length >= 2);
});
test('changing paper/model while reading cannot retarget the active turn', async () => {
  const f = fixture(); const gate = deferred(); let received;
  f.host.snapshot = async refs => { received = copy(refs); await gate.promise; return copy(snapshot); };
  const c = f.store.newConversation(); const refs = [copy(paper)]; const ep = copy(endpoint);
  const task = f.research.run(c, 'Question', refs, undefined, ep, 'act', () => {});
  refs[0].key = 'OTHER001'; ep.model = 'other'; gate.resolve(); await task;
  assert.deepEqual(received, [paper]); assert.equal(JSON.parse(f.requests[0].init.body).model, endpoint.model);
});
test('double submit is rejected; stopping before extraction finishes sends nothing', async () => {
  const f = fixture(); const gate = deferred(); f.host.snapshot = async () => { await gate.promise; return copy(snapshot); };
  const c = f.store.newConversation(); const task = f.research.run(c, 'One', [paper], undefined, endpoint, 'plan', () => {});
  await assert.rejects(f.research.run(c, 'Two', [paper], undefined, endpoint, 'plan', () => {}), /等待/);
  f.research.stop(c.id); gate.resolve(); await task; assert.equal(f.requests.length, 0); assert.equal(c.messages.length, 0);
});
test('shutdown never waits indefinitely for native PDF extraction', async () => {
  const f = fixture(); f.host.snapshot = () => new Promise(() => {});
  const c = f.store.newConversation(); const task = f.research.run(c, 'One', [paper], undefined, endpoint, 'plan', () => {});
  await f.research.shutdown(); await task;
  assert.equal(f.requests.length, 0); assert.equal(f.research.busy(c.id), false);
});
test('cancelling a live response retains partial output and closes stream', async () => {
  const f = fixture(); let cancelled = false;
  const research = new m.Research(f.store, f.host, async (_url, init) => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
    init.signal.addEventListener('abort', () => { cancelled = true; controller.error(new DOMException('Aborted', 'AbortError')); });
  } }), { headers: { 'content-type': 'text/event-stream' } }));
  const c = f.store.newConversation(); const task = research.run(c, 'One', [paper], undefined, endpoint, 'plan', () => {});
  await until(() => c.messages[1]?.text === 'partial'); research.stop(c.id); await task;
  assert.equal(c.messages[1].status, 'stopped'); assert.equal(c.messages[1].text, 'partial'); assert.ok(cancelled);
});
test('note save requires Act, valid target, completed answer, prevents duplicate clicks', async () => {
  const f = fixture(); const c = f.store.newConversation(); await f.research.run(c, 'Q', [paper], undefined, endpoint, 'act', () => {});
  const answer = c.messages[1];
  await assert.rejects(f.research.saveAsNote(answer, paper, 'Title', 'plan'), /Act/);
  await assert.rejects(f.research.saveAsNote(answer, { libraryID: 1, key: 'OTHER001' }, 'Title', 'act'), /来自/);
  const gate = deferred(); f.host.saveNote = async () => { await gate.promise; return { libraryID: 1, key: 'NOTE0001' }; };
  const first = f.research.saveAsNote(answer, paper, 'Title', 'act');
  await assert.rejects(f.research.saveAsNote(answer, paper, 'Title', 'act'), /已经保存/); gate.resolve(); await first;
  await assert.rejects(f.research.saveAsNote(answer, paper, 'Title', 'act'), /已经保存/);
});
test('note HTML escapes hostile content and refuses external source links', () => {
  const html = m.noteHTML('<script>', '<img src=x onerror=alert(1)>\n\n**Summary**', [source], () => 'zotero://open-pdf/library/items/PDF00001?page=4');
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img ')); assert.match(html, /&lt;img/); assert.match(html, /zotero:\/\/open-pdf/);
  assert.throws(() => m.noteHTML('title', 'text', [source], () => 'javascript:alert(1)'), /无效/);
});
test('incomplete turns are excluded from bounded history', () => {
  const { store } = fixture(); const c = store.newConversation();
  for (let i = 0; i < 10; i++) c.messages.push({ role: 'user', text: `Q${i}` }, { role: 'assistant', text: `A${i}`, status: i === 9 ? 'stopped' : 'complete' });
  const history = m.promptHistory(c, 'now'); assert.equal(history.length, 13); assert.equal(history[0].content, 'Q3'); assert.equal(history.at(-1).content, 'now');
});

function hostFixture() {
  const db = new Map(); const saved = []; const opened = [];
  const item = (id, key, kind = 'regular', parentID = false) => ({ id, key, libraryID: 1, parentID, parentKey: false, deleted: false,
    isRegularItem: () => kind === 'regular', isAttachment: () => kind === 'attachment', isAnnotation: () => kind === 'annotation', isNote: () => kind === 'note',
    isPDFAttachment: () => kind === 'attachment', isEPUBAttachment: () => false, isSnapshotAttachment: () => false, isEditable: () => true,
    getBestAttachments: async () => [db.get(2)],
    getCreators: () => [{ firstName: 'Test', lastName: 'Author' }], getField: field => field === 'title' ? 'Test paper' : '',
    getAttachments: () => [2], getAnnotations: () => [], getNotes: () => [], getNote: () => '<p>Note</p>',
    setNote(html) { this.html = html; }, async saveTx() { this.id = 4; this.key = 'NOTE0001'; saved.push(this); return 4; } });
  db.set(1, item(1, 'PAPER001')); db.set(2, item(2, 'PDF00001', 'attachment', 1));
  globalThis.Zotero = {
    Items: { get: id => db.get(id) || false, getAsync: async id => db.get(id) || false, loadDataTypes: async () => {},
      getByLibraryAndKeyAsync: async (libraryID, key) => [...db.values()].find(i => i.libraryID === libraryID && i.key === key) || false },
    Libraries: { get: () => ({ libraryType: 'user', editable: true }) }, Groups: { getByLibraryID: () => false },
    PDFWorker: { getFullText: async () => ({ text: 'Full text', extractedPages: 40, totalPages: 80 }) },
    Reader: { open: async (...args) => { opened.push(args); } },
    getActiveZoteroPane: () => ({ selectItem: async () => {} }),
    getMainWindow: () => ({ AbortController }),
    Item: function () { return item(0, '', 'note'); },
    OSKeyStore: { encrypt: async v => `enc:${v}`, isEncrypted: v => v.startsWith('enc:'), decrypt: async v => v.slice(4) },
  };
  return { db, saved, opened, host: new m.ZoteroHost() };
}
test('Zotero adapter resolves parent and stable page location, bounds PDF extraction', async () => {
  const f = hostFixture();
  const result = await f.host.snapshot([paper], { attachment: { libraryID: 1, key: 'PDF00001' }, text: 'Selected text', pageIndex: 3, pageLabel: 'iv' }, true, new AbortController().signal);
  assert.deepEqual(result.items, [paper]); assert.equal(result.sources.find(s => s.kind === 'selection').pageIndex, 3);
  assert.equal(result.sources.find(s => s.kind === 'fulltext').pageIndex, undefined); assert.match(result.warnings.join(), /40 \/ 80/);
  await f.host.openSource(source); assert.deepEqual(f.opened[0], [2, { pageIndex: 3 }]);
  assert.equal(f.host.sourceURL(source), 'zotero://open-pdf/library/items/PDF00001?page=4');
});
test('missing full text is explicit, metadata survives; deleted targets cannot be written', async () => {
  const f = hostFixture(); Zotero.PDFWorker.getFullText = async () => { throw new Error('Missing'); };
  const result = await f.host.snapshot([paper], undefined, true, new AbortController().signal);
  assert.ok(result.sources.some(s => s.kind === 'metadata')); assert.match(result.warnings.join(), /暂不可读/);
  f.db.get(1).deleted = true; await assert.rejects(f.host.saveNote(paper, '<p>note</p>'), /回收站/); assert.equal(f.saved.length, 0);
});
test('uncached annotation text and positions are explicitly hydrated before reading', async () => {
  const f = hostFixture(); let hydrated = false;
  f.db.set(3, { id: 3, key: 'ANNOT001', deleted: false, annotationPageLabel: '7',
    get annotationText() { assert.ok(hydrated, 'annotation data must be loaded'); return 'Evidence from annotation'; },
    get annotationComment() { assert.ok(hydrated); return 'Comment'; },
    get annotationPosition() { assert.ok(hydrated); return '{"pageIndex":6}'; },
  });
  f.db.get(2).getAnnotations = (includeTrashed, asIDs) => { assert.equal(includeTrashed, false); assert.equal(asIDs, true); return [3]; };
  Zotero.Items.loadDataTypes = async (items, types) => { if (items[0].id === 3) { assert.deepEqual(types, ['annotation', 'annotationDeferred']); hydrated = true; } };
  const result = await f.host.snapshot([paper], undefined, false, new AbortController().signal);
  const annotation = result.sources.find(s => s.kind === 'annotation');
  assert.equal(annotation.annotationKey, 'ANNOT001'); assert.equal(annotation.pageIndex, 6);
});
test('EPUB and web snapshots use Zotero full-text index; metadata omits empty fields', async () => {
  const f = hostFixture(); const epub = f.db.get(2);
  epub.isPDFAttachment = () => false; epub.isEPUBAttachment = () => true;
  let indexed = 'Chapter one text from the index'; Object.defineProperty(epub, 'attachmentText', { get: async () => indexed });
  Zotero.PDFWorker.getFullText = async () => { throw new Error('PDF worker must not read EPUB'); };
  const result = await f.host.snapshot([paper], undefined, true, new AbortController().signal);
  assert.equal(result.sources.find(s => s.kind === 'fulltext').text, 'Chapter one text from the index');
  const metadata = result.sources.find(s => s.kind === 'metadata').text;
  assert.match(metadata, /标题：Test paper/); assert.ok(!/DOI|URL|摘要/.test(metadata), metadata);
  indexed = '';
  const empty = await f.host.snapshot([paper], undefined, true, new AbortController().signal);
  assert.match(empty.warnings.join(), /全文索引/);
});
test('note creation uses native transaction and checks read-only libraries at save time', async () => {
  const f = hostFixture(); Zotero.Libraries.get = () => ({ libraryType: 'group', editable: false });
  await assert.rejects(f.host.saveNote(paper, '<p>note</p>'), /权限/); assert.equal(f.saved.length, 0);
  Zotero.Libraries.get = () => ({ libraryType: 'user', editable: true });
  const ref = await f.host.saveNote(paper, '<p>note</p>'); assert.equal(ref.key, 'NOTE0001'); assert.equal(f.saved[0].parentKey, paper.key);
});
test('API keys never fall back to plaintext on encryption failure', async () => {
  const { host } = hostFixture(); assert.equal(await host.encrypt('secret'), 'enc:secret');
  Zotero.OSKeyStore.encrypt = async v => v;
  await assert.rejects(host.encrypt('secret'), /无法加密/); await assert.rejects(host.decrypt('plaintext'), /格式无效/);
});
function controllableStream() {
  let controller; const encoder = new TextEncoder(); const bodies = [];
  const fetcher = async (_url, init) => { bodies.push(JSON.parse(init.body)); return new Response(new ReadableStream({ start(c) { controller = c; } }), { headers: { 'content-type': 'text/event-stream' } }); };
  const push = delta => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`));
  const finish = () => { controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n')); controller.close(); };
  return { fetcher, bodies, push, finish, ready: () => !!controller };
}
test('visible reasoning is stored apart from the answer, reported as a phase and never sent back', async () => {
  const f = fixture(); const live = controllableStream(); const statuses = [];
  const research = new m.Research(f.store, f.host, live.fetcher); const c = f.store.newConversation([paper]);
  const run = research.run(c, 'Question', [paper], undefined, endpoint, 'plan', s => statuses.push(s));
  await until(live.ready); live.push({ reasoning_content: '先检查摘要' }); live.push({ content: '答案' }); live.finish(); await run;
  assert.equal(c.messages[1].reasoning, '先检查摘要'); assert.equal(c.messages[1].text, '答案');
  assert.ok(statuses.includes('已连接，等待模型输出…') && statuses.includes('思考中…') && statuses.includes('正在回答…'), statuses.join(' | '));
  assert.equal(m.parseState(JSON.stringify(f.store.state)).conversations[0].messages[1].reasoning, '先检查摘要');
  assert.match(m.conversationMarkdown(c, () => 'zotero://x'), /<details><summary>思考过程/);
  const next = research.run(c, 'Follow-up', [paper], undefined, endpoint, 'plan', () => {});
  await until(() => live.bodies.length === 2); live.push({ content: 'ok' }); live.finish(); await next;
  assert.ok(!JSON.stringify(live.bodies[1].messages).includes('先检查摘要'), 'Reasoning never becomes model context');
});
test('panel shows thinking live, folds it when the answer starts, and shows a live activity line', async () => {
  const f = fixture(); const live = controllableStream(); const research = new m.Research(f.store, f.host, live.fetcher);
  const doc = new FakeDocument(); const body = doc.createElementNS('', 'div');
  const panel = new m.Panel(body, research, live.fetcher, { openWorkspace() {} }); panel.setContext([paper], ['Fixture']);
  panel.setSelectionPrompt('Think first'); click(control(body, '发送'));
  await until(live.ready);
  const card = () => findAll(body, n => n.tagName === 'details' && n.className.includes('glossa-reasoning'))[0];
  const activity = () => findAll(body, n => n.className === 'glossa-activity')[0];
  live.push({ reasoning_content: '第一步：读摘要' });
  await until(() => card() && !card().hidden && body.textContent.includes('第一步'));
  assert.equal(card().open, true, 'Thinking is visible while it happens'); assert.equal(activity().hidden, false);
  assert.match(activity().textContent, /思考中/);
  await new Promise(r => setTimeout(r, 70)); live.push({ content: '最终答案' });
  await until(() => body.textContent.includes('最终答案'));
  assert.equal(card().open, false, 'Thinking folds once the answer starts'); assert.match(card().textContent, /思考过程 · \d+ 字/);
  live.finish(); await until(() => !research.busy(f.store.state.conversations[0].id));
  assert.equal(activity().hidden, true); panel.dispose();
});
test('a selection offered by the reader appears above the composer and is sent only when asked', async () => {
  const f = fixture(); const seen = []; f.host.snapshot = async (items, selection) => { seen.push(selection); return copy(snapshot); };
  const doc = new FakeDocument(); const body = doc.createElementNS('', 'div');
  const panel = new m.Panel(body, f.research, f.fetcher, { openWorkspace() {} }); panel.setContext([paper], ['Fixture paper']);
  const selection = { attachment: { libraryID: 1, key: 'PDF00001' }, text: 'Selected passage from the reader', pageLabel: '3' };
  panel.offerSelection(selection, 'Another paper');
  const card = findAll(body, n => n.className === 'glossa-selection-card')[0];
  assert.equal(card.hidden, false); assert.match(card.textContent, /Selected passage/); assert.match(card.textContent, /第 3 页/); assert.match(card.textContent, /来自：Another paper/);
  assert.match(findAll(body, n => n.tagName === 'textarea')[0].placeholder, /询问选中内容/);
  assert.equal(f.requests.length, 0, 'Offering a selection sends nothing');
  panel.setSelectionPrompt('Explain this'); click(control(body, '发送'));
  await until(() => seen.length === 1); assert.equal(seen[0].text, selection.text);
  click(control(body, '移除选区')); assert.equal(card.hidden, true); panel.dispose();
});
test('answers render LaTeX as MathML and handle rules, emphasis, nested lists and quotes', () => {
  const MATHML = 'http://www.w3.org/1998/Math/MathML';
  const doc = new FakeDocument();
  const text = ['设计了 **Mamba-2**，元素为 $C_j^\\top A_j \\cdots A_{i+1} B_i$；价格 $5 和 $10 不是公式，代码 `$x$` 也不是。', '',
    '$$', 'y = Mx', '$$', '', '---', '', '*强调* 与 \\(a^2\\)', '', '1. 第一', '   - 子项 $x$', '2. 第二', '', '3. 第三', '',
    '> 引用一', '> 引用二', '', '$$\\frac{a}{b}$$', '', '$\\badmacro{x}$ 坏公式'].join('\n');
  const root = m.renderAnswer(doc, text, [], () => {});
  const maths = findAll(root, n => n.tagName === 'math');
  assert.equal(maths.length, 5); assert.ok(maths.every(n => n.namespaceURI === MATHML));
  assert.ok(findAll(root, n => n.tagName === 'msubsup').length, 'C_j^⊤ becomes a sub/superscript');
  assert.equal(findAll(root, n => n.className === 'glossa-math glossa-math-block').length, 2);
  assert.match(root.textContent, /价格 \$5 和 \$10 不是公式/); assert.equal(findAll(root, n => n.tagName === 'code')[0].textContent, '$x$');
  assert.equal(findAll(root, n => n.tagName === 'hr').length, 1); assert.ok(!root.textContent.includes('---'));
  assert.equal(findAll(root, n => n.tagName === 'em')[0].textContent, '强调');
  const ordered = findAll(root, n => n.tagName === 'ol');
  assert.equal(findAll(ordered[0], n => n.tagName === 'ul').length, 1, 'Indented items nest'); assert.equal(ordered[1].getAttribute('start'), '3');
  assert.equal(findAll(root, n => n.tagName === 'blockquote').length, 1, 'Consecutive quote lines form one quote');
  const bad = findAll(root, n => n.className === 'glossa-math-error')[0]; assert.equal(bad.textContent, '$\\badmacro{x}$'); assert.match(bad.title, /badmacro/);
  for (const node of maths.flatMap(n => findAll(n, () => true))) {
    if (node.tagName) assert.equal(node.namespaceURI, MATHML, node.tagName);
    for (const name of node.attributes.keys()) assert.ok(!/^on|href|src|xlink/i.test(name), name);
  }
  // Untrusted commands never reach the page; streaming display math waits for its closing delimiter without eating later text.
  assert.equal(findAll(m.renderAnswer(doc, '$\\href{https://x.test}{a}$', [], () => {}), n => n.tagName === 'math').length, 0);
  assert.deepEqual(m.markdownBlocks('前文\n\n$$\ny = ').map(b => b.kind), ['paragraph', 'code']);
  assert.deepEqual(m.markdownBlocks('$$\nx\n\n后文').map(b => b.kind), ['code', 'paragraph']);
  assert.deepEqual(m.inlineParts('a $$b$$ c').map(p => p.kind), ['text', 'math', 'text']);
  assert.match(m.systemPrompt('plan', 'English'), /LaTeX[^]*\$\.\.\.\$[^]*\$\$\.\.\.\$\$/);
});
test('notes keep formulas in Zotero note math format', () => {
  const source = { id: 'S1', kind: 'metadata', title: 'P', excerpt: '', item: paper };
  const html = m.noteHTML('t', '公式 $a<b^2$\n\n$$\\sum_i a_i$$\n\n---\n\n- a\n  - b\n\n*注*', [source], () => 'zotero://select/library/items/PAPER001');
  assert.match(html, /<span class="math">\$a&lt;b\^2\$<\/span>/); assert.match(html, /<pre class="math">\$\$\\sum_i a_i\$\$<\/pre>/);
  assert.match(html, /<hr>/); assert.match(html, /<ul><li>a<ul><li>b<\/li><\/ul><\/li><\/ul>/); assert.match(html, /<em>注<\/em>/);
});
test('a failed answer shows its error once, in the answer card', async () => {
  const f = fixture(); const doc = new FakeDocument(); const body = doc.createElementNS('', 'div');
  const fetcher = async () => Response.json({ error: { message: 'Service is too busy.' } }, { status: 503 });
  const research = new m.Research(f.store, f.host, fetcher);
  const panel = new m.Panel(body, research, fetcher, { openWorkspace() {} }); panel.setContext([paper], ['Fixture paper']);
  panel.setSelectionPrompt('Summarize'); click(control(body, '发送'));
  const c = () => f.store.state.conversations[0];
  await until(() => c()?.messages[1]?.status === 'error' && !research.busy(c().id)); await new Promise(r => setTimeout(r, 10));
  const occurrences = body.textContent.split('Service is too busy').length - 1;
  assert.equal(occurrences, 1, 'Not repeated under the messages'); assert.ok(!body.textContent.includes('没有收到正文'));
  assert.equal(findAll(body, n => n.className?.includes?.('glossa-feedback'))[0]?.textContent || '', '');
  panel.dispose();
});
test('production panel: context, Plan/Act, send, history folders and note confirmation', async () => {
  const f = fixture(); const doc = new FakeDocument(); const body = doc.createElementNS('', 'div');
  const panel = new m.Panel(body, f.research, f.fetcher, { openWorkspace() {} });
  panel.setContext([paper], ['Long fixture paper title']);
  assert.ok(body.textContent.includes('Long fixture paper title'));
  assert.equal(findAll(body, n => n.tagName === 'datalist').length, 0, 'Gecko chrome cannot open datalist suggestions');
  const get = label => control(body, label);
  click(get('Act')); assert.equal(get('Act').getAttribute('aria-pressed'), 'true');
  const textarea = findAll(body, n => n.tagName === 'textarea')[0]; textarea.value = 'Summarize this paper'; textarea.dispatch('input'); click(get('发送'));
  await until(() => f.store.state.conversations[0]?.messages[1]?.status === 'complete');
  await until(() => !f.research.busy(f.store.state.conversations[0].id));
  click(get('保存为笔记')); assert.equal(f.notes.length, 0);
  click(get('确认创建子笔记')); await until(() => f.notes.length === 1);
  click(get('关闭')); click(get('历史'));
  const folderName = findAll(body, n => n.placeholder === '新目录名称')[0]; folderName.value = 'Reading'; click(get('创建目录'));
  assert.equal(f.store.state.folders[0].name, 'Reading');
  change(get('筛选目录'), '*');
  const title = f.store.state.conversations[0].title;
  click(get(`对话操作：${title}`)); click(get(`移动「${title}」到 Reading`));
  assert.equal(f.store.state.conversations[0].folderID, f.store.state.folders[0].id);
  click(get('移除目录')); assert.equal(f.store.state.conversations[0].folderID, ''); assert.equal(f.store.state.conversations.length, 1);
  panel.dispose(); assert.equal(body.children.length, 0);
});
test('Plan mode saves a note in one confirmed step and commands keep readable titles', async () => {
  const f = fixture(); const doc = new FakeDocument(); const body = doc.createElementNS('', 'div');
  const panel = new m.Panel(body, f.research, f.fetcher, { openWorkspace() {} }); const get = label => control(body, label);
  panel.setContext([paper], ['Fixture paper']); panel.setSelectionPrompt('/summarize'); click(get('发送'));
  await until(() => f.store.state.conversations[0]?.messages[1]?.status === 'complete');
  const c = f.store.state.conversations[0];
  assert.equal(c.title, '总结 · Fixture paper'); assert.equal(c.messages[0].display, '/summarize'); assert.match(c.messages[0].text, /总结当前文献/);
  assert.ok(body.textContent.includes('/summarize'), 'The user sees what they typed, not the expanded prompt');
  click(get('保存为笔记')); click(get('切换到 Act 并创建'));
  await until(() => f.notes.length === 1);
  assert.equal(f.store.state.settings.runMode, 'act'); panel.dispose();
});
test('switching to another paper leaves the old chat in history and offers to continue it later', async () => {
  const f = fixture(); const doc = new FakeDocument(); const body = doc.createElementNS('', 'div');
  const panel = new m.Panel(body, f.research, f.fetcher, { openWorkspace() {} }); const get = label => control(body, label);
  panel.setContext([paper], ['Fixture paper']); panel.setSelectionPrompt('First question'); click(get('发送'));
  await until(() => f.store.state.conversations[0]?.messages[1]?.status === 'complete');
  const first = panel.session().conversation;
  panel.setContext([paper], ['Fixture paper']); assert.equal(panel.session().conversation, first, 'A host re-render of the same item keeps the chat');
  panel.setContext([{ libraryID: 1, key: 'OTHER001' }], ['Other paper']);
  assert.equal(panel.session().conversation, undefined); assert.equal(f.store.state.conversations.length, 1);
  panel.setContext([paper], ['Fixture paper']);
  click(get('继续对话：First question')); assert.equal(panel.session().conversation, first);
  click(get('历史')); click(get('First question')); panel.setContext([paper], ['Fixture paper']);
  assert.equal(panel.session().conversation, first); panel.dispose();
});
test('new chat and closing every view keep independent runs alive; history resumes and updates in place', async () => {
  const f = concurrentFixture(); const first = f.view();
  try {
    first.panel.setSelectionPrompt('Background A'); click(first.button('发送'));
    await until(() => f.streams.length === 1);
    const a = f.store.state.conversations[0];
    click(first.button('新建对话')); assert.equal(f.streams[0].signal.aborted, false);
    first.panel.setSelectionPrompt('Background B'); click(first.button('发送'));
    await until(() => f.streams.length === 2);
    const b = f.store.state.conversations[0]; first.panel.dispose();
    assert.equal(f.research.busy(a.id), true); assert.equal(f.research.busy(b.id), true);
    assert.ok(f.streams.every(s => !s.signal.aborted));
    const history = f.view(); click(history.button('历史'));
    const badges = () => findAll(history.body, n => n.className === 'glossa-history-running' && !n.hidden);
    assert.equal(badges().length, 2);
    click(history.button('对话操作：Background A')); click(history.button('重命名'));
    const edit = findAll(history.body, n => n.getAttribute('aria-label') === '对话名称')[0]; edit.value = 'Unfinished edit'; edit.focus();
    f.streams[0].chunk(' more'); f.store.changed();
    assert.equal(history.doc.activeElement, edit); assert.equal(edit.value, 'Unfinished edit');
    f.streams[0].finish(); await until(() => !f.research.busy(a.id));
    assert.equal(badges().length, 1); assert.equal(history.doc.activeElement, edit);
    assert.match(a.messages.at(-1).text, /more/); assert.equal(a.messages.at(-1).status, 'complete');
    click(history.button('Background B')); assert.equal(history.panel.session().conversation, b);
    assert.ok(history.body.textContent.includes('partial-2'));
    click(history.button('停止')); await until(() => !f.research.busy(b.id));
    assert.equal(b.messages.at(-1).status, 'stopped');
    click(history.button('历史')); assert.equal(badges().length, 0);
    history.panel.dispose();
    assert.ok(f.writes.some(s => s.conversations.some(c => c.id === a.id && c.messages.at(-1)?.status === 'complete')));
  } finally { first.panel.dispose(); await f.research.shutdown(); }
});
test('opening a different reading context starts a separate chat while the original keeps streaming', async () => {
  const f = concurrentFixture(); const first = f.view();
  try {
    first.panel.setSelectionPrompt('First paper'); click(first.button('发送'));
    await until(() => f.streams.length === 1); const original = f.store.state.conversations[0];
    first.panel.openContext([{ libraryID: 1, key: 'OTHER001' }], ['Other paper']);
    assert.equal(first.panel.session().conversation, undefined); assert.equal(f.research.busy(original.id), true);
    const second = f.view(); second.panel.setSelectionPrompt('Second window'); click(second.button('发送'));
    await until(() => f.streams.length === 2);
    click(second.button('停止')); await until(() => !f.research.busy(f.store.state.conversations[0].id));
    assert.equal(f.streams[0].signal.aborted, false);
    f.streams[0].finish(); await until(() => !f.research.busy(original.id)); second.panel.dispose();
  } finally { first.panel.dispose(); await f.research.shutdown(); }
});
test('history shows running work during PDF extraction and plugin shutdown stops all detached runs', async () => {
  const f = concurrentFixture(); f.host.snapshot = () => new Promise(() => {});
  const first = f.view(); first.panel.setSelectionPrompt('Still extracting'); click(first.button('发送'));
  const a = f.store.state.conversations[0]; first.panel.dispose();
  const second = f.view(); second.panel.setSelectionPrompt('Also extracting'); click(second.button('发送'));
  const b = f.store.state.conversations[0]; click(second.button('历史'));
  const badges = findAll(second.body, n => n.className === 'glossa-history-running');
  assert.equal(badges.length, 2); assert.ok(badges.every(n => !n.hidden && /读取/.test(n.title)));
  assert.equal(a.messages.length, 0); second.panel.dispose();
  await f.research.shutdown(); assert.equal(f.research.busy(a.id), false); assert.equal(f.research.busy(b.id), false);
  assert.equal(f.streams.length, 0);
});
test('settings cannot send a retained key to a changed provider domain', async () => {
  const f = fixture(); f.store.state.settings.endpoints[0].encryptedKey = 'saved-secret';
  const doc = new FakeDocument(); const body = doc.createElementNS('', 'div');
  const panel = new m.Panel(body, f.research, f.fetcher, { openWorkspace() {} });
  const button = text => control(body, text);
  click(button('设置')); click(button('模型服务')); click(button('编辑 Fixture'));
  findAll(body, n => n.placeholder === 'https://api.example.com/v1')[0].value = 'https://different.test/v1';
  click(button('获取模型列表'));
  await until(() => body.textContent.includes('服务域名已改变'));
  assert.equal(f.requests.length, 0);
  click(button('保存配置'));
  await until(() => body.textContent.includes('服务域名已改变'));
  assert.equal(f.store.state.settings.endpoints[0].baseUrl, endpoint.baseUrl); panel.dispose();
});
test('closing settings during keychain encryption cannot mutate saved settings later', async () => {
  const f = fixture(); const gate = deferred(); f.host.encrypt = () => gate.promise;
  const doc = new FakeDocument(); const body = doc.createElementNS('', 'div');
  const panel = new m.Panel(body, f.research, f.fetcher, { openWorkspace() {} });
  const button = text => control(body, text);
  panel.showSettings('api');
  findAll(body, n => n.type === 'password')[0].value = 'secret'; click(button('保存配置'));
  click(button('关闭')); gate.resolve('encrypted-secret'); await new Promise(r => setTimeout(r, 0));
  assert.equal(f.store.state.settings.endpoints[0].encryptedKey, ''); assert.equal(f.writes.length, 0); panel.dispose();
});
test('API presets fill the form and Anthropic output limits are configurable', async () => {
  const f = fixture(); const doc = new FakeDocument(); const body = doc.createElementNS('', 'div');
  const panel = new m.Panel(body, f.research, f.fetcher, { openWorkspace() {} }); const get = label => control(body, label);
  panel.showSettings('new');
  change(get('服务预设'), 'anthropic');
  assert.equal(get('服务名称').value, 'Anthropic'); assert.equal(findAll(body, n => n.placeholder === 'https://api.example.com/v1')[0].value, 'https://api.anthropic.com');
  get('模型 ID').value = 'claude-sonnet-4-6'; get('最大输出 tokens').value = '8192';
  click(get('保存配置')); await until(() => f.store.state.settings.endpoints.length === 2);
  const saved = f.store.state.settings.endpoints[1];
  assert.equal(saved.apiStyle, 'anthropic'); assert.equal(saved.maxTokens, 8192); assert.equal(f.store.state.settings.endpointID, saved.id);
  assert.equal(m.requestBody(saved, 'S', []).max_tokens, 8192);
  assert.equal(m.requestBody({ ...saved, maxTokens: undefined }, 'S', []).max_tokens, m.DEFAULT_MAX_TOKENS);
  assert.deepEqual(m.effortOptions(saved), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(m.effortOptions(endpoint), ['minimal', 'low', 'medium', 'high']);
  assert.equal(m.parseState(JSON.stringify(f.store.state)).settings.endpoints[1].maxTokens, 8192);
  panel.dispose();
});
test('plugin lifecycle registers official hooks once and cleans every registration', async () => {
  hostFixture(); const doc = new FakeDocument(); const win = { document: doc, AbortController, addEventListener() {}, removeEventListener() {}, MozXULElement: { insertFTLIfNeeded() {} } }; doc.defaultView = win;
  const callbacks = {}; const removed = []; const menuCommands = [];
  const workspaceDoc = new FakeDocument(); const workspaceEvents = {};
  const workspaceBody = workspaceDoc.createElementNS('', 'main'); workspaceBody.id = 'glossa-mount'; workspaceDoc.documentElement.append(workspaceBody);
  const workspace = { document: workspaceDoc, closed: false, location: { href: 'about:blank' }, addEventListener: (name, fn) => { workspaceEvents[name] = fn; },
    removeEventListener: name => { delete workspaceEvents[name]; }, close() { this.closed = true; workspaceEvents.unload?.(); } };
  workspaceDoc.readyState = 'complete';
  workspaceDoc.defaultView = workspace;
  let opened = 0;
  globalThis.Services = { ww: { openWindow: (owner, url, _name, features) => {
    opened++; assert.equal(owner, null); assert.equal(url, 'chrome://glossa-zotero/content/workspace.xhtml'); assert.match(features, /dialog=no/); return workspace;
  } } };
  Object.assign(Zotero, { DataDirectory: { dir: '/fixture' }, debug() {}, getMainWindows: () => [win], getMainWindow: () => win,
    ItemPaneManager: { registerSection: opts => { callbacks.section = opts; return opts.paneID; }, unregisterSection: id => removed.push(id) },
    MenuManager: { registerMenu: opts => { menuCommands.push(opts.menus[0].onCommand); return opts.menuID; }, unregisterMenu: id => removed.push(id) },
    Reader: { registerEventListener: (type, callback) => { callbacks[type] = callback; }, unregisterEventListener: (type, callback) => { assert.equal(callbacks[type], callback); removed.push(type); } },
  });
  globalThis.PathUtils = { join: (...parts) => parts.join('/') };
  globalThis.IOUtils = { exists: async () => false, makeDirectory: async () => {}, writeUTF8: async () => {}, setPermissions: async () => {} };
  await m.startup({ id: 'fixture@glossa', rootURI: 'file:///fixture/' });
  assert.equal(callbacks.section.pluginID, 'fixture@glossa');
  const body = doc.createElementNS('', 'div'); doc.documentElement.append(body);
  callbacks.section.onRender({ body, item: Zotero.Items.get(1) });
  assert.ok(body.textContent.includes('Glossa'));
  menuCommands[0](null, { items: [Zotero.Items.get(1)] });
  await new Promise(r => setTimeout(r, 0)); assert.equal(opened, 0, 'Default entry uses the existing sidebar');
  callbacks.renderTextSelectionPopup({ reader: { itemID: 2 }, doc, params: { annotation: { text: 'Selected fixture' } }, append: row => doc.documentElement.append(row) });
  await until(() => findAll(body, n => n.className === 'glossa-selection-card' && !n.hidden).length === 1);
  assert.match(body.textContent, /Selected fixture/, 'The sidebar of the same paper shows the reader selection');
  click(control(doc.documentElement, 'Glossa 翻译'));
  assert.equal(opened, 0, 'Translation must not open the research workspace');
  assert.ok(doc.documentElement.textContent.includes('先配置 API'));
  click(findAll(doc.documentElement, n => n.getAttribute('aria-label') === '关闭翻译')[0]);
  click(findAll(body, n => n.getAttribute('aria-label') === '设置')[0]);
  const automatic = findAll(body, n => n.getAttribute('aria-label') === '选中文字后自动翻译')[0];
  automatic.checked = true; automatic.dispatch('change');
  const otherReader = new FakeDocument();
  const select = (target, text) => callbacks.renderTextSelectionPopup({ reader: { itemID: 2 }, doc: target,
    params: { annotation: { text } }, append: row => target.documentElement.append(row) });
  select(doc, 'Superseded selection'); select(doc, 'Latest selection'); select(otherReader, 'Another reader selection');
  await until(() => findAll(otherReader.documentElement, n => n.getAttribute('aria-label') === 'Glossa 快速翻译').length === 1);
  const firstPopup = findAll(doc.documentElement, n => n.getAttribute('aria-label') === 'Glossa 快速翻译');
  assert.equal(firstPopup.length, 1); assert.ok(firstPopup[0].textContent.includes('Latest selection'));
  assert.ok(!firstPopup[0].textContent.includes('Superseded selection'));
  automatic.checked = false; automatic.dispatch('change');
  for (const target of [doc, otherReader]) click(findAll(target.documentElement, n => n.getAttribute('aria-label') === '关闭翻译')[0]);
  select(otherReader, 'Disabled automatic selection');
  await new Promise(r => setTimeout(r, 380));
  assert.equal(findAll(otherReader.documentElement, n => n.getAttribute('aria-label') === 'Glossa 快速翻译').length, 0);
  click(findAll(body, n => n.getAttribute('aria-label') === '关闭')[0]);
  const draft = findAll(body, n => n.getAttribute('aria-label') === '输入问题')[0];
  draft.value = 'Keep this draft across the initial document unload';
  click(control(body, '在独立窗口中打开'));
  // Gecko replaces the initial about:blank document; the mount waits for the real workspace even without a load event.
  workspaceEvents.unload?.(); await new Promise(r => setTimeout(r, 150)); assert.equal(workspaceBody.children.length, 0);
  workspace.location.href = 'chrome://glossa-zotero/content/workspace.xhtml';
  await until(() => findAll(workspaceBody, n => n.getAttribute('aria-label') === '输入问题')[0]?.value === draft.value);
  assert.ok(workspaceBody.textContent.includes('Glossa'));
  assert.ok(workspaceBody.textContent.includes('设置'));
  assert.equal(doc.getElementById('glossa-zotero-style').tagName, 'style');
  assert.match(doc.getElementById('glossa-zotero-style').textContent, /glossa-translation/);
  menuCommands[0](null, { items: [Zotero.Items.get(1)] });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(opened, 1, 'The existing workspace is reused');
  assert.equal(m.shutdown(), false, "A reason-less shutdown right after startup comes from an old bootstrap and is ignored");
  assert.ok(Zotero.__glossaZoteroRuntime, 'The running instance is reachable from a newer scope');
  Zotero.__glossaZoteroUpgradeAt = Date.now() - 60_000;
  assert.equal(m.shutdown(7), false, "Zotero's late upgrade shutdown cannot stop the instance that replaced the old one");
  delete Zotero.__glossaZoteroUpgradeAt;
  await m.shutdown(0); assert.equal(body.children.length, 0); assert.equal(removed.length, 4);
  assert.equal(Zotero.__glossaZoteroRuntime, undefined);
  assert.equal(workspace.closed, true); assert.equal(workspaceBody.children.length, 0);
  assert.equal(doc.getElementById('glossa-zotero-style'), null);
});

test('quick translation streams only the selected text without PDF extraction, history, or library writes', async () => {
  const f = fixture(); f.host.snapshot = async () => { throw new Error('Must not extract a PDF'); };
  let text = '';
  await f.research.translate({ attachment: paper, text: 'A small selected passage.' }, endpoint, new AbortController().signal, chunk => text += chunk);
  assert.equal(text, '研究结论 [S1]'); assert.equal(f.requests.length, 1);
  const body = JSON.parse(f.requests[0].init.body);
  assert.deepEqual(JSON.parse(body.messages.at(-1).content), { selection: 'A small selected passage.' });
  assert.match(body.messages[0].content, /简体中文/);
  assert.equal(f.writes.length, 0); assert.equal(f.notes.length, 0); assert.equal(f.store.state.conversations.length, 0);
});
test('quick translation snapshots provider and cancels while keychain is pending', async () => {
  const f = fixture(); const gate = deferred(); f.host.decrypt = () => gate.promise;
  const ep = copy(endpoint); const controller = new AbortController();
  const task = f.research.translate({ attachment: paper, text: 'Selection' }, ep, controller.signal, () => assert.fail('Cancelled output'));
  ep.baseUrl = 'https://changed.test/v1'; controller.abort();
  await assert.rejects(task, /abort/i); gate.resolve('key'); assert.equal(f.requests.length, 0);
  await assert.rejects(f.research.translate({ attachment: paper, text: 'x'.repeat(12001) }, endpoint, new AbortController().signal, () => {}), /选区过长/);
});
test('translation popup starts immediately, copies the result and removes itself on Escape', async () => {
  const f = fixture(); let copied = ''; f.host.copyText = value => copied = value;
  const doc = new FakeDocument(); let closed = 0;
  const popup = new m.SelectionTranslation(doc, f.research, { attachment: paper, text: 'Selection' }, { left: 10, top: 20, bottom: 40 },
    { configure() {}, openChat() {}, closed() { closed++; } });
  await until(() => popup.root.textContent.includes('已翻译'));
  click(findAll(popup.root, n => n.getAttribute('aria-label') === '复制译文')[0]);
  assert.equal(copied, '研究结论 [S1]');
  doc.documentElement.dispatch('keydown', { key: 'Escape' });
  assert.equal(popup.root.isConnected, false); assert.equal(closed, 1);
  popup.close(); assert.equal(closed, 1);
});
test('translation popup exposes remembered automatic translation and asks about the captured selection', async () => {
  const f = fixture(); const selection = { attachment: paper, text: 'Original selection', pageLabel: '7' }; let asked;
  f.store.state.settings.endpoints.push({ ...copy(endpoint), id: 'second', name: 'Second provider' });
  const create = () => new m.SelectionTranslation(new FakeDocument(), f.research, selection, { left: 0, top: 0, bottom: 20 },
    { configure() {}, openChat(value) { asked = value; }, closed() {} });
  const popup = create(); await until(() => popup.root.textContent.includes('已翻译'));
  const auto = findAll(popup.root, n => n.getAttribute('aria-label') === '划词后自动翻译')[0];
  assert.equal(auto.checked, false); auto.checked = true; auto.dispatch('change');
  change(findAll(popup.root, n => n.getAttribute('aria-label') === '翻译模型服务')[0], 'second');
  await until(() => f.requests.length === 2);
  const saved = m.parseState(JSON.stringify(f.store.state)); assert.equal(saved.settings.autoTranslate, true); assert.equal(saved.settings.translationEndpointID, 'second');
  click(findAll(popup.root, n => n.tagName === 'button' && n.textContent === '询问')[0]);
  assert.deepEqual(asked, selection); assert.equal(popup.root.isConnected, false);
  const reopened = create();
  assert.equal(findAll(reopened.root, n => n.getAttribute('aria-label') === '翻译模型服务')[0].value, 'second');
  assert.equal(findAll(reopened.root, n => n.getAttribute('aria-label') === '划词后自动翻译')[0].checked, true);
  f.store.state.settings.autoTranslate = false; f.store.changed();
  assert.equal(findAll(reopened.root, n => n.getAttribute('aria-label') === '划词后自动翻译')[0].checked, false);
  reopened.close(); await f.research.shutdown();
});
test('translation without configuration keeps the selection and retries after setup', async () => {
  const f = fixture(); f.store.state.settings.endpoints = []; let configured = 0;
  const popup = new m.SelectionTranslation(new FakeDocument(), f.research, { attachment: paper, text: 'Kept selection' }, { left: 0, top: 0, bottom: 10 },
    { configure() { configured++; }, openChat() {}, closed() {} });
  assert.match(popup.root.textContent, /先配置 API/); assert.equal(f.requests.length, 0);
  click(findAll(popup.root, n => n.tagName === 'button' && n.textContent === '配置模型服务')[0]); assert.equal(configured, 1);
  f.store.state.settings.endpoints = [copy(endpoint)]; f.store.changed();
  click(findAll(popup.root, n => n.tagName === 'button' && n.textContent === '重试')[0]);
  await until(() => popup.root.textContent.includes('已翻译'));
  assert.match(f.requests[0].init.body, /Kept selection/); popup.close();
});
test('closing translation aborts pending work and late output cannot revive it', async () => {
  const f = fixture(); const gate = deferred(); f.host.decrypt = () => gate.promise;
  const popup = new m.SelectionTranslation(new FakeDocument(), f.research, { attachment: paper, text: 'Selection' }, { left: 0, top: 0, bottom: 10 },
    { configure() {}, openChat() {}, closed() {} });
  popup.close(); gate.resolve('key'); await f.research.shutdown();
  assert.equal(f.requests.length, 0); assert.equal(popup.root.isConnected, false);
});
test('window preference and automatic translation survive reload; moving UI preserves conversation and draft', async () => {
  const f = fixture(); const doc = new FakeDocument(); const body = doc.createElementNS('', 'div');
  const panel = new m.Panel(body, f.research, f.fetcher, { openWorkspace() {} });
  panel.setContext([paper], ['Fixture'], { attachment: paper, text: 'Selected text' }); panel.setSelectionPrompt('Unsent draft');
  panel.showSettings();
  click(control(body, '独立窗口'));
  const auto = findAll(body, n => n.getAttribute('aria-label') === '选中文字后自动翻译')[0]; auto.checked = true; auto.dispatch('change');
  const state = m.parseState(JSON.stringify(f.store.state)); assert.equal(state.settings.openMode, 'window'); assert.equal(state.settings.autoTranslate, true);
  const other = new m.Panel(doc.createElementNS('', 'div'), f.research, f.fetcher, { workspace: true, openWorkspace() {} });
  const conversation = f.store.newConversation([paper]); const session = { ...panel.session(), conversation };
  other.restoreSession(session); assert.equal(other.session().conversation, conversation); assert.equal(other.session().draft, 'Unsent draft');
  assert.equal(other.session().selection.text, 'Selected text'); panel.dispose(); other.dispose();
});
test('English interface: labels, prompts, errors and answer language follow the chosen locale', async () => {
  assert.equal(m.resolveLocale('auto', 'en-US'), 'en'); assert.equal(m.resolveLocale(undefined, 'zh-CN'), 'zh');
  assert.equal(m.resolveLocale('zh', 'en-US'), 'zh'); assert.equal(m.resolveLocale('auto', ''), 'zh');
  m.setLocale('en');
  try {
    const f = fixture(); const doc = new FakeDocument(); const body = doc.createElementNS('', 'div');
    const panel = new m.Panel(body, f.research, f.fetcher, { openWorkspace() {} }); panel.setContext([paper], ['Fixture paper']);
    for (const label of ['Send', 'History', 'Settings', 'New chat', 'Choose model', 'Summarize this paper (/summarize)']) assert.ok(control(body, label), label);
    assert.match(findAll(body, n => n.tagName === 'textarea')[0].placeholder, /Ask about this paper/);
    assert.ok(!/[一-龥]/.test(body.textContent), body.textContent.match(/[一-龥]+/)?.[0]);
    panel.showSettings('general'); assert.ok(control(body, 'Interface language'));
    const leftover = body.textContent.replace(/简体中文|繁體中文|日本語/g, '').match(/[一-龥]+/); assert.equal(leftover, null, leftover?.[0]);
    panel.showSettings('services'); assert.equal(body.textContent.match(/[一-龥]+/), null);
    panel.showSettings('api'); assert.equal(body.textContent.match(/[一-龥]+/), null);
    assert.throws(() => m.expandCommand('/compare', false, 1), /at least two papers/);
    assert.match(m.expandCommand('/summarize', false, 1), /Summarize the research question/);
    assert.equal(m.answerLanguage(''), 'English'); assert.equal(m.answerLanguage('日本語'), '日本語');
    const legacy = m.parseState(JSON.stringify({ version: 1, settings: { endpoints: [], endpointID: '', language: '简体中文', includeFulltext: false }, folders: [], conversations: [] }));
    assert.equal(legacy.settings.language, '', 'The old stored default follows the interface language');
    const chosen = m.parseState(JSON.stringify({ version: 1, settings: { endpoints: [], endpointID: '', language: '简体中文', includeFulltext: false, uiLanguage: 'en' }, folders: [], conversations: [] }));
    assert.equal(chosen.settings.language, '简体中文', 'A language chosen in 0.1.1 or later is kept');
    let system = ''; const research = new m.Research(f.store, f.host, async (_url, init) => { system = JSON.parse(init.body).messages[0].content; return success(); });
    await research.translate({ attachment: paper, text: 'Text' }, endpoint, new AbortController().signal, () => {});
    assert.match(system, /into English/, 'Answers follow the interface language unless one is chosen');
    panel.dispose();
  } finally { m.setLocale('zh'); }
});
test('the selection card leaves when the reader selection is cleared, unless the user is working in the panel', () => {
  const f = fixture(); const doc = new FakeDocument(); const body = doc.createElementNS('', 'div'); doc.documentElement.append(body);
  const panel = new m.Panel(body, f.research, f.fetcher, { openWorkspace() {} }); panel.setContext([paper], ['Fixture paper']);
  const card = () => findAll(body, n => n.className === 'glossa-selection-card')[0];
  const first = { attachment: paper, text: 'First selection' };
  panel.offerSelection(first); findAll(body, n => n.tagName === 'textarea')[0].focus();
  panel.withdrawSelection(first); assert.equal(card().hidden, false, 'Kept while typing a question about it');
  doc.activeElement = null; panel.withdrawSelection({ ...first }); assert.equal(card().hidden, false, 'Only the selection that was cleared is withdrawn');
  panel.withdrawSelection(first); assert.equal(card().hidden, true); panel.dispose();
});
test('slash commands expand supported actions and reject missing context instead of sending literal commands', () => {
  assert.match(m.expandCommand('/summarize 简短一点', false, 1), /总结当前文献[\s\S]*简短一点/);
  assert.match(m.expandCommand('/translate', true, 1), /翻译所选段落/);
  assert.equal(m.expandCommand('ordinary question', false, 0), 'ordinary question');
  assert.throws(() => m.expandCommand('/translate', false, 1), /选择文字/);
  assert.throws(() => m.expandCommand('/compare', false, 1), /至少两篇/);
  assert.throws(() => m.expandCommand('/summarize', false, 0), /添加文献/);
  assert.throws(() => m.expandCommand('/unsupported', true, 1), /未识别/);
});
test('dismissed context stays removed on host rerender; changing papers attaches the new paper', () => {
  const f = fixture(); const doc = new FakeDocument(); const body = doc.createElementNS('', 'div');
  const panel = new m.Panel(body, f.research, f.fetcher, { openWorkspace() {} });
  panel.setContext([paper], ['First paper']);
  const removes = () => findAll(body, n => n.getAttribute('aria-label')?.startsWith('移除文献：'));
  click(removes()[0]); panel.setContext([paper], ['First paper']); panel.refreshTitles([paper], ['Late title']);
  assert.equal(removes().length, 0);
  panel.setContext([{ libraryID: 1, key: 'OTHER001' }], ['New paper']);
  assert.equal(removes().length, 1); assert.equal(removes()[0].getAttribute('aria-label'), '移除文献：New paper'); panel.dispose();
});
test('context picker deduplicates attachments and drops a late selection after starting a new chat', async () => {
  const f = fixture(); const gate = deferred(); f.host.pickItems = () => gate.promise;
  const doc = new FakeDocument(); const body = doc.createElementNS('', 'div');
  const panel = new m.Panel(body, f.research, f.fetcher, { openWorkspace() {} }); panel.setContext([paper], ['First']);
  const btn = label => findAll(body, n => n.tagName === 'button' && n.getAttribute('aria-label') === label)[0];
  click(btn('添加文献')); click(btn('新建对话'));
  gate.resolve([{ item: { libraryID: 1, key: 'OTHER001' }, title: 'Stale selection' }]); await new Promise(r => setTimeout(r, 0));
  assert.ok(!body.textContent.includes('Stale selection'));
  f.host.pickItems = async () => [{ item: paper, title: 'Duplicate' }, { item: { libraryID: 1, key: 'OTHER001' }, title: 'Second' }];
  click(btn('添加文献')); await until(() => body.textContent.includes('Second'));
  assert.equal(findAll(body, n => n.getAttribute('aria-label')?.startsWith('移除文献：')).length, 2); panel.dispose();
});
const idlePort = () => ({ start: async () => { throw new Error('No CLI in this fixture'); } });
test('API and CLI remember their own selected provider and mode survives a saved-state round trip', async () => {
  const f = fixture(); f.store.state.settings.endpoints.push({ ...copy(endpoint), id: 'second', name: 'Second API', model: 'second-model', models: ['second-model'] });
  const research = new m.Research(f.store, f.host, f.fetcher, idlePort());
  const doc = new FakeDocument(); const body = doc.createElementNS('', 'div');
  const panel = new m.Panel(body, research, f.fetcher, { openWorkspace() {} }); const get = label => control(body, label);
  const pick = label => { click(get('选择模型')); click(get(label)); };
  pick('Second API：second-model');
  const grok = f.store.state.settings.endpoints.find(e => e.kind === 'grok');
  pick('Grok：默认模型'); assert.equal(f.store.state.settings.transport, 'cli');
  click(get('选择模型')); const search = get('搜索或输入模型 ID'); search.value = 'grok-choice'; search.dispatch('keydown', { key: 'Enter', isComposing: false });
  assert.equal(grok.model, 'grok-choice');
  pick('Second API：second-model'); assert.match(get('选择模型').title, /Second API · second-model/);
  pick('Grok：grok-choice'); assert.match(get('选择模型').title, /Grok · grok-choice/);
  click(get('Act'));
  const restored = m.parseState(JSON.stringify(f.store.state)); assert.equal(restored.settings.runMode, 'act');
  assert.equal(restored.settings.apiEndpointID, 'second'); assert.equal(restored.settings.cliEndpointID, grok.id); panel.dispose();
  await research.shutdown();
});
test('native Zotero context picker resolves confirmed items and does not write library data', async () => {
  const f = hostFixture(); let dialog;
  Zotero.getMainWindow = () => ({ openDialog: (url, name, features, io) => { assert.match(url, /selectItemsDialog.xhtml$/); dialog = io; } });
  const promise = f.host.pickItems(); dialog.dataOut = [1, 999]; dialog.deferred.resolve();
  assert.deepEqual(await promise, [{ item: paper, title: 'Test paper' }]); assert.deepEqual(f.saved, []);
  const cancelled = f.host.pickItems(); dialog.deferred.resolve(); assert.deepEqual(await cancelled, []);
});
test('history export excludes all credentials; validated imports merge without replacing existing chats', () => {
  const f = fixture(); f.store.state.settings.endpoints[0].encryptedKey = 'VERY-SECRET';
  f.store.state.folders.push({ id: 'folder', name: 'Research' });
  const c = f.store.newConversation([paper]); c.folderID = 'folder';
  c.messages.push({ id: 'message', role: 'assistant', text: 'Answer', sources: [source], status: 'complete', createdAt: 1 });
  const raw = m.exportHistory(f.store.state); assert.ok(!raw.includes('VERY-SECRET')); assert.ok(!raw.includes('endpoints'));
  const dest = m.emptyState(); assert.equal(m.importHistory(dest, raw), 1); assert.equal(m.importHistory(dest, raw), 0);
  assert.equal(dest.conversations[0].folderID, 'folder'); assert.deepEqual(dest.settings.endpoints, []);
  assert.match(m.conversationMarkdown(c, () => 'zotero://test'), /zotero:\/\/test/);
  assert.throws(() => m.importHistory(dest, JSON.stringify({ format: 'wrong' })), /备份/);
});
test('CLI research never decrypts API credentials and uses the selected transport', async () => {
  const f = fixture(); f.host.decrypt = async () => { throw new Error('API credentials must not be accessed'); };
  const port = { start: async () => { let read = false; return { read: async () => { if (read) return ''; read = true; return '{"type":"result","subtype":"success","result":"CLI answer [S1]"}\n'; },
    write: async () => {}, end: async () => {}, close: async () => {} }; } };
  const research = new m.Research(f.store, f.host, f.fetcher, port); const c = f.store.newConversation();
  await research.run(c, 'Question', [paper], undefined, { ...endpoint, kind: 'claude' }, 'act', () => {});
  assert.equal(c.messages[1].text, 'CLI answer [S1]'); assert.equal(f.requests.length, 0);
});
test('panel switches API/CLI, remembers models, offers discovered effort and preserves context during late title updates', async () => {
  const f = fixture(); const research = new m.Research(f.store, f.host, f.fetcher, idlePort());
  const doc = new FakeDocument(); const body = doc.createElementNS('', 'div');
  const panel = new m.Panel(body, research, f.fetcher, { openWorkspace() {} }); const get = label => control(body, label);
  panel.setContext([paper], ['Original']);
  assert.deepEqual(f.store.state.settings.endpoints.filter(m.isCli).map(e => e.kind), ['codex', 'claude', 'grok']);
  const codex = f.store.state.settings.endpoints.find(e => e.kind === 'codex'); codex.model = 'one'; codex.effort = 'xhigh';
  codex.cliModels = [{ id: 'two', label: 'two', efforts: ['low', 'high'], defaultEffort: 'high', isDefault: false }];
  click(get('选择模型')); click(get('Codex：two')); assert.equal(codex.effort, 'high');
  click(get('推理强度')); assert.ok(get('推理强度：low')); assert.equal(get('推理强度：xhigh'), undefined);
  click(get('推理强度：low')); assert.equal(codex.effort, 'low');
  click(get('选择模型')); click(get('Fixture：fixture-model')); assert.match(get('选择模型').title, /fixture-model/);
  panel.setContext([{ libraryID: 1, key: 'OTHER001' }], ['Other']); panel.refreshTitles([paper], ['Late title']);
  assert.ok(!body.textContent.includes('Late title')); panel.dispose(); await research.shutdown();
});
test('model discovery captures endpoint before awaiting keychain decryption', async () => {
  const f = fixture(); f.store.state.settings.endpoints[0].encryptedKey = 'encrypted';
  const gate = deferred(); f.host.decrypt = () => gate.promise;
  const urls = []; const fetcher = async url => { urls.push(url); return Response.json({ data: [{ id: 'model' }] }); };
  const doc = new FakeDocument(); const body = doc.createElementNS('', 'div');
  const panel = new m.Panel(body, f.research, fetcher, { openWorkspace() {} });
  panel.showSettings('api');
  click(control(body, '获取模型列表'));
  findAll(body, n => n.placeholder === 'https://api.example.com/v1')[0].value = 'https://untrusted.test/v1';
  gate.resolve('secret'); await until(() => urls.length > 0);
  assert.equal(urls[0], 'https://example.test/v1/models');
  await until(() => !!control(body, 'model')); click(control(body, 'model'));
  assert.equal(control(body, '模型 ID').value, 'model'); panel.dispose();
});
test('research notes retain tables, lists, code and citations while escaping HTML', () => {
  const html = m.noteHTML('Research', '# Summary\n- One\n- Two\n\n| Claim | Evidence |\n| --- | --- |\n| <script> | **[S1]** |\n\n> Caution\n\n```html\n<img onerror=x>\n```', [source], () => 'zotero://select/library/items/PAPER001');
  assert.match(html, /<ul><li>One<\/li><li>Two<\/li><\/ul>/);
  assert.match(html, /<table><tr><th>Claim<\/th>/); assert.match(html, /<blockquote><p>Caution/);
  assert.match(html, /<strong><a href="zotero:/); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img '));
});
test('automatic CLI discovery keeps a model typed while the catalog is loading', async () => {
  const f = fixture(); const gate = deferred();
  const port = { start: async () => {
    let step = 0; return { write: async () => {}, end: async () => {}, close: async () => {}, read: async () => {
      await gate.promise; return JSON.stringify(++step === 1 ? { id: 1, result: {} } : { id: 2, result: {
        data: [{ model: 'catalog-default', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }],
      } }) + '\n';
    } };
  } };
  const research = new m.Research(f.store, f.host, f.fetcher, port);
  const doc = new FakeDocument(); const body = doc.createElementNS('', 'div');
  const panel = new m.Panel(body, research, f.fetcher, { openWorkspace() {} }); const get = label => control(body, label);
  click(get('选择模型')); click(get('Codex：默认模型'));
  click(get('选择模型')); const search = get('搜索或输入模型 ID'); search.value = 'manual-model'; search.dispatch('keydown', { key: 'Enter', isComposing: false });
  gate.resolve(); await until(() => f.store.state.settings.endpoints.find(e => e.kind === 'codex').cliModels?.length);
  const codex = f.store.state.settings.endpoints.find(e => e.kind === 'codex');
  assert.equal(codex.model, 'manual-model'); assert.deepEqual(codex.cliModels[0].efforts, ['high']);
  click(get('选择模型')); assert.ok(get('Codex：catalog-default')); assert.ok(get('Codex：manual-model'));
  panel.dispose();
});
cliTests(m);
