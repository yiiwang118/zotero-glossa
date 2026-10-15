import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateManifest } from './manifest.mjs';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('addon/manifest.json', root), 'utf8'));
validateManifest(manifest);
assert.match(pkg.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Use a numeric release version, e.g. 0.1.0');
assert.equal(manifest.version, pkg.version, 'Package and addon manifest versions must match');
const repository = pkg.repository?.url?.replace(/\.git$/, '');
assert.match(repository || '', /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/, 'package.json needs the GitHub repository URL');
assert.equal(manifest.applications.zotero.update_url, `${repository}/releases/latest/download/updates.json`,
  'update_url must point at updates.json in the latest GitHub release of this repository');
const cli = await readFile(new URL('src/core/cli.ts', root), 'utf8');
assert.ok(cli.includes(`version: '${pkg.version}' }`), 'CLIENT_INFO in src/core/cli.ts must report the package version');
const tag = process.argv[2];
if (tag !== undefined) assert.equal(tag, pkg.version, 'Release tag must exactly match the manifest version, without a v prefix');
console.log(`Release metadata verified: ${pkg.version}${tag === undefined ? '' : ` (tag ${tag})`}`);
