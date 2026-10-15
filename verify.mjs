import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { validateManifest } from './scripts/manifest.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const addon = path.join(root, 'dist/addon');
const bootstrap = await readFile(path.join(addon, 'bootstrap.js'), 'utf8');
const bundle = await readFile(path.join(addon, 'glossa.js'), 'utf8');
const manifest = JSON.parse(await readFile(path.join(addon, 'manifest.json'), 'utf8'));
validateManifest(manifest);
const registered = new Set();
let chromeRegistered = false;
const sandbox = createContext({
  crypto: globalThis.crypto, URL, URLSearchParams, TextDecoder, TextEncoder, setTimeout, clearTimeout,
  IOUtils: { exists: async () => false }, PathUtils: { join: path.join },
  Zotero: { initializationPromise: Promise.resolve(), uiReadyPromise: Promise.resolve(), DataDirectory: { dir: '/fixture-only' }, getMainWindows: () => [],
    ItemPaneManager: { registerSection: o => { registered.add(o.paneID); return o.paneID; }, unregisterSection: id => registered.delete(id) },
    MenuManager: { registerMenu: o => { registered.add(o.menuID); return o.menuID; }, unregisterMenu: id => registered.delete(id) },
    Reader: { registerEventListener: type => registered.add(type), unregisterEventListener: type => registered.delete(type) },
    debug() {},
  },
  Ci: { amIAddonManagerStartup: 'addon-manager-startup' },
  Cc: { '@mozilla.org/addons/addon-manager-startup;1': { getService: () => ({ registerChrome: (uri, entries) => {
    assert.equal(uri, 'file:///fixture-only/manifest.json');
    // Each instance owns a uniquely named package, so a predecessor still shutting down cannot unregister it.
    const [[kind, name, root], ...rest] = JSON.parse(JSON.stringify(entries));
    assert.deepEqual([kind, root, rest.length], ['content', './', 0]); assert.match(name, /^glossa-zotero-[a-z0-9]+$/);
    assert.equal(chromeRegistered, false); chromeRegistered = true;
    return { destruct() { assert.equal(chromeRegistered, true); chromeRegistered = false; } };
  } }) } },
  Services: { io: { newURI: value => value }, scriptloader: { loadSubScript: (_url, scope) => {
    assert.equal(scope.Zotero.DataDirectory.dir, '/fixture-only'); runInContext(bundle, sandbox, { filename: 'packaged-glossa.js' });
  } } },
});
runInContext(bootstrap, sandbox, { filename: 'packaged-bootstrap.js' });
await runInContext(`startup(${JSON.stringify({ id: manifest.applications.zotero.id, rootURI: 'file:///fixture-only/' })})`, sandbox);
assert.equal(registered.size, 4);
assert.equal(chromeRegistered, true);
await runInContext('shutdown()', sandbox);
assert.equal(registered.size, 0);
assert.equal(chromeRegistered, false);
// Resource registrations must also be released when loading the bundle fails.
sandbox.Services.scriptloader.loadSubScript = () => { throw new Error('Fixture load failure'); };
await assert.rejects(runInContext(`startup(${JSON.stringify({ id: manifest.applications.zotero.id, rootURI: 'file:///fixture-only/' })})`, sandbox), /Fixture load failure/);
assert.equal(chromeRegistered, false);
for (const locale of ['en-US', 'zh-CN']) {
  const ftl = await readFile(path.join(addon, 'locale', locale, 'glossa-zotero.ftl'), 'utf8');
  for (const key of ['section', 'open', 'items']) assert.match(ftl, new RegExp(`glossa-zotero-${key} =\\s*\\n\\s+\\.label = \\S`));
  assert.match(ftl, /glossa-zotero-sidenav =\s*\n\s+\.tooltiptext = \S/);
}
assert.equal(manifest.version, JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version);
// The update manifest must describe exactly the XPI that was built.
const { createHash } = await import('node:crypto');
const xpi = path.join(root, 'dist', `glossa-zotero-${manifest.version}.xpi`);
const updates = JSON.parse(await readFile(path.join(root, 'dist/updates.json'), 'utf8'));
const [update, ...older] = updates.addons[manifest.applications.zotero.id].updates;
assert.equal(older.length, 0);
assert.equal(update.version, manifest.version);
assert.equal(update.update_hash, `sha256:${createHash('sha256').update(await readFile(xpi)).digest('hex')}`);
assert.equal(new URL(update.update_link).protocol, 'https:');
assert.ok(update.update_link.endsWith(`/releases/download/${manifest.version}/glossa-zotero-${manifest.version}.xpi`));
assert.deepEqual(update.applications.zotero, { strict_min_version: manifest.applications.zotero.strict_min_version, strict_max_version: manifest.applications.zotero.strict_max_version });
console.log('Packaged bootstrap, privileged-scope loading, lifecycle cleanup, Fluent labels, manifest and update manifest verified.');
