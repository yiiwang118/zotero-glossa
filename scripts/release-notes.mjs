import { readFile } from 'node:fs/promises';

/** Prints the CHANGELOG.md section for one version, used as the GitHub release body. */
const version = process.argv[2];
if (!version) throw new Error('Usage: node scripts/release-notes.mjs <version>');
const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const lines = changelog.split('\n');
const start = lines.findIndex(line => line.startsWith(`## ${version}`));
if (start < 0) throw new Error(`CHANGELOG.md has no section for ${version}`);
const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
const body = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
if (!body) throw new Error(`The CHANGELOG.md section for ${version} is empty`);
process.stdout.write(`${body}\n\n**Install:** download \`glossa-zotero-${version}.xpi\` below, then in Zotero open *Tools → Plugins* and drag the file into the window. Installed copies update automatically.\n`);
