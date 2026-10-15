// Opt-in check of installed, logged-in CLIs. Requests capability metadata only, never user documents.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = require(path.join(root, '.cache/tests.cjs'));
const report = [];
const answerTest = process.argv.includes('--answer');
for (const kind of (process.env.GLOSSA_SMOKE_CLI ? [process.env.GLOSSA_SMOKE_CLI] : ['codex', 'claude', 'grok'])) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'glossa-cli-metadata-'));
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), answerTest ? 45000 : 20000);
  const port = { start: async (_ep, args, _signal, prompt) => {
    if (prompt !== undefined) { const file = path.join(directory, 'prompt.txt'); await writeFile(file, prompt, { mode: 0o600 }); args = [...args, '--prompt-file', file]; }
    const child = spawn(kind, args, { cwd: directory, env: process.env, shell: false, detached: process.platform !== 'win32', stdio: 'pipe' });
    const exited = once(child, 'exit').then(([code]) => code ?? -1); void exited.catch(() => {});
    child.stdin.on('error', () => {}); child.stderr.resume(); child.stdout.setEncoding('utf8');
    const iterator = child.stdout[Symbol.asyncIterator](); let trace = '';
    const kill = () => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {} };
    controller.signal.addEventListener('abort', kill, { once: true });
    return { read: async () => { const next = await iterator.next();
      if (process.env.GLOSSA_TRACE_EVENTS) {
        trace += next.value || ''; let i;
        while ((i = trace.indexOf('\n')) >= 0) {
          const line = trace.slice(0, i); trace = trace.slice(i + 1);
          try { const row = JSON.parse(line); console.log(JSON.stringify({type:row.type,event:row.event?.type,index:row.event?.index,
            deltaType:row.event?.delta?.type,text:row.event?.delta?.type==='text_delta'?row.event.delta.text:undefined,
            blockType:row.event?.content_block?.type,blockText:row.event?.content_block?.text,
            messageID:row.message?.id,content:row.message?.content?.filter(b=>b.type==='text'),subtype:row.subtype})); } catch {}
        }
      }
      return next.value || ''; },
      write: text => new Promise((resolve, reject) => child.stdin.write(text, error => error ? reject(error) : resolve())),
      end: async () => child.stdin.end(), wait: () => exited,
      close: async () => { kill(); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); await exited.catch(() => {}); controller.signal.removeEventListener('abort', kill); } };
  } };
  try {
    const endpoint = { id: kind, name: kind, kind, baseUrl: '', apiStyle: 'openai', model: '', models: [], encryptedKey: '', effort: '' };
    if (answerTest) {
      let answer = '';
      for await (const chunk of m.cliStream(endpoint, 'This is a connectivity test. Do not use tools or access files.', [{ role: 'user', content: 'Reply exactly GLOSSA_OK and nothing else.' }], controller.signal, port)) answer += chunk;
      report.push({ kind, success: answer.trim() === 'GLOSSA_OK', answer: answer.slice(0, 100) });
    } else {
      const models = await m.cliModels(endpoint, controller.signal, port);
      report.push({ kind, success: true, models: models.map(m => ({ id: m.id, efforts: m.efforts })) });
    }
  } catch (error) { report.push({ kind, success: false, message: controller.signal.aborted ? 'Timed out waiting for CLI model metadata' : error.message }); }
  finally { clearTimeout(timeout); await rm(directory, { recursive: true, force: true }); }
}
await writeFile(path.join(root, answerTest ? '.cache/local-cli-answer-report.json' : '.cache/local-cli-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
