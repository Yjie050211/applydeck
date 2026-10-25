#!/usr/bin/env node
/**
 * ApplyDeck 采集器 · 零依赖端到端验证（verify.mjs）
 * ---------------------------------------------------------------------------
 * 1. 用 node:http 起一个随机端口的静态服务器，托管 fixtures/ 和 popup.html；
 * 2. spawn 本机 Chrome headless（--remote-debugging-port=9444，临时 user-data-dir）；
 * 3. 通过全局 WebSocket + CDP 打开每个 fixture，Runtime.evaluate 注入 extract.js
 *    并调用 extractJob()，断言 company / role / channel 符合预期；
 * 4. 顺带用 popup.html?demo=1 截一张弹窗图到 docs/popup.png（失败只告警）；
 * 5. 打印 EXT VERIFY: N passed, M failed，退出前清理 Chrome / 服务器 / 临时目录。
 *
 * 用法：node extension/verify.mjs   （Chrome 缺失时打印 SKIP 并 exit 0）
 * 无任何 npm 依赖，Node >= 22（需要全局 fetch 与 WebSocket）。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, promises as fsp } from 'node:fs';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const EXTRACT_FILE = path.join(ROOT, 'extract.js');
const DOCS_DIR = path.join(ROOT, 'docs');
const CDP_PORT = 9444;
const CDP_BASE = 'http://127.0.0.1:' + CDP_PORT;
const USER_DATA_DIR = path.join(os.tmpdir(), 'applydeck-ext-verify');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : ''
].filter(Boolean);

/* ------------------------------ 小工具 ------------------------------ */

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function tryRemoveDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    return true;
  } catch (err) {
    return false;
  }
}

function waitExit(child, timeoutMs) {
  return new Promise(function (resolve) {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(function () { resolve(); }, timeoutMs || 3000);
    child.once('exit', function () {
      clearTimeout(timer);
      resolve();
    });
  });
}

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      if (candidate && existsSync(candidate)) return candidate;
    } catch (e) { /* ignore */ }
  }
  return '';
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function mimeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

/* ------------------------------ 静态服务器 ------------------------------ */

function startStaticServer() {
  const server = createServer(async function (req, res) {
    try {
      const parsed = new URL(req.url || '/', 'http://127.0.0.1');
      let pathname = decodeURIComponent(parsed.pathname);
      if (pathname === '/') pathname = '/popup.html';
      const filePath = path.normalize(path.join(ROOT, pathname));
      if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('forbidden');
        return;
      }
      const data = await fsp.readFile(filePath);
      res.writeHead(200, { 'Content-Type': mimeFor(filePath), 'Cache-Control': 'no-store' });
      res.end(data);
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
    }
  });
  return new Promise(function (resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', function () {
      resolve({ server, port: server.address().port });
    });
  });
}

/* ------------------------------ 极简 CDP 客户端 ------------------------------ */

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.waiters = new Map();
    this.closed = false;
    ws.addEventListener('message', (event) => this.onMessage(event.data));
    ws.addEventListener('close', () => {
      this.closed = true;
      for (const item of this.pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error('CDP 连接已关闭'));
      }
      this.pending.clear();
    });
  }

  static connect(url) {
    return new Promise(function (resolve, reject) {
      let ws;
      try { ws = new WebSocket(url); } catch (err) { reject(err); return; }
      const timer = setTimeout(function () { reject(new Error('CDP WebSocket 连接超时')); }, 10000);
      ws.addEventListener('open', function () {
        clearTimeout(timer);
        resolve(new Cdp(ws));
      });
      ws.addEventListener('error', function () {
        clearTimeout(timer);
        reject(new Error('CDP WebSocket 连接失败：' + url));
      });
    });
  }

  onMessage(raw) {
    let msg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : String(raw)); } catch (err) { return; }
    if (typeof msg.id === 'number') {
      const item = this.pending.get(msg.id);
      if (!item) return;
      this.pending.delete(msg.id);
      clearTimeout(item.timer);
      if (msg.error) item.reject(new Error(msg.error.message || 'CDP 错误: ' + msg.method));
      else item.resolve(msg.result || {});
      return;
    }
    if (msg.method) {
      const list = this.waiters.get(msg.method);
      if (list && list.length) {
        const waiter = list.shift();
        clearTimeout(waiter.timer);
        waiter.resolve(msg.params || {});
      }
    }
  }

  send(method, params, timeoutMs) {
    const self = this;
    return new Promise(function (resolve, reject) {
      if (self.closed) { reject(new Error('CDP 连接已关闭')); return; }
      const id = ++self.seq;
      const timer = setTimeout(function () {
        self.pending.delete(id);
        reject(new Error('CDP 超时: ' + method));
      }, timeoutMs || 10000);
      self.pending.set(id, { resolve, reject, timer });
      try {
        self.ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
      } catch (err) {
        self.pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  waitEvent(method, timeoutMs) {
    const self = this;
    return new Promise(function (resolve, reject) {
      const list = self.waiters.get(method) || [];
      const timer = setTimeout(function () {
        const current = self.waiters.get(method) || [];
        const index = current.indexOf(waiter);
        if (index >= 0) current.splice(index, 1);
        reject(new Error('等待事件超时: ' + method));
      }, timeoutMs || 15000);
      const waiter = { resolve, reject, timer };
      list.push(waiter);
      self.waiters.set(method, list);
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression: expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    }, 15000);
    if (result.exceptionDetails) {
      const text = result.exceptionDetails.exception && result.exceptionDetails.exception.description
        ? result.exceptionDetails.exception.description
        : (result.exceptionDetails.text || '未知异常');
      throw new Error('页面脚本异常: ' + text);
    }
    return result.result ? result.result.value : undefined;
  }

  async navigate(url) {
    const loaded = this.waitEvent('Page.loadEventFired', 15000).catch(function () { return null; });
    await this.send('Page.navigate', { url: url });
    await loaded;
    // 兜底：等 readyState 稳定（loadEventFired 偶尔早于 popup 初始化完成）
    for (let i = 0; i < 50; i++) {
      const state = await this.evaluate('document.readyState');
      if (state === 'complete') return;
      await sleep(100);
    }
  }

  close() {
    try { this.ws.close(); } catch (err) { /* ignore */ }
  }
}

/* ------------------------------ DevTools 目标 ------------------------------ */

async function fetchJson(url, options) {
  const response = await fetch(url, options || {});
  return response.json();
}

async function waitForDevtools(child, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 20000);
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error('Chrome 进程提前退出（exit ' + child.exitCode + '）');
    }
    try {
      return await fetchJson(CDP_BASE + '/json/version');
    } catch (err) {
      lastError = err;
      await sleep(200);
    }
  }
  throw new Error('等待 DevTools 端口超时：' + (lastError ? lastError.message : 'unknown'));
}

async function getPageTarget() {
  const list = await fetchJson(CDP_BASE + '/json/list');
  let page = list.find(function (item) { return item.type === 'page'; });
  if (!page) {
    page = await fetchJson(CDP_BASE + '/json/new?about:blank', { method: 'PUT' });
  }
  if (!page || !page.webSocketDebuggerUrl) throw new Error('拿不到页面 CDP 地址');
  return page;
}

/* ------------------------------ 断言 ------------------------------ */

function compareFields(expected, actual) {
  const problems = [];
  for (const key of Object.keys(expected)) {
    const want = expected[key];
    const got = actual && actual[key] !== undefined ? String(actual[key]) : '';
    if (got !== want) problems.push(key + ' 期望「' + want + '」实际「' + got + '」');
  }
  return problems;
}

const FIXTURES = [
  {
    name: 'boss',
    file: 'fixtures/boss.html',
    expect: { company: '星海科技', role: 'AI 应用开发实习生', channel: 'boss' },
    titleFallback: { company: '星海科技', role: 'AI 应用开发实习生' },
    stripSelectors: ['.job-banner', '.company-info']
  },
  {
    name: 'shixiseng',
    file: 'fixtures/shixiseng.html',
    expect: { company: '微光网络', role: '产品运营实习生', channel: 'shixiseng' }
  },
  {
    name: 'nowcoder',
    file: 'fixtures/nowcoder.html',
    expect: { company: '云梯科技', role: '后端开发工程师（Go）', channel: 'nowcoder' }
  },
  {
    name: 'generic',
    file: 'fixtures/generic.html',
    expect: { company: '云帆数据', role: '数据分析实习生', channel: 'official' }
  }
];

/* ------------------------------ 弹窗截图 ------------------------------ */

async function capturePopup(cdp, baseUrl) {
  mkdirSync(DOCS_DIR, { recursive: true });
  const popupFile = path.join(DOCS_DIR, 'popup.png');
  const resultFile = path.join(DOCS_DIR, 'popup-result.png');

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 380, height: 900, deviceScaleFactor: 2, mobile: false
  });
  await cdp.navigate(baseUrl + '/popup.html?demo=1');

  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      ready = !!(await cdp.evaluate('window.__AD_POPUP_READY === true'));
    } catch (err) { ready = false; }
    if (ready) break;
    await sleep(100);
  }

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 380, height: 560, deviceScaleFactor: 2, mobile: false
  });
  const metrics = await cdp.send('Page.getLayoutMetrics', {});
  const content = metrics.cssContentSize || metrics.contentSize || {};
  const height = Math.max(560, Math.ceil(content.height || 560));
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 380, height: height, deviceScaleFactor: 2, mobile: false
  });
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true, fromSurface: true
  });
  await fsp.writeFile(popupFile, Buffer.from(shot.data, 'base64'));

  // 再点一次主按钮，截一张「已加入（演示）」结果卡
  try {
    await cdp.evaluate('document.getElementById("submit-btn").click()');
    await sleep(900);
    const metrics2 = await cdp.send('Page.getLayoutMetrics', {});
    const content2 = metrics2.cssContentSize || metrics2.contentSize || {};
    const height2 = Math.max(620, Math.ceil(content2.height || 620));
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 380, height: height2, deviceScaleFactor: 2, mobile: false
    });
    const shot2 = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true, fromSurface: true
    });
    await fsp.writeFile(resultFile, Buffer.from(shot2.data, 'base64'));
  } catch (err) {
    console.log('提示: 结果卡截图失败（不影响断言）: ' + err.message);
  }

  return { popupFile, resultFile };
}

/* ------------------------------ 主流程 ------------------------------ */

async function main() {
  const chromePath = findChrome();
  if (!chromePath) {
    console.log('SKIP: 未找到 Chrome（尝试过：' + CHROME_CANDIDATES.join(' | ') + '）');
    console.log('EXT VERIFY: SKIP');
    process.exit(0);
  }
  console.log('Chrome: ' + chromePath);

  const extractSource = await fsp.readFile(EXTRACT_FILE, 'utf8');
  const { server, port } = await startStaticServer();
  const baseUrl = 'http://127.0.0.1:' + port;
  console.log('静态服务器: ' + baseUrl);

  // Windows 上上一个 Chrome 可能还没完全释放临时目录：占用时换一个唯一目录继续
  let userDataDir = USER_DATA_DIR;
  if (!tryRemoveDir(userDataDir)) {
    userDataDir = USER_DATA_DIR + '-' + process.pid + '-' + Date.now();
    console.log('提示: 旧临时目录被占用，本次改用 ' + userDataDir);
  }
  let chromeStderr = '';
  const child = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-features=Translate,MediaRouter',
    '--user-data-dir=' + userDataDir,
    '--remote-debugging-port=' + CDP_PORT,
    '--remote-debugging-address=127.0.0.1',
    '--window-size=1280,900',
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', function (chunk) {
    chromeStderr = (chromeStderr + String(chunk)).slice(-4000);
  });

  let cdp = null;
  let passed = 0;
  let failed = 0;

  try {
    await waitForDevtools(child, 20000);
    const page = await getPageTarget();
    cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    for (const fixture of FIXTURES) {
      const url = baseUrl + '/' + fixture.file;
      try {
        await cdp.navigate(url);
        const data = await cdp.evaluate(extractSource + '\n;extractJob();');
        let problems = compareFields(fixture.expect, data || {});
        if (!problems.length && fixture.stripSelectors && fixture.titleFallback) {
          const selectors = JSON.stringify(fixture.stripSelectors);
          const stripCode = '(function(){var sels=' + selectors +
            ';for(var i=0;i<sels.length;i++){var el=document.querySelector(sels[i]);if(el&&el.parentNode){el.parentNode.removeChild(el);}}return true;})()';
          await cdp.evaluate(stripCode);
          const fallbackData = await cdp.evaluate(extractSource + '\n;extractJob();');
          problems = problems.concat(compareFields(fixture.titleFallback, fallbackData || {}).map(function (p) {
            return 'title 兜底 ' + p;
          }));
        }
        if (problems.length) {
          failed += 1;
          console.log('[fail] ' + fixture.name + ' (' + fixture.file + ') ' + problems.join('；'));
        } else {
          passed += 1;
          console.log('[ok] ' + fixture.name + ' (' + fixture.file + ') company=' + data.company +
            ' role=' + data.role + ' channel=' + data.channel +
            ' location=' + (data.location || '-') + ' salary=' + (data.salary || '-'));
        }
      } catch (err) {
        failed += 1;
        console.log('[fail] ' + fixture.name + ' (' + fixture.file + ') ' + err.message);
      }
    }

    try {
      const shots = await capturePopup(cdp, baseUrl);
      console.log('popup screenshot: ' + path.relative(ROOT, shots.popupFile));
      console.log('popup result screenshot: ' + path.relative(ROOT, shots.resultFile));
    } catch (err) {
      console.log('提示: popup 截图失败（不影响断言）: ' + err.message);
    }
  } catch (err) {
    failed += 1;
    console.log('[fail] 启动/连接 Chrome 失败: ' + err.message);
    if (chromeStderr) console.log('Chrome stderr（截取）:\n' + chromeStderr);
  } finally {
    if (cdp) cdp.close();
    try {
      child.kill();
    } catch (err) { /* ignore */ }
    await waitExit(child, 4000);
    if (child.exitCode === null) {
      try {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch (err) { /* ignore */ }
      await sleep(600);
    }
    try {
      server.close();
    } catch (err) { /* ignore */ }
    await sleep(200);
    for (let i = 0; i < 12; i++) {
      if (tryRemoveDir(userDataDir)) break;
      await sleep(250);
    }
  }

  console.log('');
  console.log('EXT VERIFY: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(function (err) {
  console.log('EXT VERIFY 异常: ' + (err && err.stack ? err.stack : err));
  console.log('EXT VERIFY: 0 passed, 1 failed');
  process.exit(1);
});
