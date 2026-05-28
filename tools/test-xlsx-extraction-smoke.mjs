// Cross-workbook xlsx extraction smoke test.
//
// PURPOSE
//   The Soh-family regression test pins a specific workbook to a hand-curated
//   truth file. But FC summary workbooks come in many flavours (Anne, Eunice,
//   Tan Kah Lan, etc.) and we have no truth file for those. This smoke test
//   runs extraction across ALL discoverable workbooks and asserts structural
//   invariants that any honest extraction should satisfy:
//
//     1. extraction completes without throwing
//     2. at least one policy is extracted per workbook
//     3. ≥60% of policies have an insurer (real FC books rarely beat this)
//     4. ≥50% of policies have a premium amount (some legacy/paid-up rows have none)
//     5. ≥80% of policies have a productName (the parser should always name the row)
//     6. No "(unnamed)" rider when the rider type slot was clearly filled
//
// Catches the kind of regression where a parser change silently nukes 90% of
// premium fields, or where insurer inference breaks for a common pattern.
//
// USAGE
//   node tools/test-xlsx-smoke.mjs               # auto-discover from Downloads
//   node tools/test-xlsx-smoke.mjs <path1> <path2>...   # explicit list
//
// EXIT CODES
//   0 = all workbooks passed (or no workbooks found → friendly skip)
//   1 = at least one workbook failed an assertion
//   2 = setup error

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { extractAllSheets, pipelineVersion } from './lib/extract-xlsx.mjs';

// ── Color helpers ──
const isTTY = process.stdout.isTTY;
const c = (s, code) => isTTY ? '\x1b[' + code + 'm' + s + '\x1b[0m' : s;
const red    = s => c(s, '31');
const green  = s => c(s, '32');
const yellow = s => c(s, '33');
const cyan   = s => c(s, '36');
const dim    = s => c(s, '90');
const bold   = s => c(s, '1');

// ── Workbook discovery ──
function discoverWorkbooks() {
  // The Soh family fixture lives at this canonical path on the FC's machine.
  // We extend the search to the same Downloads directory looking for files
  // matching common policy-summary naming patterns.
  const downloadsDir = path.join(os.homedir(), 'Downloads');
  if (!fs.existsSync(downloadsDir)) return [];
  const all = fs.readdirSync(downloadsDir);
  const pattern = /policy\s*summary.*\.xlsx$|policy summary report.*\.xlsx$/i;
  return all.filter(f => pattern.test(f) && !f.startsWith('~$')).map(f => path.join(downloadsDir, f));
}

// ── Invariant checks ──
function normalizeHeader(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasSourcePremiumValue(policy) {
  const raw = policy && policy._rawSpreadsheetRow && typeof policy._rawSpreadsheetRow === 'object'
    ? policy._rawSpreadsheetRow
    : {};
  for (const [key, value] of Object.entries(raw)) {
    const header = normalizeHeader(key);
    if (!/\bpremium\b/.test(header)) continue;
    if (/\b(paid|term|mode|frequency|end|start|min|minimum|face)\b/.test(header)) continue;
    const text = String(value == null ? '' : value).trim();
    if (!text || /^[-\u2013\u2014]+$/.test(text)) return false;
    return /\d/.test(text);
  }
  return false;
}

function checkWorkbook(filePath) {
  const result = {
    file: path.basename(filePath),
    ok: true,
    failures: [],
    stats: { sheets: 0, sections: 0, policies: 0, withInsurer: 0, withProduct: 0, withPremium: 0, premiumExpected: 0, withExpectedPremium: 0, unnamedRiders: 0, totalRiders: 0 }
  };

  let extraction;
  try { extraction = extractAllSheets(filePath); }
  catch (err) {
    result.ok = false;
    result.failures.push('extraction threw: ' + (err.message || err));
    return result;
  }

  // Tally
  for (const [sheetName, sheetData] of Object.entries(extraction)) {
    result.stats.sheets++;
    result.stats.sections += (sheetData.sections || []).length;
    for (const p of (sheetData.policies || [])) {
      result.stats.policies++;
      if (p.insurer && String(p.insurer).trim() && !/^unknown$/i.test(p.insurer)) result.stats.withInsurer++;
      if (p.productName || p.policyName) result.stats.withProduct++;
      const prem = parseFloat(p.premiumAmount);
      if (Number.isFinite(prem) && prem > 0) result.stats.withPremium++;
      if (hasSourcePremiumValue(p)) {
        result.stats.premiumExpected++;
        if (Number.isFinite(prem) && prem > 0) result.stats.withExpectedPremium++;
      }
      for (const rd of (p._ridersOut || [])) {
        result.stats.totalRiders++;
        if (rd === '(unnamed)') result.stats.unnamedRiders++;
      }
    }
  }

  const s = result.stats;
  const pct = (n) => s.policies > 0 ? Math.round(n / s.policies * 100) : 0;

  // Assertions
  if (s.policies < 1) {
    result.ok = false;
    result.failures.push('0 policies extracted (workbook produced no rows the parser recognised)');
  }
  if (s.policies > 0) {
    const insurerPct = pct(s.withInsurer);
    if (insurerPct < 60) {
      result.ok = false;
      result.failures.push('only ' + insurerPct + '% of ' + s.policies + ' policies have insurer (threshold 60%)');
    }
    const productPct = pct(s.withProduct);
    if (productPct < 80) {
      result.ok = false;
      result.failures.push('only ' + productPct + '% of ' + s.policies + ' policies have productName (threshold 80%)');
    }
    const premPct = pct(s.withPremium);
    if (premPct < 50) {
      result.ok = false;
      result.failures.push('only ' + premPct + '% of ' + s.policies + ' policies have premium amount (threshold 50%)');
    }
    if (s.premiumExpected > 0) {
      const expectedPremPct = Math.round(s.withExpectedPremium / s.premiumExpected * 100);
      if (expectedPremPct < 95) {
        result.ok = false;
        result.failures.push('only ' + expectedPremPct + '% of ' + s.premiumExpected + ' source premium cells were parsed (threshold 95%)');
      }
    }
  }
  if (s.totalRiders > 0) {
    const unnamedPct = Math.round(s.unnamedRiders / s.totalRiders * 100);
    if (unnamedPct > 20) {
      result.ok = false;
      result.failures.push(unnamedPct + '% of ' + s.totalRiders + ' riders are "(unnamed)" (threshold 20%)');
    }
  }

  return result;
}

// ── Main ──
const args = process.argv.slice(2);
const workbooks = args.length > 0 ? args : discoverWorkbooks();

if (workbooks.length === 0) {
  console.log(dim('xlsx smoke test: no workbooks found in ~/Downloads matching *Policy Summary*.xlsx'));
  console.log(dim('  (fixture-dependent test, local-only — skipping)'));
  process.exit(0);
}

console.log(dim('PolicyLens xlsx smoke test'));
console.log(dim('==========================='));
console.log(dim('pipeline: ' + pipelineVersion));
console.log(dim('workbooks: ' + workbooks.length));
console.log('');

let anyFail = false;
const summaries = [];
for (const wb of workbooks) {
  const r = checkWorkbook(wb);
  summaries.push(r);
  if (!r.ok) anyFail = true;

  const status = r.ok ? green('  PASS') : red('  FAIL');
  const s = r.stats;
  const pct = (n) => s.policies > 0 ? Math.round(n / s.policies * 100) : 0;
  console.log(status + ' ' + bold(r.file));
  console.log(dim('         sheets=' + s.sheets + ' sections=' + s.sections + ' policies=' + s.policies +
    ' insurer=' + pct(s.withInsurer) + '%' +
    ' product=' + pct(s.withProduct) + '%' +
    ' premium=' + pct(s.withPremium) + '%' +
    (s.premiumExpected > 0 ? ' sourcePremium=' + Math.round(s.withExpectedPremium / s.premiumExpected * 100) + '% (' + s.withExpectedPremium + '/' + s.premiumExpected + ')' : '') +
    ' riders=' + s.totalRiders + ' (unnamed=' + s.unnamedRiders + ')'));
  for (const f of r.failures) console.log(red('         ✗ ' + f));
}

console.log('');
const passed = summaries.filter(r => r.ok).length;
const failed = summaries.length - passed;
if (failed === 0) {
  console.log(green(bold('xlsx smoke test passed') + ' (' + passed + '/' + summaries.length + ' workbooks)'));
  process.exit(0);
} else {
  console.log(red(bold('xlsx smoke test FAILED') + ' (' + failed + '/' + summaries.length + ' workbooks failed)'));
  process.exit(1);
}
