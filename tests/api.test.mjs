import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.mjs';
import { createAppServer } from '../server/app.mjs';

let tmp, db, server, base, note, batchId, captureId, wishId;

before(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'applydeck-api-'));
  db = openDb(path.join(tmp, 'test.db'));
  server = createAppServer(db, { dataDir: tmp });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  const res = await fetch(base + '/api/seed-note');
  note = (await res.json()).text;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

async function json(pathname, options) {
  const res = await fetch(base + pathname, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {}));
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
  return { status: res.status, data };
}

test('health 与 bootstrap 基础信息', async () => {
  const health = await json('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);
  const boot = await json('/api/bootstrap');
  assert.equal(boot.data.statuses.length, 6);
  assert.deepEqual(boot.data.counts, { total: 0, active: 0, closed: 0, wishlist: 0, byStatus: {} });
  assert.equal(boot.data.settings.followUpDays, 3);
  assert.equal(boot.data.settings.theme, 'system');
});

test('静态首页与前端模块可访问', async () => {
  const html = await fetch(base + '/');
  assert.equal(html.status, 200);
  const htmlText = await html.text();
  assert.ok(htmlText.includes('投递舱'));
  assert.ok(htmlText.includes('applydeck-theme'), '首屏 pre-paint 脚本应内联主题初始化');
  const js = await fetch(base + '/js/app.js');
  assert.equal(js.status, 200);
  assert.ok((await js.text()).includes('renderToday'));
  const themeJs = await fetch(base + '/js/theme.js');
  assert.equal(themeJs.status, 200);
  assert.ok((await themeJs.text()).includes('prefers-color-scheme'));
  const css = await fetch(base + '/style.css');
  assert.equal(css.status, 200);
  const cssText = await css.text();
  assert.ok(cssText.includes('--mica'), 'Fluent 令牌应存在');
  assert.ok(cssText.includes('html[data-theme="dark"]'), '应有深色主题覆盖');
});

test('导入预览解析 16 条，提交后计数正确', async () => {
  const preview = await json('/api/import/preview', { method: 'POST', body: JSON.stringify({ text: note, year: 2026 }) });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.records.length, 16);
  assert.equal(preview.data.records.filter(r => r.status === 'applied').length, 11);

  const commit = await json('/api/import/commit', { method: 'POST', body: JSON.stringify({ text: note, year: 2026 }) });
  assert.equal(commit.data.created, 16);
  batchId = commit.data.batchId;
  assert.ok(batchId);

  const boot = await json('/api/bootstrap');
  assert.equal(boot.data.counts.total, 16);
  assert.equal(boot.data.counts.active, 11);
  assert.equal(boot.data.counts.wishlist, 5);
});

test('重复导入会被识别为重复记录', async () => {
  const preview = await json('/api/import/preview', { method: 'POST', body: JSON.stringify({ text: note, year: 2026 }) });
  assert.equal(preview.data.duplicates.length, 16);
});

test('今日待办包含动作，完成动作会写入时间线', async () => {
  const today = await json('/api/today');
  assert.equal(today.status, 200);
  assert.ok(today.data.actions.length >= 1);
  const action = today.data.actions[0];
  const done = await json('/api/today/complete', { method: 'POST', body: JSON.stringify({ appId: action.appId, kind: action.kind, action: 'complete' }) });
  assert.equal(done.status, 200);
  assert.equal(done.data.ok, true);
  const detail = await json('/api/apps/' + action.appId);
  assert.ok(detail.data.events.length >= 2);
});

test('改状态会记录事件，统计按事件历史更新', async () => {
  const apps = await json('/api/apps');
  const target = apps.data.apps[0];
  const patched = await json('/api/apps/' + target.id, { method: 'PATCH', body: JSON.stringify({ status: 'interview', notes: '约了一面' }) });
  assert.equal(patched.status, 200);
  const detail = await json('/api/apps/' + target.id);
  assert.equal(detail.data.app.status, 'interview');
  assert.ok(detail.data.events.some(e => e.kind === 'status_change' && e.to_status === 'interview'));
  const stats = await json('/api/stats');
  assert.equal(stats.data.stats.currentlyInterviewing, 1);
  assert.equal(stats.data.stats.funnel.find(f => f.key === 'interview').count, 1);
});

test('新建 / 删除投递记录', async () => {
  const created = await json('/api/apps', { method: 'POST', body: JSON.stringify({ company: '测试公司', role: '后端实习生', status: 'applied', channel: 'boss', applied_at: '2026-10-20' }) });
  assert.equal(created.status, 201);
  assert.ok(created.data.app.id);
  const removed = await json('/api/apps/' + created.data.app.id, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  const missing = await json('/api/apps/' + created.data.app.id);
  assert.equal(missing.status, 404);
});

test('导出 Markdown / CSV / JSON 与备份', async () => {
  const md = await fetch(base + '/api/export/md');
  assert.equal(md.status, 200);
  assert.ok((await md.text()).includes('投递舱'));

  const csv = await fetch(base + '/api/export/csv');
  assert.equal(csv.status, 200);
  const csvBuf = Buffer.from(await csv.arrayBuffer());
  assert.deepEqual([csvBuf[0], csvBuf[1], csvBuf[2]], [0xef, 0xbb, 0xbf], 'CSV 需要 UTF-8 BOM 以便 Excel 识别中文');
  assert.ok(csvBuf.toString('utf8').includes('公司,岗位'));

  const exp = await json('/api/export/json');
  assert.equal(exp.data.applications.length, 16);

  const backup = await json('/api/backup', { method: 'POST' });
  assert.equal(backup.status, 200);
  assert.equal(backup.data.ok, true);
  assert.ok(backup.data.size > 0);
  assert.ok(existsSync(path.join(tmp, 'backups', path.basename(backup.data.file))), '备份文件应写入 data/backups');
});

test('设置项（阈值）可修改并持久化', async () => {
  const patched = await json('/api/settings', { method: 'PATCH', body: JSON.stringify({ followUpDays: 5, staleDaily: 10 }) });
  assert.equal(patched.status, 200);
  const boot = await json('/api/bootstrap');
  assert.equal(boot.data.settings.followUpDays, 5);
  assert.equal(boot.data.settings.staleDaily, 10);
});

test('主题设置可持久化，非法值被忽略', async () => {
  const patched = await json('/api/settings', { method: 'PATCH', body: JSON.stringify({ theme: 'dark' }) });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.settings.theme, 'dark');
  const boot = await json('/api/bootstrap');
  assert.equal(boot.data.settings.theme, 'dark');
  const bad = await json('/api/settings', { method: 'PATCH', body: JSON.stringify({ theme: 'neon' }) });
  assert.equal(bad.data.settings.theme, 'dark', '非法主题不应覆盖已保存值');
});

test('撤销导入批次会删除该批次创建的所有记录', async () => {
  const undo = await json('/api/import/undo', { method: 'POST', body: JSON.stringify({ batchId: batchId }) });
  assert.equal(undo.status, 200);
  assert.equal(undo.data.removed, 16);
  const apps = await json('/api/apps');
  assert.equal(apps.data.apps.length, 0);
});
test('扩展采集接口：CORS 预检 / 创建 / 去重 / 缺公司名', async () => {
  const pre = await fetch(base + '/api/capture', { method: 'OPTIONS', headers: { Origin: 'chrome-extension://abcdefghijklmnop', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');

  const created = await json('/api/capture', { method: 'POST', body: JSON.stringify({ company: '采集测试公司', role: 'Agent 实习生', channel: 'boss', status: 'applied', url: 'https://www.zhipin.com/job_detail/x.html', location: '上海', salary: '300/天' }) });
  assert.equal(created.status, 201);
  assert.equal(created.data.duplicated, false);
  assert.equal(created.data.app.channel, 'boss');
  assert.equal(created.data.app.status, 'applied');
  assert.ok(created.data.app.applied_at, '已投递应自动写入投递日期');
  assert.equal(created.data.app.jd_url, 'https://www.zhipin.com/job_detail/x.html');
  captureId = created.data.app.id;

  const dup = await json('/api/capture', { method: 'POST', body: JSON.stringify({ company: '采集测试公司', role: 'Agent 实习生', channel: 'official' }) });
  assert.equal(dup.status, 200);
  assert.equal(dup.data.duplicated, true);
  assert.equal(dup.data.app.id, captureId, '重复采集应返回已有记录而不是新建');

  const wish = await json('/api/capture', { method: 'POST', body: JSON.stringify({ company: '只收藏公司', role: '后端实习生' }) });
  assert.equal(wish.status, 201);
  assert.equal(wish.data.app.status, 'wishlist');
  assert.equal(wish.data.app.applied_at, null);
  wishId = wish.data.app.id;

  const bad = await json('/api/capture', { method: 'POST', body: JSON.stringify({ role: '只有岗位没有公司' }) });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.error);
});

test('日历导出 /api/export/ics：下载响应与 VEVENT', async () => {
  const res = await fetch(base + '/api/export/ics?download=1');
  assert.equal(res.status, 200);
  assert.ok((res.headers.get('content-type') || '').includes('text/calendar'));
  assert.ok((res.headers.get('content-disposition') || '').includes('.ics'));
  const text = await res.text();
  assert.ok(text.startsWith('BEGIN:VCALENDAR'), '日历应以 BEGIN:VCALENDAR 开头');
  assert.ok(text.includes('BEGIN:VEVENT'), '应有至少一个事件');
  assert.ok(text.includes('采集测试公司'));
  assert.ok(!/^\r?\n/.test(text), '不应有空行开头');

  const view = await json('/api/export/ics');
  assert.equal(view.status, 200);
  assert.ok(view.data.count >= 1);
  assert.equal(view.data.events.length, view.data.count);
  assert.ok(view.data.filename.endsWith('.ics'));
});

test('清理采集测试记录', async () => {
  for (const id of [captureId, wishId]) {
    if (!id) continue;
    const removed = await json('/api/apps/' + id, { method: 'DELETE' });
    assert.equal(removed.status, 200);
  }
  const apps = await json('/api/apps');
  assert.equal(apps.data.apps.length, 0);
});
