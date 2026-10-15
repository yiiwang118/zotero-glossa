// Production UI in an isolated Firefox profile, against a loopback SSE server and synthetic papers.
// No Zotero profile, real library, credentials, or user browser session is accessed.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const browsers = require(process.env.GLOSSA_PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.GLOSSA_BROWSER || 'firefox';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.cache/browser'); await mkdir(out, { recursive: true });
const result = await build({ stdin: { resolveDir: root, contents: `
import { Panel } from './src/ui/panel'; import { Store } from './src/core/store'; import { Research } from './src/core/research';
import { SelectionTranslation } from './src/ui/translation';
const store = new Store({read:async()=>null,write:async value=>{window.saved=JSON.parse(value);}});
store.state.settings.endpoints=[{id:'api', name:'Test API', baseUrl:location.origin+'/api', model:'fixture', models:['fixture','fixture-2'], apiStyle:'openai', encryptedKey:'', effort:''}];
store.state.settings.endpointID='api';
const paper={libraryID:1,key:'PAPER001'};
const sources=[{id:'S1',item:paper,title:'研究样本文献 · Reproducible literature workflows',kind:'selection',text:'Structured reading improves evidence traceability.',attachmentKey:'PDF00001',pageIndex:2,pageLabel:'3'}];
window.writes=[];window.opened=[];window.exports=[];
const host={controller:()=>new AbortController(),snapshot:async()=>({items:[paper],titles:[sources[0].title],sources,warnings:[]}),
decrypt:async v=>v,encrypt:async v=>'encrypted:'+v,sourceURL:()=> 'zotero://open-pdf/library/items/PDF00001?page=3',
openSource:async s=>window.opened.push(s),saveNote:async (target,html)=>{window.writes.push({target,html});return {libraryID:1,key:'NOTE0001'};},
copyText:text=>window.copied=text,exportFile:async(name,text)=>window.exports.push({name,text}),importFile:async()=>null};
const research=new Research(store,host,(url,init)=>fetch(url,init));
window.remount=()=>{window.panel=new Panel(document.getElementById('mount'),research,(url,init)=>fetch(url,init),{workspace:true,openWorkspace(){}});window.panel.setContext([paper],[sources[0].title]);};
window.remount();window.store=store;
window.quickTranslate=()=>new SelectionTranslation(document,research,{attachment:paper,text:'Only this selected sentence.',pageLabel:'3'},
 {left:innerWidth-60,top:innerHeight-50,bottom:innerHeight-20},{configure(){window.panel.showSettings();},openChat(selection){window.asked=selection;},closed(){}});
` }, bundle: true, format: 'iife', write: false, target: 'firefox140' });
const bundle = result.outputFiles[0].text;
const css = await readFile(path.join(root, 'addon/glossa.css'), 'utf8');
const requests = []; const errors = []; const pending = new Map();
const server = createServer(async (req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Glossa isolated UI test</title><style>${css}body{margin:0;background:#f5f6f8}#mount{height:100vh;padding:12px;box-sizing:border-box}.glossa-panel{height:100%;max-height:none}</style><main id="mount"></main><script>${bundle}</script></html>`); return; }
  if (req.url === '/api/models') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'fixture' }, { id: 'fixture-2' }] })); return; }
  if (req.url === '/api/chat/completions') {
    let body = ''; for await (const chunk of req) body += chunk; requests.push(JSON.parse(body));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const background = requests.at(-1).messages.at(-1).content.match(/^BACKGROUND_[AB]/)?.[0];
    if (background) {
      res.write('data: '+JSON.stringify({ choices:[{delta:{content:'Background partial '+background}}]})+'\n\n');
      pending.set(background, res); res.on('close', () => pending.delete(background)); return;
    }
    const answer = '## 研究概括\n\n**研究问题**：如何让文献阅读更可追溯？\n\n- 方法：保存证据来源。\n- 发现：可回跳的引用有助于复核 [S1]。\n\n> 请结合原文核对结论。\n\n| 维度 | 结论 |\n| --- | --- |\n| 证据 | 原文可定位 [S1] |\n| 局限 | 仅为测试文献 |';
    for (const text of answer.match(/.{1,20}|\n/g)) res.write('data: '+JSON.stringify({ choices:[{delta:{content:text}}]})+'\n\n');
    res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'); return;
  }
  res.writeHead(404); res.end();
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/`;
let browser;
const checks = [];
try {
  // GLOSSA_BROWSER_EXECUTABLE lets playwright-core drive an installed browser instead of a downloaded one.
  const executablePath = process.env.GLOSSA_BROWSER_EXECUTABLE;
  browser = await browsers[engine].launch({ headless: true, timeout: 30000, ...(executablePath ? { executablePath } : {}), ...(engine === 'chromium' ? { chromiumSandbox: true } : {}) });
  console.log('Isolated browser started:', engine);
  const page = await browser.newPage({ viewport: { width: 960, height: 850 } });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => { errors.push(error.message); console.error('Fixture page error:', error.message); });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  console.log('Fixture loaded');
  const composer = page.getByRole('textbox', { name: '输入问题' });
  await page.getByRole('heading', { name: 'Glossa', exact: true }).waitFor();
  await page.screenshot({ path: path.join(out, 'workspace-empty.png') });
  assert.ok(await page.getByRole('button', { name: '发送', exact: true }).isDisabled());
  assert.equal(await page.locator('datalist').count(), 0);
  await page.getByRole('button', { name: '总结这篇文献（/summarize）', exact: true }).click();
  assert.equal(await composer.inputValue(), '/summarize ');
  assert.equal(requests.length, 0);
  await composer.fill('/');
  await page.getByRole('option', { name: /总结这篇文献/ }).click();
  assert.equal(await composer.inputValue(), '/summarize ');
  await composer.fill('/');
  await composer.press('ArrowDown'); await composer.press('Enter');
  assert.equal(await composer.inputValue(), '/translate ', 'Enter picks the highlighted command instead of sending');
  await composer.fill('');
  const modelButton = page.getByRole('button', { name: '选择模型', exact: true });
  await modelButton.click();
  await page.getByRole('textbox', { name: '搜索或输入模型 ID' }).fill('fixture-2');
  await page.getByRole('menuitemradio', { name: 'Test API：fixture-2', exact: true }).click();
  assert.match(await modelButton.getAttribute('title'), /fixture-2/);
  await modelButton.click(); await page.getByRole('menuitemradio', { name: 'Test API：fixture', exact: true }).click();
  await page.getByRole('button', { name: '推理强度', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '推理强度：high', exact: true }).click();
  assert.equal((await page.getByRole('button', { name: '推理强度', exact: true }).textContent()).trim(), 'high');
  await page.getByRole('button', { name: '推理强度', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '推理强度：自动', exact: true }).click();
  const layoutCheck = async label => {
    for (const width of [320, 390, 960]) for (const colorScheme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 850 }); await page.emulateMedia({ colorScheme });
      await page.screenshot({ path: path.join(out, `${label}-${width}-${colorScheme}.png`) });
      const layout = await page.evaluate(() => {
        const panel = document.querySelector('.glossa-panel'), compose = document.querySelector('.glossa-compose');
        const inside = (node) => { const a = node.getBoundingClientRect(), b = compose.getBoundingClientRect(); return a.left >= b.left - 1 && a.right <= b.right + 1; };
        return { panelOverflow: panel.scrollWidth > panel.clientWidth + 1, composeOverflow: compose.scrollWidth > compose.clientWidth + 1,
          sendVisible: document.querySelector('.glossa-send').getBoundingClientRect().bottom <= innerHeight,
          controlsInside: [...document.querySelectorAll('.glossa-compose-bottom > *')].every(inside) };
      });
      assert.deepEqual(layout, { panelOverflow: false, composeOverflow: false, sendVisible: true, controlsInside: true }, `${label} ${width} ${colorScheme}`);
    }
    await page.setViewportSize({ width: 960, height: 850 }); await page.emulateMedia({ colorScheme: 'light' });
  };
  await layoutCheck('home');
  checks.push('Glossa home, quick commands, keyboard slash-command menu, searchable model and effort menus in all widths and themes');
  await composer.fill('请概括这篇文献，并列出方法与局限。');
  await page.getByRole('button', { name: '发送' }).click();
  await page.getByRole('button', { name: '保存为笔记' }).waitFor();
  assert.equal(requests.length, 1); assert.match(requests[0].messages.at(-1).content, /Structured reading/);
  await page.getByRole('button', { name: '[S1]', exact: true }).first().click();
  assert.equal(await page.evaluate(() => window.opened[0].pageIndex), 2);
  await page.getByRole('button', { name: '复制', exact: true }).click();
  assert.match(await page.evaluate(() => window.copied), /研究概括/);
  await page.getByRole('button', { name: '1 个来源' }).click();
  await page.getByText('Structured reading improves evidence traceability.').waitFor();
  checks.push('loopback SSE → production Research → rendered answer → citation, copy and sources');
  await page.getByRole('button', { name: '保存为笔记' }).click();
  await page.getByRole('button', { name: '切换到 Act 并创建', exact: true }).click();
  await page.getByText(/^已保存为「/).waitFor();
  assert.equal(await page.evaluate(() => window.writes.length), 1);
  assert.match(await page.evaluate(() => window.writes[0].html), /zotero:\/\/open-pdf/);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Act', exact: true }).getAttribute('aria-pressed'), 'true');
  checks.push('Plan → preview → one confirmed click switches to Act and saves one native-host note');
  await page.getByRole('button', { name: '历史', exact: true }).click();
  await page.getByRole('button', { name: '更多历史操作' }).click();
  await page.getByRole('textbox', { name: '新目录名称' }).fill('测试研究');
  await page.getByRole('button', { name: '创建目录', exact: true }).click();
  await page.getByRole('combobox', { name: '筛选目录' }).selectOption('*');
  await page.getByRole('button', { name: /^对话操作：/ }).first().click();
  await page.getByRole('menuitemradio', { name: /到 测试研究$/ }).click();
  await page.getByRole('button', { name: /^对话操作：/ }).first().click();
  await page.getByRole('menuitem', { name: '导出 Markdown' }).click();
  await page.getByRole('button', { name: '更多历史操作' }).click();
  await page.getByRole('button', { name: '备份全部历史' }).click();
  assert.equal(await page.evaluate(() => window.exports.length), 2);
  assert.equal(await page.evaluate(() => JSON.parse(window.exports[1].text).format), 'glossa-zotero-history');
  assert.equal(await page.evaluate(() => window.saved.conversations[0].folderID), await page.evaluate(() => window.saved.folders[0].id));
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  checks.push('history folder move via row menu + credential-free JSON backup + Markdown export');
  await page.getByRole('button', { name: '历史', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.getByRole('button', { name: '历史', exact: true }).evaluate(e => e === document.activeElement), true);
  checks.push('Escape closes sheets and restores keyboard focus');
  await layoutCheck('chat');
  checks.push('320 / 390 / 960 px, light / dark with a conversation: no horizontal overflow; composer controls and send stay visible');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型服务', exact: true }).click();
  await page.getByRole('button', { name: '编辑 Test API', exact: true }).click();
  await page.getByRole('button', { name: '获取模型列表', exact: true }).click();
  await page.getByText('已获取 2 个模型，点击即可填入。', { exact: true }).waitFor();
  await page.emulateMedia({ colorScheme: 'dark' }); await page.screenshot({ path: path.join(out, 'settings-dark.png') }); await page.emulateMedia({ colorScheme: 'light' });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 700 });
    await page.getByRole('button', { name: '保存配置', exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    assert.ok(await page.getByRole('button', { name: '保存配置', exact: true }).isVisible());
  }
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '常规', exact: true }).click();
  await page.getByRole('button', { name: '独立窗口', exact: true }).click();
  await page.getByRole('switch', { name: '选中文字后自动翻译', exact: true }).check();
  assert.equal(await page.evaluate(() => window.saved.settings.openMode), 'window');
  assert.equal(await page.evaluate(() => window.saved.settings.autoTranslate), true);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  checks.push('settings tabs, service editor, model discovery and remembered window/auto-translate preferences');
  for (const width of [320, 960]) for (const colorScheme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 700 }); await page.emulateMedia({ colorScheme });
    await page.evaluate(() => window.quickTranslate());
    const popup = page.getByRole('dialog', { name: 'Glossa 快速翻译', exact: true });
    await popup.getByText('已翻译 · fixture', { exact: true }).waitFor();
    const bounds = await popup.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 700);
    await popup.getByRole('button', { name: '复制译文', exact: true }).click();
    assert.match(await page.evaluate(() => window.copied), /研究概括/);
    assert.deepEqual(JSON.parse(requests.at(-1).messages.at(-1).content), { selection: 'Only this selected sentence.' });
    await page.screenshot({ path: path.join(out, `translation-${width}-${colorScheme}.png`) });
    await popup.getByRole('button', { name: '关闭翻译', exact: true }).press('Escape');
    assert.equal(await popup.count(), 0);
  }
  checks.push('one-click selection-only SSE translation, copy, Escape and edge positioning');
  await page.evaluate(() => window.quickTranslate());
  const quick = page.getByRole('dialog', { name: 'Glossa 快速翻译', exact: true });
  await quick.getByText('已翻译 · fixture', { exact: true }).waitFor();
  await quick.getByRole('switch', { name: '划词后自动翻译' }).uncheck();
  assert.equal(await page.evaluate(() => window.saved.settings.autoTranslate), false);
  await quick.getByRole('button', { name: '询问', exact: true }).click();
  assert.equal(await quick.count(), 0); assert.equal(await page.evaluate(() => window.asked.text), 'Only this selected sentence.');
  for (const suffix of ['A', 'B']) {
    await page.getByRole('button', { name: '新建对话', exact: true }).click();
    await composer.fill('BACKGROUND_'+suffix);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByText('Background partial BACKGROUND_'+suffix, { exact: true }).waitFor();
  }
  assert.equal(pending.size, 2);
  await page.evaluate(() => {window.panel.dispose();window.remount();});
  await page.getByRole('button', { name: '历史', exact: true }).click();
  assert.equal(await page.locator('.glossa-history-running:visible').count(), 2);
  for (const colorScheme of ['light', 'dark']) {
    await page.setViewportSize({ width: 390, height: 700 }); await page.emulateMedia({ colorScheme });
    await page.screenshot({ path: path.join(out, 'history-running-'+colorScheme+'.png') });
    assert.equal(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
  }
  pending.get('BACKGROUND_A').end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
  await page.waitForFunction(() => document.querySelectorAll('.glossa-history-running:not([hidden])').length===1);
  await page.getByRole('button', { name: 'BACKGROUND_B', exact: true }).click();
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.getByText('已停止', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: '历史', exact: true }).click();
  assert.equal(await page.locator('.glossa-history-running:visible').count(), 0);
  checks.push('two simultaneous SSE requests survive new chat/view disposal; live history badges clear on completion or targeted stop; popup automatic toggle and ask action');
  assert.deepEqual(errors, []); checks.push('browser model discovery and no page errors');
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ engine, browser: await browser.version(), checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, screenshots: out, errors }, null, 2));
} finally { await browser?.close(); server.close(); }
