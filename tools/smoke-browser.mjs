import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { existsSync, mkdirSync, readFile, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
  if (!found) {
    throw new Error('No supported browser found. Set POLICYLENS_BROWSER to Edge or Chrome.');
  }
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
        res.writeHead(200, {
          'content-type': contentType(target),
          'cache-control': 'no-store',
        });
        res.end(body);
      });
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(err.message || String(err));
    }
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function safeRmProfile(profileDir) {
  const tmp = path.resolve(tmpdir());
  const target = path.resolve(profileDir);
  if (!target.startsWith(tmp) || path.basename(target).indexOf('policylens-smoke-') !== 0) return;
  try { rmSync(target, { recursive: true, force: true }); } catch (_) {}
}

function runBrowser(browserPath, url, mode) {
  const profileDir = path.join(tmpdir(), 'policylens-smoke-' + mode + '-' + Date.now());
  mkdirSync(profileDir, { recursive: true });
  const screenshotPath = path.join(tmpdir(), 'policylens-browser-smoke-' + mode + '-' + Date.now() + '.png');
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--disable-default-apps',
    '--disable-background-networking',
    '--disable-features=Translate,MediaRouter',
    '--user-data-dir=' + profileDir,
    '--window-size=1440,900',
    '--virtual-time-budget=30000',
    '--timeout=15000',
    '--run-all-compositor-stages-before-draw',
  ];
  if (mode === 'dom') args.push('--dump-dom');
  if (mode === 'screenshot') args.push('--screenshot=' + screenshotPath);
  args.push(url);

  return new Promise((resolve, reject) => {
    const child = spawn(browserPath, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      reject(new Error('Browser smoke timed out in ' + mode + ' mode'));
    }, 35000);
    child.on('error', err => {
      clearTimeout(timer);
      safeRmProfile(profileDir);
      reject(err);
    });
    child.on('exit', code => {
      clearTimeout(timer);
      safeRmProfile(profileDir);
      resolve({ code, stdout, stderr, screenshotPath });
    });
  });
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
      const payload = JSON.stringify({ id, method, params });
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(payload);
      });
    },
    close() {
      try { ws.close(); } catch (_) {}
    },
  };
}

async function runBrowserCdpScreenshot(browserPath, url) {
  const profileDir = path.join(tmpdir(), 'policylens-smoke-cdp-' + Date.now());
  mkdirSync(profileDir, { recursive: true });
  const screenshotPath = path.join(tmpdir(), 'policylens-browser-smoke-cdp-' + Date.now() + '.png');
  const debugPort = await pickFreePort();
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--disable-default-apps',
    '--disable-background-networking',
    '--disable-features=Translate,MediaRouter',
    '--user-data-dir=' + profileDir,
    '--window-size=1440,900',
    '--remote-debugging-port=' + debugPort,
    url,
  ];

  const child = spawn(browserPath, args, { windowsHide: true });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  let cdp = null;
  try {
    const pages = await fetchJsonWhenReady(`http://127.0.0.1:${debugPort}/json/list`, 15000);
    const page = pages.find(p => p.type === 'page' && p.webSocketDebuggerUrl) || pages.find(p => p.webSocketDebuggerUrl);
    if (!page) throw new Error('No debuggable page found');
    cdp = await connectCdp(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    const deadline = Date.now() + 30000;
    let rootText = '';
    while (Date.now() < deadline) {
      const evaluated = await cdp.send('Runtime.evaluate', {
        expression: `(() => { const root = document.getElementById('root'); return root ? root.innerText : ''; })()`,
        returnByValue: true,
      });
      rootText = String(evaluated.result?.value || '');
      if (/\b(Dashboard|Policies|Clients|Profile|Settings)\b/.test(rootText) && !/Loading PolicyLens/.test(rootText)) break;
      await delay(200);
    }
    if (!/\b(Dashboard|Policies|Clients|Profile|Settings)\b/.test(rootText) || /Loading PolicyLens/.test(rootText)) {
      throw new Error('PolicyLens did not become screenshot-ready. text=' + rootText.slice(0, 120));
    }

    await cdp.send('Page.bringToFront');
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));
    return { code: 0, stdout: '', stderr, screenshotPath, rootContent: rootText };
  } finally {
    if (cdp) cdp.close();
    try { child.kill(); } catch (_) {}
    safeRmProfile(profileDir);
  }
}

function rootContentFromDump(dom) {
  const rootStart = dom.indexOf('<div id="root">');
  const scriptStart = dom.indexOf('<script data-precompiled', rootStart);
  if (rootStart === -1 || scriptStart === -1 || scriptStart <= rootStart) return '';
  return dom.slice(rootStart, scriptStart);
}

const browserPath = findBrowser();
const server = await startServer();

try {
  const port = server.address().port;
  const smokeUrl = `http://127.0.0.1:${port}/?pl_smoke=1`;
  const shotResult = await runBrowserCdpScreenshot(browserPath, smokeUrl);
  const rootContent = shotResult.rootContent || '';
  const shellReady = /\b(Dashboard|Policies|Clients|Profile|Settings)\b/.test(rootContent);
  const stuckOnLoader = /Loading PolicyLens/.test(rootContent) && !shellReady;
  if (!shellReady || stuckOnLoader) {
    throw new Error('PolicyLens did not render the app shell. rootLength=' + rootContent.length);
  }

  if (shotResult.code !== 0) {
    throw new Error('Browser screenshot smoke exited ' + shotResult.code + ': ' + shotResult.stderr.slice(0, 600));
  }
  const screenshotBytes = existsSync(shotResult.screenshotPath) ? statSync(shotResult.screenshotPath).size : 0;
  if (screenshotBytes < 50000) {
    throw new Error('PolicyLens screenshot looks too small/blank: ' + screenshotBytes + ' bytes');
  }

  console.log('PolicyLens browser smoke passed');
  console.log('  browser: ' + browserPath);
  console.log('  root chars: ' + rootContent.length);
  console.log('  screenshot: ' + shotResult.screenshotPath + ' (' + screenshotBytes + ' bytes)');
} finally {
  await new Promise(resolve => server.close(resolve));
}
