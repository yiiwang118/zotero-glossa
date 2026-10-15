import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, mkdir, stat, chmod, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';

const endpoint = kind => ({ id: kind, name: kind, kind, baseUrl: '', apiStyle: 'openai', model: 'test-model', models: [], encryptedKey: '', effort: 'high' });
function scripted(events) {
  const sent = []; let closed = 0;
  return { sent, get closed() { return closed; }, find: async () => '/fixture/cli', start: async () => ({
    read: async () => events.length ? JSON.stringify(events.shift()) + '\n' : '',
    write: async text => { sent.push(text); }, end: async () => {}, wait: async () => 1, close: async () => { closed++; },
  }) };
}
async function collect(m, kind, port, signal = new AbortController().signal, chunks = []) {
  let answer = ''; for await (const chunk of m.cliStream(endpoint(kind), 'system', [{ role: 'user', content: 'Question' }], signal, port)) { chunks.push(chunk); if (chunk.type === 'text') answer += chunk.text; }
  return answer;
}
/** A Codex app-server session: initialize → thread/start → turn/start, then the given notifications. */
const codexSession = (...events) => scripted([{ id: 1, result: {} }, { id: 2, result: { thread: { id: 't' } } }, { id: 3, result: {} }, ...events]);
const codexEvent = (method, params = {}) => ({ method, params: { threadId: 't', ...params } });
export function cliTests(m) {
  test('CLI arguments preserve read-only execution, separate argv and configurable effort', () => {
    for (const kind of ['codex', 'claude', 'grok']) {
      const args = m.cliArgs(endpoint(kind));
      assert.ok(!args.some(arg => arg.includes('bypass') || arg.includes('workspace-write')));
      if (kind !== 'codex') { assert.ok(args.includes('test-model')); assert.equal(args[args.indexOf('--tools') + 1], ''); }
      else assert.deepEqual(args.slice(-1), ['app-server']), assert.ok(args.includes('features.shell_tool=false') && args.includes('mcp_servers={}'));
    }
    assert.throws(() => m.cliArgs({ ...endpoint('codex'), effort: 'high"\nmalicious=true' }), /Effort/);
    assert.throws(() => m.validateCli({ ...endpoint('grok'), proxy: 'http://secret:password@host' }), /代理/);
  });
  test('Codex streams answer and reasoning deltas over app-server, read-only, and survives transient reconnects', async () => {
    const port = codexSession(
      { id: 'approval', method: 'item/commandExecution/requestApproval', params: { threadId: 't' } },
      codexEvent('error', { error: { message: 'Reconnecting... 2/5 (request timed out)' }, willRetry: true }),
      codexEvent('item/reasoning/summaryTextDelta', { itemId: 'r', delta: '先看摘要' }),
      codexEvent('item/agentMessage/delta', { itemId: 'a', delta: '回答 ' }), codexEvent('item/agentMessage/delta', { itemId: 'a', delta: '[S1]' }),
      codexEvent('item/agentMessage/delta', { threadId: 'other', itemId: 'x', delta: 'ignored' }),
      codexEvent('item/agentMessage/delta', { itemId: 'b', delta: '补充' }),
      codexEvent('turn/completed', { turn: { status: 'completed' } }));
    const chunks = [];
    assert.equal(await collect(m, 'codex', port, undefined, chunks), '回答 [S1]\n\n补充'); assert.equal(port.closed, 1);
    assert.deepEqual(chunks.filter(c => c.type === 'status').map(c => c.status + (c.detail ? ` ${c.detail}` : '')), ['connected', 'retrying 2/5']);
    assert.equal(chunks.find(c => c.type === 'reasoning').text, '先看摘要');
    const sent = port.sent.map(JSON.parse);
    const thread = sent.find(x => x.method === 'thread/start').params;
    assert.deepEqual([thread.model, thread.approvalPolicy, thread.sandbox, thread.ephemeral], ['test-model', 'never', 'read-only', true]);
    const turn = sent.find(x => x.method === 'turn/start').params;
    assert.equal(turn.effort, 'high'); assert.match(turn.input[0].text, /Question/);
    assert.equal(sent.find(x => x.id === 'approval').error.code, -32601, 'Client actions are refused');
    await assert.rejects(collect(m, 'codex', codexSession(codexEvent('item/agentMessage/delta', { itemId: 'a', delta: 'partial' }))), /提前结束/);
  });
  test('CLI failures say what went wrong once, with a remedy, and never echo credentials or local paths', async () => {
    const failed = codexSession(codexEvent('error', { error: { message: 'unexpected status 401 Unauthorized: Bearer sk-abcdef123456 at /Users/me/.codex/auth.json' }, willRetry: false }),
      codexEvent('turn/completed', { turn: { status: 'failed', error: { message: 'unexpected status 401 Unauthorized: Bearer sk-abcdef123456 at /Users/me/.codex/auth.json' } } }));
    await assert.rejects(collect(m, 'codex', failed), error => /^Codex：unexpected status 401/.test(error.message) && /重新登录/.test(error.message)
      && !/sk-abcdef|\/Users\/me|auth\.json/.test(error.message));
    // Claude Code reports API failures as a synthetic assistant message; it must not become the answer.
    const blocked = scripted([
      { type: 'assistant', is_api_error_message: true, message: { model: '<synthetic>', content: [{ type: 'text', text: 'Failed to authenticate. API Error: 403 Request not allowed' }] } },
      { type: 'result', subtype: 'success', is_error: true, result: 'Failed to authenticate. API Error: 403 Request not allowed' },
    ]);
    const chunks = [];
    await assert.rejects(collect(m, 'claude', blocked, undefined, chunks), /Claude Code：Failed to authenticate\. API Error: 403 Request not allowed（服务拒绝了当前网络，请检查代理）/);
    assert.ok(!chunks.some(c => c.type === 'text'));
    const unknownModel = scripted([{ type: 'system', subtype: 'init' }, { type: 'result', subtype: 'error_during_execution', is_error: true,
      errors: ["Couldn't set model 'grok-x': Invalid params: \"unknown model id\". Run 'grok models' to see available models."] }]);
    await assert.rejects(collect(m, 'grok', unknownModel), /^Error: Grok：Couldn't set model 'grok-x'.*unknown model id.*（请检查模型名称）$/);
    assert.equal(m.cliDetail('token xai-1234567890abcdef for user@example.com in C:\\Users\\me\\x'), 'token *** for *** in …');
  });
  test('Claude and Grok streaming avoid final-message duplication and reject incomplete result', async () => {
    for (const kind of ['claude', 'grok']) {
      const port = scripted([
        { type: 'stream_event', event: { type: 'message_start' } },
        { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Answer' } } },
        { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'secret' }, { type: 'text', text: 'Answer' }] } },
        { type: 'result', subtype: 'success', result: 'Answer' },
      ]);
      assert.equal(await collect(m, kind, port), 'Answer'); assert.equal(port.closed, 1);
      await assert.rejects(collect(m, kind, scripted([{ type: 'result', subtype: 'error_max_turns', result: 'truncated' }])), /未完整/);
    }
  });
  test('CLI model discovery paginates, rejects client actions, and maps supported efforts', async () => {
    const port = scripted([
      { id: 1, result: {} }, { id: 'tool', method: 'fs/read' },
      { id: 2, result: { data: [{ model: 'a', displayName: 'A', supportedReasoningEfforts: [{ reasoningEffort: 'high' }], defaultReasoningEffort: 'high', isDefault: true }], nextCursor: 'page2' } },
      { id: 3, result: { data: [{ model: 'b' }, { model: 'a' }], nextCursor: 'page2' } },
    ]);
    const catalog = await m.cliModels(endpoint('codex'), new AbortController().signal, port);
    assert.deepEqual(catalog.map(x => x.id), ['a', 'b']);
    const sent = port.sent.map(JSON.parse); assert.ok(sent.some(s => s.error?.code === -32601));
    assert.ok(sent.some(s => s.params?.cursor === 'page2')); assert.equal(port.closed, 1);
    assert.deepEqual(m.parseModels('claude', [{ value: 'sonnet', supportedEffortLevels: ['low', 'high'] }])[0].efforts, ['low', 'high']);
    assert.deepEqual(m.parseModels('grok', [{ modelId: 'grok', _meta: { reasoningEfforts: [{ value: 'medium' }] } }])[0].efforts, ['medium']);
  });
  test('real Claude per-block assistant events after thinking do not duplicate streamed text', async () => {
    const port = scripted([
      { type: 'stream_event', event: { type: 'message_start' } },
      { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } },
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'private' }] } },
      { type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'GLOSSA_' } } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'GLOSSA_OK' }] } },
      { type: 'stream_event', event: { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '\nNext' } } },
      { type: 'assistant', message: { content: [{ type: 'text', text: '\nNext' }] } },
      { type: 'result', subtype: 'success', result: 'GLOSSA_OK\nNext' },
    ]);
    assert.equal(await collect(m, 'claude', port), 'GLOSSA_OK\nNext');
  });
  test('Claude/Grok catalog protocols return models without launching inference', async () => {
    const claude = scripted([{ type: 'control_request', request_id: 'tool' }, { type: 'control_response', response: {
      request_id: 'glossa-models', subtype: 'success', response: { models: [{ value: 'default', supportedEffortLevels: ['high'] }] },
    } }]);
    assert.equal((await m.cliModels(endpoint('claude'), new AbortController().signal, claude))[0].id, 'default');
    assert.equal(JSON.parse(claude.sent[1]).response.subtype, 'error');
    const grok = scripted([{ id: 1, result: {} }, { id: 2, result: { result: { availableModels: [{ modelId: 'grok' }], currentModelId: 'grok' } } }]);
    assert.equal((await m.cliModels(endpoint('grok'), new AbortController().signal, grok))[0].isDefault, true);
    assert.equal(JSON.parse(grok.sent[1]).method, '_x.ai/models/list');
  });
  test('CLI cancellation unblocks a stalled response and always closes the process', async () => {
    let closed = false; const controller = new AbortController();
    const port = { start: async () => ({ read: () => new Promise(() => {}), write: async () => {}, end: async () => {}, close: async () => { closed = true; } }) };
    const task = collect(m, 'claude', port, controller.signal); controller.abort();
    await assert.rejects(task, /abort|取消/i); assert.ok(closed);
  });
  test('Gecko process adapter handles real pipes, proxy environment, private prompt files and cleanup', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'glossa-process-fixture-'));
    const script = path.join(directory, 'fixture.mjs');
    await writeFile(script, `import fs from 'node:fs';
const args = process.argv.slice(2), i = args.indexOf('--prompt-file');
let prompt = i >= 0 ? fs.readFileSync(args[i+1], 'utf8') : '';
if (i < 0) for await (const chunk of process.stdin) prompt += chunk;
process.stderr.write('x'.repeat(100000));
process.stdout.write(JSON.stringify({cwd:process.cwd(),prompt,proxy:process.env.HTTPS_PROXY,mode:i>=0?(fs.statSync(args[i+1]).mode&511):null})+'\\n');`);
    const previous = { Zotero: globalThis.Zotero, IOUtils: globalThis.IOUtils, PathUtils: globalThis.PathUtils, ChromeUtils: globalThis.ChromeUtils,
      Cc: globalThis.Cc, Ci: globalThis.Ci, Services: globalThis.Services };
    const spawned = [];
    globalThis.Zotero = { isWin: false, debug() {} };
    globalThis.PathUtils = { join: path.join, tempDir: directory };
    globalThis.IOUtils = { exists: async p => { try { await access(p); return true; } catch { return false; } },
      makeDirectory: (p, opts) => mkdir(p, { mode: opts.permissions }), writeUTF8: (p, text) => writeFile(p, text), setPermissions: chmod,
      remove: (p, opts) => rm(p, { recursive: opts.recursive, force: opts.ignoreAbsent }) };
    const pipe = stream => {
      stream.setEncoding('utf8'); const iterator = stream[Symbol.asyncIterator]();
      const result = { closed: false, async readString() { const next = await iterator.next(); result.closed = !!next.done; return next.value || ''; },
        async close() { result.closed = true; stream.destroy(); } }; return result;
    };
    globalThis.ChromeUtils = { importESModule: () => ({ Subprocess: {
      getEnvironment: () => ({ ...process.env }), pathSearch: async () => process.execPath,
      call: async opts => {
        const child = spawn(opts.command, [script, ...opts.arguments], { cwd: opts.workdir, env: opts.environment, stdio: 'pipe' });
        const exited = once(child, 'exit').then(([exitCode]) => ({ exitCode: exitCode ?? -9 }));
        child.stdin.on('error', () => {}); spawned.push(child);
        return { stdin: { closed: false, write: text => new Promise((resolve, reject) => child.stdin.write(text, error => error ? reject(error) : resolve())), close: async force => { if (force) child.stdin.destroy(); else child.stdin.end(); } },
          stdout: pipe(child.stdout), stderr: pipe(child.stderr), wait: () => exited,
          kill: async () => { if (child.exitCode === null) child.kill('SIGKILL'); return exited; } };
      },
    } }) };
    try {
      const port = new m.GeckoProcessPort();
      for (const kind of ['claude', 'grok']) {
        const ep = { ...endpoint(kind), binaryPath: process.execPath, proxy: 'http://127.0.0.1:4567' };
        const proc = await port.start(ep, [], new AbortController().signal, kind === 'grok' ? '私密上下文' : undefined);
        const writing = (async () => { if (kind === 'claude') await proc.write('私密上下文'); await proc.end(); })();
        const output = JSON.parse(await proc.read()); await writing; await proc.close();
        assert.equal(output.prompt, '私密上下文'); assert.equal(output.proxy, ep.proxy);
        assert.equal(output.mode, kind === 'grok' ? 0o600 : null);
        await assert.rejects(stat(output.cwd), /ENOENT/);
      }
      // Zotero started from the Dock has no proxy variables: the CLI gets Zotero's (system) proxy instead of connecting directly.
      const noProxy = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/_proxy$/i.test(name)));
      Object.assign(globalThis, {
        Cc: { '@mozilla.org/network/protocol-proxy-service;1': { getService: () => ({ asyncResolve: (uri, _flags, callback) => {
          assert.equal(uri, 'https://api.anthropic.com/'); callback.onProxyAvailable(null, null, { type: 'http', host: '127.0.0.1', port: 7890 });
        } }) } },
        Ci: { nsIProtocolProxyService: {} }, Services: { io: { newURI: spec => spec } },
      });
      const subprocess = globalThis.ChromeUtils.importESModule().Subprocess; const getEnvironment = subprocess.getEnvironment;
      globalThis.ChromeUtils = { importESModule: () => ({ Subprocess: { ...subprocess, getEnvironment: () => ({ ...noProxy }) } }) };
      assert.deepEqual(await port.proxy({ ...endpoint('claude'), binaryPath: process.execPath }), { url: 'http://127.0.0.1:7890', source: 'zotero' });
      const viaZotero = await port.start({ ...endpoint('claude'), binaryPath: process.execPath }, [], new AbortController().signal);
      const piping = (async () => { await viaZotero.write('x'); await viaZotero.end(); })();
      assert.equal(JSON.parse(await viaZotero.read()).proxy, 'http://127.0.0.1:7890'); await piping; await viaZotero.close();
      globalThis.ChromeUtils = { importESModule: () => ({ Subprocess: { ...subprocess, getEnvironment } }) };
      assert.equal(m.proxyURL({ type: 'socks', host: '::1', port: 1080 }), 'socks5h://[::1]:1080'); assert.equal(m.proxyURL(null), '');
      const controller = new AbortController();
      const proc = await port.start(endpoint('codex'), [], controller.signal);
      controller.abort(); await proc.close(); assert.ok(spawned.every(c => c.exitCode !== null || c.signalCode));
    } finally { Object.assign(globalThis, previous); await rm(directory, { recursive: true, force: true }); }
  });
}
