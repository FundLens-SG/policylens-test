import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(rootDir, 'src/index.babel.html'), 'utf8');
const start = source.indexOf('const FAMILY_NAME_STOPWORDS');
const end = source.indexOf('// rc2e.47: Normalize person-name fields');

assert.ok(start > 0 && end > start, 'expected family-name helper block in src/index.babel.html');

function cleanPersonDisplayName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(mr|mrs|ms|mdm|madam|dr|miss|master|mstr)\.?\s+/i, '')
    .replace(/\b[a-z]/g, ch => ch.toUpperCase());
}

function normalizePersonNameKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const helperBlock = source.slice(start, end);
const buildHarness = new Function(
  'cleanPersonDisplayName',
  'normalizePersonNameKey',
  helperBlock + `
return {
  extractPolicyLensFamilyNameTokens,
  inferPolicyLensFamilyNameToken,
  policyLensFamilyGroupFromToken,
  formatPolicyLensFamilyGroupInput,
  splitPolicyLensFamilyGroupLabel,
  buildPolicyLensDashboardFamilyHero
};`
);

const helpers = buildHarness(cleanPersonDisplayName, normalizePersonNameKey);

const sophia = 'Sophia Yeo Hui Kuan (yang Huijuan)';
assert.deepEqual(
  helpers.extractPolicyLensFamilyNameTokens(sophia),
  ['Sophia', 'Yeo', 'Hui', 'Kuan', 'Yang', 'Huijuan']
);
assert.equal(helpers.inferPolicyLensFamilyNameToken(sophia), 'Yeo');
assert.equal(helpers.policyLensFamilyGroupFromToken('Yeo'), 'Yeo Family');
assert.equal(helpers.formatPolicyLensFamilyGroupInput('Yeo'), 'Yeo Family');
assert.equal(helpers.formatPolicyLensFamilyGroupInput('Yeo Household'), 'Yeo Household');
assert.deepEqual(
  helpers.splitPolicyLensFamilyGroupLabel('Yeo Family Review'),
  { word: 'Yeo', tail: 'family', full: 'Yeo Family Review' }
);

const explicitHero = helpers.buildPolicyLensDashboardFamilyHero(
  { name: sophia, familyGroup: 'Yeo Family' },
  {},
  'Sophia'
);
assert.equal(explicitHero.word, 'Yeo');
assert.equal(explicitHero.tail, 'family');
assert.equal(explicitHero.explicit, true);

const fallbackHero = helpers.buildPolicyLensDashboardFamilyHero(
  { name: sophia },
  {},
  'Sophia'
);
assert.equal(fallbackHero.word, 'Yeo');
assert.equal(fallbackHero.tail, 'family');
assert.equal(fallbackHero.explicit, false);

console.log('Family name customisation checks passed.');
