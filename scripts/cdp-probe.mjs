import { spawn } from 'node:child_process';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9336;
const url = process.argv[2] || 'http://127.0.0.1:8788/#/today';
const expr = 'JSON.stringify({iw:innerWidth,vw:document.getElementById("view").clientWidth,vscroll:document.getElementById("view").scrollWidth,panel:document.querySelector(".panel")?document.querySelector(".panel").getBoundingClientRect().toJSON():null,table:document.querySelector("table.tbl")?document.querySelector("table.tbl").getBoundingClientRect().toJSON():null,th:[...document.querySelectorAll("table.tbl th")].map(t=>[t.textContent,t.getBoundingClientRect().width]),viewW:document.getElementById("view").getBoundingClientRect().width})';

const child = spawn(CHROME, ['--headless=new','--disable-gpu','--hide-scrollbars','--window-size=390,844','--remote-debugging-port=' + PORT,'--user-data-dir=C:/Users/LENOVO/AppData/Local/Temp/cdp-mobile-profile', url], { stdio: 'ignore' });

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  let page = null;
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await res.json();
      page = list.find(t => t.type === 'page' && t.url.indexOf('8788') >= 0) || list.find(t => t.type === 'page');
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
  await wait(3000);
  const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log(r.result && r.result.result ? r.result.result.value : JSON.stringify(r));
  ws.close();
}
main().then(() => { child.kill('SIGKILL'); process.exit(0); }).catch(async (e) => { console.error('ERR', e.message); child.kill('SIGKILL'); process.exit(1); });