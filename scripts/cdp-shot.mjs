import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const url = process.argv[2];
const out = process.argv[3];
const width = Number(process.argv[4] || 390);
const height = Number(process.argv[5] || 844);
const dpr = Number(process.argv[6] || 2);
const theme = process.argv[7] || '';
const clickSelector = process.argv[8] || '';
const scrollSelector = process.argv[9] || '';
const PORT = 9340 + Math.floor(Math.random() * 40);
const profile = 'C:/Users/LENOVO/AppData/Local/Temp/cdp-shot-' + PORT;

const child = spawn(CHROME, ['--headless=new','--disable-gpu','--hide-scrollbars','--remote-debugging-port=' + PORT,'--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  let page = null;
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await res.json();
      page = list.find(t => t.type === 'page');
      if (page) break;
    } catch (e) {}
    await wait(250);
  }
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let nextId = 1;
  function call(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const handler = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id === id) { ws.removeEventListener('message', handler); resolve(msg); }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  await call('Page.enable', {});
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: true });
  if (theme) {
    await call('Page.addScriptToEvaluateOnNewDocument', {
      source: "try { localStorage.setItem('applydeck-theme', " + JSON.stringify(theme) + "); } catch (e) {}"
    });
  }
  await call('Page.navigate', { url });
  await wait(3000);
  if (clickSelector) {
    await call('Runtime.evaluate', { expression: "(function(){var el=document.querySelector(" + JSON.stringify(clickSelector) + "); if(el) el.click(); return !!el;})()" });
    await wait(1200);
  }
  if (scrollSelector) {
    await call('Runtime.evaluate', { expression: "(function(){var el=document.querySelector(" + JSON.stringify(scrollSelector) + "); if(el) el.scrollIntoView({block:'center'}); return !!el;})()" });
    await wait(700);
  }
  const r = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const data = r.result && r.result.data;
  if (!data) throw new Error('no screenshot data');
  writeFileSync(out, Buffer.from(data, 'base64'));
  console.log('wrote ' + out);
  ws.close();
}
main().then(() => { child.kill('SIGKILL'); process.exit(0); }).catch((e) => { console.error('ERR ' + e.message); child.kill('SIGKILL'); process.exit(1); });
