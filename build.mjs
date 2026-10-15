import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { validateManifest } from './scripts/manifest.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const addon = path.join(dist, 'addon');
await mkdir(dist, { recursive: true });
await rm(addon, { recursive: true, force: true });
await cp(path.join(root, 'addon'), addon, { recursive: true });
await cp(path.join(root, 'LICENSE'), path.join(addon, 'LICENSE'));
await cp(path.join(root, 'node_modules/temml/LICENSE'), path.join(addon, 'THIRD-PARTY-temml-LICENSE.txt'));
const manifest = JSON.parse(await readFile(path.join(addon, 'manifest.json'), 'utf8'));
validateManifest(manifest);
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version) throw new Error('Package/manifest version mismatch');
const result = await build({
  absWorkingDir: root,
  entryPoints: [path.join(root, 'src/index.ts')],
  bundle: true, outfile: path.join(addon, 'glossa.js'),
  format: 'iife', globalName: 'GlossaZotero', platform: 'browser',
  target: 'firefox140', charset: 'utf8', metafile: true,
  legalComments: 'none',
  loader: { '.css': 'text' },
});
// The only runtime dependency is Temml (LaTeX → MathML, MIT); its license ships in the XPI.
if (Object.keys(result.metafile.inputs).some(p => /src\/providers\/local_cli/.test(p) || (/node_modules/.test(p) && !/node_modules\/temml\//.test(p)))) {
  throw new Error('Unexpected runtime dependency in Zotero bundle');
}
for (const input of Object.keys(result.metafile.inputs)) {
  const relative = path.relative(root, path.resolve(root, input));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Bundle source is outside this project: ${input}`);
  }
}
const artifact = path.join(dist, `glossa-zotero-${manifest.version}.xpi`);
execFileSync('python3', ['-c', `
import sys, zipfile, pathlib
root=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED) as z:
    for file in sorted(root.rglob('*')):
        if not file.is_file(): continue
        entry=zipfile.ZipInfo(file.relative_to(root).as_posix(), (2026, 1, 1, 0, 0, 0))
        entry.compress_type=zipfile.ZIP_DEFLATED
        entry.external_attr=0o644 << 16
        z.writestr(entry, file.read_bytes())
with zipfile.ZipFile(sys.argv[2]) as z:
    assert z.testzip() is None
    assert {'manifest.json', 'bootstrap.js', 'glossa.js', 'workspace.xhtml'} <= set(z.namelist())
`, addon, artifact], { stdio: 'inherit' });
console.log(`Built ${artifact}`);
const sha = createHash('sha256').update(await readFile(artifact)).digest('hex');
await writeFile(`${artifact}.sha256`, `${sha}  ${path.basename(artifact)}\n`);
console.log(`SHA-256 ${sha}`);
// Zotero's update manifest. manifest.json points update_url at the latest release's copy of this file, so every release
// publishes it next to the XPI it describes.
const repository = pkg.repository.url.replace(/\.git$/, '');
const zotero = manifest.applications.zotero;
const updates = { addons: { [zotero.id]: { updates: [{
  version: manifest.version,
  update_link: `${repository}/releases/download/${manifest.version}/${path.basename(artifact)}`,
  update_hash: `sha256:${sha}`,
  applications: { zotero: { strict_min_version: zotero.strict_min_version, strict_max_version: zotero.strict_max_version } },
}] } } };
await writeFile(path.join(dist, 'updates.json'), `${JSON.stringify(updates, null, 2)}\n`);
console.log(`Update manifest ${path.join(dist, 'updates.json')}`);
