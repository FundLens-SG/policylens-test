import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFile, rmSync, statSync } from 'node:fs';
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
  const screenshotPath = path.join(tmpdir(), 'policylens-browser-smoke.png');
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--disable-default-apps',
    '--disable-background-networking',
    '--disable-features=Translate,MediaRouter',
    '--user-data-dir=' + profileDir,
    '--window-size=1440,900',
    '--virtual-time-budget=15000',
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
  const domResult = await runBrowser(browserPath, smokeUrl, 'dom');
  if (domResult.code !== 0) {
    throw new Error('Browser DOM smoke exited ' + domResult.code + ': ' + domResult.stderr.slice(0, 600));
  }
  const rootContent = rootContentFromDump(domResult.stdout);
  const shellReady = /\b(Dashboard|Policies|Clients|Profile|Settings)\b/.test(rootContent);
  const stuckOnLoader = /Loading PolicyLens/.test(rootContent) && !shellReady;
  if (!shellReady || stuckOnLoader) {
    throw new Error('PolicyLens did not render the app shell. rootLength=' + rootContent.length);
  }

  const shotResult = await runBrowser(browserPath, smokeUrl, 'screenshot');
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
