import { spawn } from 'node:child_process';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:8788';
const PORT = 9380 + Math.floor(Math.random() * 40);
const profile = 'C:/Users/LENOVO/AppData/Local/Temp/cdp-theme-' + PORT;
const child = spawn(CHROME, ['--headless=new','--disable-gpu','--hide-scrollbars','--remote-debugging-port=' + PORT,'--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); ok ? pass++ : fail++; };

async function main() {
  // 服务端先把主题设为 dark（模拟上次选择已持久化）
  const setDark = await fetch(BASE + '/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: 'dark' }) });
  check('PATCH settings theme=dark', setDark.status === 200 && (await setDark.json()).settings.theme === 'dark', setDark.status);

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
      const handler = (ev) => { const msg = JSON.parse(ev.data); if (msg.id === id) { ws.removeEventListener('message', handler); resolve(msg); } };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  const evalJs = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await call('Page.enable', {});
  await call('Page.navigate', { url: BASE + '/#/settings' });
  await wait(2500);

  const theme0 = await evalJs('document.documentElement.dataset.theme');
  check('服务端 dark 在无本地缓存时生效', theme0 === 'dark', theme0);
  const stored0 = await evalJs("localStorage.getItem('applydeck-theme')");
  check('应用后写入 localStorage 缓存', stored0 === 'dark', stored0);
  const themeBtn0 = await evalJs("document.querySelector('#btn-theme') ? document.querySelector('#btn-theme').getAttribute('data-mode') : null");
  check('顶栏主题按钮存在且标为 dark', themeBtn0 === 'dark', themeBtn0);

  // 点一下：dark -> system（headless 系统为浅色）
  await evalJs("document.querySelector('#btn-theme').click()");
  await wait(900);
  const mode1 = await evalJs("document.querySelector('#btn-theme').getAttribute('data-mode')");
  const label1 = await evalJs("document.querySelector('[data-theme-label]').textContent.trim()");
  const theme1 = await evalJs('document.documentElement.dataset.theme');
  const server1 = await (await fetch(BASE + '/api/settings')).json();
  check('点击循环 dark -> system', mode1 === 'system' && theme1 === 'light', { mode1, theme1, label1 });
  check('切换后服务端同步持久化', server1.settings.theme === 'system', server1.settings.theme);

  // 刷新后保持 system
  await call('Page.navigate', { url: BASE + '/#/settings' });
  await wait(2200);
  const mode2 = await evalJs("document.querySelector('#btn-theme').getAttribute('data-mode')");
  check('刷新后保持 system 选择', mode2 === 'system', mode2);

  // 再点两下回到 dark：system -> light -> dark
  await evalJs("document.querySelector('#btn-theme').click()"); await wait(700);
  await evalJs("document.querySelector('#btn-theme').click()"); await wait(900);
  const mode3 = await evalJs("document.querySelector('#btn-theme').getAttribute('data-mode')");
  const theme3 = await evalJs('document.documentElement.dataset.theme');
  const server3 = await (await fetch(BASE + '/api/settings')).json();
  check('继续循环回到 dark', mode3 === 'dark' && theme3 === 'dark' && server3.settings.theme === 'dark', { mode3, theme3, server: server3.settings.theme });

  // 跨标签页同步：开第二个 tab，改主题后第一个 tab 应跟随
  const tab2 = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent(BASE + '/#/settings'), { method: 'PUT' })).json();
  const ws2 = new WebSocket(tab2.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws2.onopen = res; ws2.onerror = rej; });
  let nextId2 = 1;
  function call2(method, params) {
    return new Promise((resolve) => {
      const id = nextId2++;
      const handler = (ev) => { const msg = JSON.parse(ev.data); if (msg.id === id) { ws2.removeEventListener('message', handler); resolve(msg); } };
      ws2.addEventListener('message', handler);
      ws2.send(JSON.stringify({ id, method, params }));
    });
  }
  await call2('Page.enable', {});
  await wait(2200);
  const themeA = await evalJs('document.documentElement.dataset.theme');
  await call2('Runtime.evaluate', { expression: "localStorage.setItem('applydeck-theme','light'); window.dispatchEvent(new StorageEvent('storage',{key:'applydeck-theme',newValue:'light'}))" });
  await wait(700);
  const themeB = await evalJs('document.documentElement.dataset.theme');
  check('storage 事件跨标签同步', themeB === 'light', { themeA, themeB });

  ws.close(); ws2.close();
  // 收尾：把真实库的主题恢复为默认「跟随系统」，避免测试污染用户设置
  await fetch(BASE + '/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: 'system' }) });
  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  child.kill('SIGKILL');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('ERR ' + (e && e.stack || e)); child.kill('SIGKILL'); process.exit(1); });
