import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(rootDir, 'src/index.babel.html'), 'utf8');

for (const marker of [
  'beginClientDrag',
  'beginFamilyDrag',
  'handleFamilyDrop',
  'handleTierDrop',
  'application/x-policylens-client',
  'application/x-policylens-family',
  'Drag household',
  'Drag a client or household here',
  'Drop to move here'
]) {
  assert.ok(source.includes(marker), `expected Clients drag/drop marker: ${marker}`);
}

assert.match(
  source,
  /onDrop=\{e => handleFamilyDrop\(e, group\)\}/,
  'family cards should accept client/household drops'
);
assert.match(
  source,
  /onDrop=\{e => handleTierDrop\(e, tier\)\}/,
  'tier sections should accept client drops'
);
assert.match(
  source,
  /onDrop=\{e => handleTierDrop\(e, c\.id\)\}/,
  'tier filter chips should accept client drops'
);
assert.match(
  source,
  /display:'none',padding:'10px 14px',borderBottom:'1px solid rgba\(255,255,255,\.055\)'/,
  'legacy relationship-map detail should stay hidden behind the simpler household strip'
);

console.log('Clients drag/drop affordance checks passed.');
