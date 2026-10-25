import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const [url, out, jsArg, waitArg] = process.argv.slice(2);
const waitMs = Number(waitArg || 1200);

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + 'C:/Users/LENOVO/AppData/Local/Temp/applydeck-cdp',
  '--window-size=1500,950',
  'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getJson(path) {
  const res = await fetch('http://127.0.0.1:' + PORT + path);
  return res.json();
}

async function waitForTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await getJson('/json/list');
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('chrome target timeout');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const events = new Map();
    ws.onopen = () => resolve({
      send(method, params = {}, sessionId) {
        return new Promise((res, rej) => {
          const msgId = ++id;
          pending.set(msgId, { res, rej });
          ws.send(JSON.stringify({ id: msgId, method, params, sessionId }));
        });
      },
      on(name, cb) { events.set(name, cb); },
      close() { try { ws.close(); } catch {} }
    });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id); pending.delete(msg.id);
        if (msg.error) p.rej(new Error(msg.error.message)); else p.res(msg.result);
        return;
      }
      const cb = events.get(msg.method);
      if (cb) cb(msg.params, msg.sessionId);
    };
    ws.onerror = () => reject(new Error('ws error'));
  });
}

try {
  const target = await waitForTarget();
  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  const loaded = new Promise((res) => cdp.on('Page.loadEventFired', res));
  await cdp.send('Page.navigate', { url });
  await Promise.race([loaded, sleep(5000)]).catch(() => {});
  if (jsArg) {
    const r = await cdp.send('Runtime.evaluate', { expression: jsArg, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  }
  await sleep(waitMs);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('saved ' + out);
  cdp.close();
} finally {
  try { chrome.kill(); } catch {}
  await sleep(600);
}
