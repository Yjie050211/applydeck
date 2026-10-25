import { spawn } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'e2e');
const PORT = 8799;
const BASE = 'http://127.0.0.1:' + PORT;
let pass = 0;
let fail = 0;

function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra).slice(0, 300) : '')); }
}

async function waitFor(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < (timeoutMs || 15000)) {
    try {
      const res = await fetch(url + '/api/health');
      if (res.ok) return true;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

async function jfetch(url, options) {
  const res = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {}));
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
  return { status: res.status, data: data, headers: res.headers };
}

for (const f of [DATA]) {
  if (existsSync(f)) rmSync(f, { recursive: true, force: true });
}

const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs'), '--port', String(PORT), '--data', DATA, '--no-open'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', c => { out += c; });
child.stderr.on('data', c => { out += c; });

try {
  const up = await waitFor(BASE, 20000);
  check('server starts and /api/health responds', up, out.slice(-400));
  if (!up) throw new Error('server did not start: ' + out.slice(-800));

  const health = await jfetch(BASE + '/api/health');
  check('health ok', health.status === 200 && health.data.ok === true, health.data);
  check('health version is 0.3.0', health.data.version === '0.3.0', health.data.version);

  const boot = await jfetch(BASE + '/api/bootstrap');
  check('bootstrap has 6 statuses', boot.status === 200 && boot.data.statuses.length === 6, boot.data.statuses && boot.data.statuses.length);
  check('bootstrap counts empty', boot.data.counts.total === 0, boot.data.counts);

  const html = await fetch(BASE + '/');
  const htmlText = await html.text();
  check('index.html served', html.status === 200 && htmlText.includes('投递舱'), html.status);
  check('index.html has pre-paint theme script', htmlText.includes('applydeck-theme') && htmlText.includes('color-scheme'), true);
  const css = await fetch(BASE + '/style.css');
  const cssText = await css.text();
  check('style.css served', css.status === 200 && cssText.includes('--mica'), css.status);
  check('style.css has light + dark tokens', cssText.includes('html[data-theme="dark"]') && cssText.includes('--accent'), true);
  const themeJs = await fetch(BASE + '/js/theme.js');
  check('theme.js served', themeJs.status === 200 && (await themeJs.text()).includes('prefers-color-scheme'), themeJs.status);
  const js = await fetch(BASE + '/js/app.js');
  check('app.js served as module', js.status === 200 && (await js.text()).includes("from './views/today.js'"), js.status);

  const seed = await jfetch(BASE + '/api/seed-note');
  check('seed note available', seed.status === 200 && seed.data.text.includes('已投递'), seed.status);
  const note = seed.data.text;

  const preview = await jfetch(BASE + '/api/import/preview', { method: 'POST', body: JSON.stringify({ text: note, year: 2026 }) });
  check('preview parses 16 records', preview.status === 200 && preview.data.records.length === 16, preview.data.records && preview.data.records.length);
  check('preview marks 11 applied', preview.data.records.filter(r => r.status === 'applied').length === 11, preview.data.records.filter(r => r.status === 'applied').length);
  check('preview marks 5 wishlist', preview.data.records.filter(r => r.status === 'wishlist').length === 5, preview.data.records.filter(r => r.status === 'wishlist').length);

  const commit = await jfetch(BASE + '/api/import/commit', { method: 'POST', body: JSON.stringify({ text: note, year: 2026 }) });
  check('commit creates 16 apps', commit.status === 200 && commit.data.created === 16, commit.data);

  const apps = await jfetch(BASE + '/api/apps');
  check('apps list has 16', apps.data.apps.length === 16, apps.data.apps.length);
  check('applied_at set for 百度 J105638', apps.data.apps.some(a => a.company === '百度' && a.applied_at === '2026-10-09' && a.role.includes('J105638')), apps.data.apps.filter(a => a.company === '百度').map(a => [a.role, a.applied_at]));

  const today = await jfetch(BASE + '/api/today');
  check('today has actions', today.status === 200 && today.data.actions.length > 0, today.data.summary);

  const firstAction = today.data.actions[0];
  const complete = await jfetch(BASE + '/api/today/complete', { method: 'POST', body: JSON.stringify({ appId: firstAction.appId, kind: firstAction.kind, action: 'complete' }) });
  check('complete first action ok', complete.status === 200 && complete.data.ok === true, complete.data);

  const stats = await jfetch(BASE + '/api/stats');
  check('stats applied=11', stats.data.stats.applied === 11, stats.data.stats.applied);
  check('stats channels total 11', stats.data.stats.channels.reduce((s, c) => s + c.count, 0) === 11, stats.data.stats.channels);
  check('stats funnel has 4 steps', stats.data.stats.funnel.length === 4, stats.data.stats.funnel);

  const create = await jfetch(BASE + '/api/apps', { method: 'POST', body: JSON.stringify({ company: '测试公司', role: '后端实习生', status: 'applied', applied_at: '2026-10-20', channel: 'other' }) });
  check('create app via API', create.status === 201 && create.data.app.company === '测试公司', create.data);
  const newId = create.data.app.id;

  const patched = await jfetch(BASE + '/api/apps/' + newId, { method: 'PATCH', body: JSON.stringify({ status: 'interview', interview_at: '2026-10-28T14:00:00' }) });
  check('patch status to interview', patched.status === 200 && patched.data.app.status === 'interview', patched.status);
  const events = await jfetch(BASE + '/api/apps/' + newId);
  check('status change recorded in timeline', events.data.events.some(e => e.kind === 'status_change' && e.to_status === 'interview'), events.data.events);

  const md = await fetch(BASE + '/api/export/md');
  const mdText = await md.text();
  check('export md contains 百度', md.status === 200 && mdText.includes('百度') && mdText.includes('## 已投递'), md.status);
  const csv = await fetch(BASE + '/api/export/csv');
  const csvText = await csv.text();
  check('export csv has header + rows', csv.status === 200 && csvText.replace(/^\ufeff/, '').includes('公司,岗位,状态') && csvText.split('\n').length >= 17, csv.status);
  const jsonExp = await jfetch(BASE + '/api/export/json');
  check('export json ok', jsonExp.status === 200, jsonExp.status);

  const pre = await fetch(BASE + '/api/capture', { method: 'OPTIONS', headers: { Origin: 'chrome-extension://e2e', 'Access-Control-Request-Method': 'POST' } });
  check('capture CORS preflight 204', pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*', pre.status);

  const cap = await jfetch(BASE + '/api/capture', { method: 'POST', body: JSON.stringify({ company: '扩展采集公司', role: '大模型实习生', channel: 'shixiseng', status: 'wishlist', url: 'https://www.shixiseng.com/intern/abc', location: '北京' }) });
  check('capture creates app', cap.status === 201 && cap.data.duplicated === false && cap.data.app.channel === 'shixiseng', cap.data);
  const capDup = await jfetch(BASE + '/api/capture', { method: 'POST', body: JSON.stringify({ company: '扩展采集公司', role: '大模型实习生' }) });
  check('capture dedupes by company+role', capDup.status === 200 && capDup.data.duplicated === true && capDup.data.app.id === cap.data.app.id, capDup.data.duplicated);
  const capBad = await jfetch(BASE + '/api/capture', { method: 'POST', body: JSON.stringify({ company: '' }) });
  check('capture rejects empty company', capBad.status === 400, capBad.status);
  const capApplied = await jfetch(BASE + '/api/capture', { method: 'POST', body: JSON.stringify({ company: '扩展已投公司', role: 'Agent 开发', status: 'applied' }) });
  check('capture applied sets applied_at', capApplied.status === 201 && !!capApplied.data.app.applied_at, capApplied.data.app && capApplied.data.app.applied_at);

  const ics = await fetch(BASE + '/api/export/ics?download=1');
  const icsText = await ics.text();
  check('ics download headers', ics.status === 200 && (ics.headers.get('content-type') || '').includes('text/calendar') && (ics.headers.get('content-disposition') || '').includes('.ics'), ics.headers.get('content-type'));
  check('ics body has VCALENDAR + VEVENT', icsText.startsWith('BEGIN:VCALENDAR') && icsText.includes('BEGIN:VEVENT') && icsText.includes('END:VCALENDAR'), icsText.slice(0, 40));
  const icsJson = await jfetch(BASE + '/api/export/ics');
  check('ics json has future events', icsJson.status === 200 && icsJson.data.count >= 1 && icsJson.data.events.length === icsJson.data.count, icsJson.data.count);

  const backup = await jfetch(BASE + '/api/backup', { method: 'POST', body: '{}' });
  check('backup creates file', backup.status === 200 && backup.data.ok === true, backup.data);

  const settings = await jfetch(BASE + '/api/settings', { method: 'PATCH', body: JSON.stringify({ followUpDays: 5, staleDaily: 10 }) });
  check('settings patch', settings.status === 200 && settings.data.settings.followUpDays === 5 && settings.data.settings.staleDaily === 10, settings.data.settings);
  const themePatch = await jfetch(BASE + '/api/settings', { method: 'PATCH', body: JSON.stringify({ theme: 'dark' }) });
  check('theme patch persists', themePatch.status === 200 && themePatch.data.settings.theme === 'dark', themePatch.data.settings && themePatch.data.settings.theme);
  const badTheme = await jfetch(BASE + '/api/settings', { method: 'PATCH', body: JSON.stringify({ theme: 'neon' }) });
  check('invalid theme ignored', badTheme.status === 200 && badTheme.data.settings.theme === 'dark', badTheme.data.settings && badTheme.data.settings.theme);
  const bootTheme = await jfetch(BASE + '/api/bootstrap');
  check('bootstrap carries theme', bootTheme.status === 200 && bootTheme.data.settings.theme === 'dark', bootTheme.data.settings && bootTheme.data.settings.theme);

  const undo = await jfetch(BASE + '/api/import/undo', { method: 'POST', body: JSON.stringify({ batchId: commit.data.batchId }) });
  check('undo import removes 16', undo.status === 200 && undo.data.removed === 16, undo.data);
  const afterUndo = await jfetch(BASE + '/api/apps');
  check('imported apps removed, manual + captured remain', afterUndo.data.apps.length === 3, afterUndo.data.apps.length);

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
} catch (e) {
  console.log('E2E ERROR: ' + (e && e.stack ? e.stack : e));
  fail++;
} finally {
  child.kill('SIGKILL');
  await new Promise(r => setTimeout(r, 400));
}
if (existsSync(DATA)) rmSync(DATA, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
