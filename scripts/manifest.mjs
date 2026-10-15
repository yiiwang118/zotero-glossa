import assert from 'node:assert/strict';

/** Match the required Zotero fields enforced by ExtensionData.parseManifest. */
export function validateManifest(manifest) {
  assert.equal(manifest.manifest_version, 2, 'Zotero requires manifest_version 2');
  assert.ok(manifest.name?.trim(), 'Plugin name is required');
  assert.ok(manifest.version?.trim(), 'Plugin version is required');
  const zotero = manifest.applications?.zotero;
  for (const field of ['id', 'update_url', 'strict_min_version', 'strict_max_version']) {
    assert.ok(typeof zotero?.[field] === 'string' && zotero[field].trim(), `applications.zotero.${field} is required`);
  }
  assert.equal(new URL(zotero.update_url).protocol, 'https:', 'Use HTTPS for plugin updates');
  assert.ok(!zotero.strict_min_version.includes('*'), 'Minimum version cannot contain a wildcard');
}
