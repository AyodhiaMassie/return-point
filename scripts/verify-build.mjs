import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';

const output = resolve('dist');
const manifest = JSON.parse(readFileSync(resolve(output, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background.type, 'module');
assert.ok(!manifest.host_permissions?.length, 'Website access must be optional.');
assert.ok(!manifest.content_scripts?.length, 'No persistent scroll tracking scripts.');
assert.ok(existsSync(resolve(output, manifest.background.service_worker)), 'Missing background bundle.');
const panelPath = resolve(output, manifest.side_panel.default_path);
assert.ok(existsSync(panelPath), 'Missing side panel document.');
const html = readFileSync(panelPath, 'utf8');
for (const [, asset] of html.matchAll(/(?:src|href)="(\.\/[^"?#]+)"/g)) {
  assert.ok(existsSync(resolve(dirname(panelPath), asset)), `Missing panel asset: ${asset}`);
}
assert.ok(!html.includes('/src/'), 'The panel must reference built JavaScript.');
console.log('Verified: loadable MV3 manifest, background worker, and side panel assets.');
