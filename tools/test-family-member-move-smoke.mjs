import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { existsSync, mkdirSync, readFile, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const edgeCandidates = [
  process.env.POLICYLENS_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

function findBrowser() {
  const found = edgeCandidates.find(candidate => existsSync(candidate));
  if (!found) throw new Error('No supported browser found. Set POLICYLENS_BROWSER to Edge or Chrome.');
  return found;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  return 'application/octet-stream';
}

function startServer() {
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      let pathname = decodeURIComponent(url.pathname || '/');
      if (pathname === '/' || pathname === '') pathname = '/index.html';
      const target = path.resolve(rootDir, '.' + pathname);
      if (!target.startsWith(rootDir)) {
        res.writeHead(403, { 'content-type': 'text/plain' });
        res.end('forbidden');
        return;
      }
      readFile(target, (err, body) => {
        if (err) {
          res.writeHead(404, { 'content-type': 'text/plain' });
          res.end('not found');
          return;
        }
        res.writeHead(200, { 'content-type': contentType(target), 'cache-control': 'no-store' });
        res.end(body);
      });
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(err.message || String(err));
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = createTcpServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function safeRmProfile(profileDir) {
  const tmp = path.resolve(tmpdir());
  const target = path.resolve(profileDir);
  if (!target.startsWith(tmp) || path.basename(target).indexOf('policylens-family-move-') !== 0) return;
  try { rmSync(target, { recursive: true, force: true }); } catch (_) {}
}

async function fetchJsonWhenReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      lastError = new Error('HTTP ' + res.status);
    } catch (err) {
      lastError = err;
    }
    await delay(150);
  }
  throw lastError || new Error('Timed out waiting for ' + url);
}

async function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP websocket failed')), { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
    const msg = JSON.parse(raw);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
    else resolve(msg.result || {});
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      try { ws.close(); } catch (_) {}
    },
  };
}

async function launchPage(browserPath, url) {
  const profileDir = path.join(tmpdir(), 'policylens-family-move-' + Date.now());
  mkdirSync(profileDir, { recursive: true });
  const debugPort = await pickFreePort();
  const child = spawn(browserPath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--disable-default-apps',
    '--disable-background-networking',
    '--disable-features=Translate,MediaRouter',
    '--user-data-dir=' + profileDir,
    '--window-size=1600,900',
    '--remote-debugging-port=' + debugPort,
    url,
  ], { windowsHide: true });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    const pages = await fetchJsonWhenReady(`http://127.0.0.1:${debugPort}/json/list`, 15000);
    const page = pages.find(p => p.type === 'page' && p.webSocketDebuggerUrl) || pages.find(p => p.webSocketDebuggerUrl);
    if (!page) throw new Error('No debuggable page found');
    const cdp = await connectCdp(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    return { cdp, child, profileDir, stderr: () => stderr };
  } catch (err) {
    try { child.kill(); } catch (_) {}
    safeRmProfile(profileDir);
    throw err;
  }
}

async function evaluate(cdp, expression) {
  const out = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (out.exceptionDetails) {
    throw new Error(out.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return out.result?.value;
}

async function waitForText(cdp, pattern, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let text = '';
  while (Date.now() < deadline) {
    text = await evaluate(cdp, `document.body ? document.body.innerText : ''`);
    if (pattern.test(text)) return text;
    await delay(200);
  }
  throw new Error('Timed out waiting for text ' + pattern + '. Last text=' + text.slice(0, 300));
}

const seedScript = String.raw`
(async () => {
  const DB_NAME = 'PolicyLensV4';
  const DB_VER = 14;
  function openDb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('policies')) db.createObjectStore('policies', { keyPath:'id' });
        if (!db.objectStoreNames.contains('repository')) db.createObjectStore('repository', { keyPath:'id' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath:'key' });
        if (!db.objectStoreNames.contains('extractCache')) db.createObjectStore('extractCache', { keyPath:'key' });
        if (!db.objectStoreNames.contains('extraction_jobs')) db.createObjectStore('extraction_jobs', { keyPath:'id' });
        if (!db.objectStoreNames.contains('ocr_cache')) db.createObjectStore('ocr_cache', { keyPath:'fileHash' });
        if (!db.objectStoreNames.contains('extract_cache')) db.createObjectStore('extract_cache', { keyPath:'key' });
        if (!db.objectStoreNames.contains('telemetry')) db.createObjectStore('telemetry', { keyPath:'id' });
        if (!db.objectStoreNames.contains('extraction_corrections')) db.createObjectStore('extraction_corrections', { keyPath:'id' });
        if (!db.objectStoreNames.contains('snap_captures')) db.createObjectStore('snap_captures', { keyPath:'id', autoIncrement:true });
        if (!db.objectStoreNames.contains('learned_fewshots')) db.createObjectStore('learned_fewshots', { keyPath:'id' });
        if (!db.objectStoreNames.contains('drive_state')) db.createObjectStore('drive_state', { keyPath:'clientId' });
        if (!db.objectStoreNames.contains('checkpoints')) db.createObjectStore('checkpoints', { keyPath:'id' });
        if (!db.objectStoreNames.contains('column_map_cache')) db.createObjectStore('column_map_cache', { keyPath:'signature' });
        if (!db.objectStoreNames.contains('sync_outbox')) db.createObjectStore('sync_outbox', { keyPath:'id' });
        if (!db.objectStoreNames.contains('scan_sessions')) db.createObjectStore('scan_sessions', { keyPath:'id' });
        if (!db.objectStoreNames.contains('report_snapshots')) db.createObjectStore('report_snapshots', { keyPath:'id', autoIncrement:true });
        if (!db.objectStoreNames.contains('extraction_log')) db.createObjectStore('extraction_log', { keyPath:'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  function clear(db, store) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  function put(db, store, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  const db = await openDb();
  await clear(db, 'policies');
  await clear(db, 'settings');
  await clear(db, 'drive_state');
  const now = new Date().toISOString();
  const clients = [
    { clientId:'client-heather', clientName:'Heather', tier:'Bronze', familyGroup:'Heather Family', localOnly:true, lastSyncedAt:now },
    { clientId:'client-alex', clientName:'Alex', tier:'Platinum', familyGroup:'Heather Family', localOnly:true, lastSyncedAt:now },
    { clientId:'client-lee', clientName:'Lee Siew Hong, Sheena', tier:'Platinum', familyGroup:'LEE Family', localOnly:true, lastSyncedAt:now }
  ];
  for (const client of clients) {
    await put(db, 'drive_state', client);
    await put(db, 'settings', { key:'clientProfile_' + client.clientId, value:{ name:client.clientName, familyGroup:client.familyGroup } });
    await put(db, 'settings', { key:'clientName_' + client.clientId, value:client.clientName });
  }
  await put(db, 'policies', { id:'p-heather-1', clientId:'client-heather', productName:'Policy A', premium:872, premiumFrequency:'annual' });
  await put(db, 'policies', { id:'p-alex-1', clientId:'client-alex', productName:'Policy B', premium:15749, premiumFrequency:'annual' });
  await put(db, 'policies', { id:'p-lee-1', clientId:'client-lee', productName:'Policy C', premium:68800, premiumFrequency:'annual' });
  localStorage.setItem('policylens_clients_family_mode', 'family');
  localStorage.setItem('policylens_last_tab', 'clients');
  localStorage.setItem('policylens_active_client_id', 'client-heather');
  return true;
})()
`;

const browserPath = findBrowser();
const server = await startServer();
let browser = null;

try {
  const smokeUrl = `http://127.0.0.1:${server.address().port}/?pl_smoke=1&family_move_smoke=1`;
  browser = await launchPage(browserPath, smokeUrl);
  const { cdp } = browser;
  await waitForText(cdp, /\b(Dashboard|Policies|Clients|Profile|Settings)\b/);
  await evaluate(cdp, seedScript);
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitForText(cdp, /Heather Family/);
  await waitForText(cdp, /LEE Family/);

  const before = await evaluate(cdp, `document.body.innerText`);
  assert.match(before, /Alex/);
  assert.doesNotMatch(before, /Policy A|Policy B|Policy C/, 'compact household cards should not show policy names');

  const moved = await evaluate(cdp, String.raw`
  (() => {
    const selects = Array.from(document.querySelectorAll('select[title="Move household member"]'));
    const select = selects.find(sel => {
      let node = sel;
      for (let i = 0; node && i < 8; i += 1, node = node.parentElement) {
        if ((node.innerText || '').includes('Alex')) return true;
      }
      return false;
    });
    if (!select) throw new Error('Alex move select not found');
    select.value = 'LEE Family';
    select.dispatchEvent(new Event('change', { bubbles:true }));
    return true;
  })()
  `);
  assert.equal(moved, true);

  const familyGroup = await evaluate(cdp, String.raw`
  (async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('PolicyLensV4', 14);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readonly');
      const req = tx.objectStore('settings').get('clientProfile_client-alex');
      req.onsuccess = () => resolve(req.result && req.result.value && req.result.value.familyGroup);
      req.onerror = () => reject(req.error);
    });
  })()
  `);
  assert.equal(familyGroup, 'LEE Family');

  const widthOk = await evaluate(cdp, String.raw`
  (() => {
    const cards = Array.from(document.querySelectorAll('select[title="Move household member"]')).map(sel => {
      let node = sel;
      for (let i = 0; node && i < 8; i += 1, node = node.parentElement) {
        const rect = node.getBoundingClientRect();
        if (rect.width > 180 && rect.width < 320 && (node.innerText || '').includes('Move')) return rect.width;
      }
      return 9999;
    });
    return cards.length >= 3 && cards.every(w => w <= 290);
  })()
  `);
  assert.equal(widthOk, true, 'family member cards should stay compact instead of stretching full-width');

  console.log('Family member move smoke passed');
  console.log('  browser: ' + browserPath);
  console.log('  moved: Alex -> LEE Family');
} finally {
  if (browser) {
    try { browser.cdp.close(); } catch (_) {}
    try { browser.child.kill(); } catch (_) {}
    safeRmProfile(browser.profileDir);
  }
  await new Promise(resolve => server.close(resolve));
}
