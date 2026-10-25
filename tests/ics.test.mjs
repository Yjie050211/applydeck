import test from 'node:test';
import assert from 'node:assert/strict';
import { icsDateOnly, escapeIcsText, foldIcsLine, buildIcs, icsFilename, deriveEvents } from '../server/ics.mjs';
import { addBusinessDays } from '../server/reminders.mjs';

const SETTINGS = { followUpDays: 3, staleDaily: 7, staleSummer: 14, staleAutumn: 21, wishlistStaleDays: 7 };

function app(over) {
  return Object.assign({ id: 1, company: '字节跳动', role: 'Agent 开发实习生', status: 'applied', job_type: 'daily', applied_at: '2026-10-16', created_at: '2026-10-16' }, over || {});
}

function linesOf(ics) {
  return ics.split('\r\n');
}

test('icsDateOnly 只认 YYYY-MM-DD', () => {
  assert.equal(icsDateOnly('2026-10-24'), '20261024');
  assert.equal(icsDateOnly('2026-10-24T09:00:00'), '20261024');
  assert.equal(icsDateOnly(''), null);
  assert.equal(icsDateOnly('not-a-date'), null);
});

test('escapeIcsText 转义分号逗号反斜杠与换行', () => {
  assert.equal(escapeIcsText('a;b,c'), 'a\\;b\\,c');
  assert.equal(escapeIcsText('第一行\n第二行'), '第一行\\n第二行');
  assert.equal(escapeIcsText('路径\\x'), '路径\\\\x');
});

test('foldIcsLine 每行不超过 75 字节且中文不截断', () => {
  const long = 'SUMMARY:' + '投递舱测试'.repeat(30);
  const folded = foldIcsLine(long);
  const lines = folded.split('\r\n ');
  assert.ok(lines.length > 1);
  for (const line of lines) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, '每行不超过 75 字节：' + Buffer.byteLength(line, 'utf8'));
  assert.equal(folded.replace(/\r\n /g, ''), long, '折行可以无损拼回');
});

test('deriveEvents 按规则生成跟进 / 判冷 / 待投递提醒', () => {
  const apps = [
    app({ id: 1 }),
    app({ id: 2, company: 'MiniMax', role: null, status: 'wishlist', applied_at: null, created_at: '2026-10-20' })
  ];
  const evs = deriveEvents(apps, [], SETTINGS, '2026-10-16');
  const kinds = evs.map(e => e.kind).sort();
  assert.deepEqual(kinds, ['follow_up', 'judge_cold', 'wishlist_stale'].sort());
  const follow = evs.find(e => e.kind === 'follow_up');
  assert.equal(follow.date, addBusinessDays('2026-10-16', 3));
  const cold = evs.find(e => e.kind === 'judge_cold');
  assert.equal(cold.date, '2026-10-23');
  const wish = evs.find(e => e.kind === 'wishlist_stale');
  assert.equal(wish.date, '2026-10-27', '待投递提醒 = 收藏日 + wishlistStaleDays');
});

test('buildIcs 输出合法日历且每行合规', () => {
  const apps = [app()];
  const built = buildIcs(apps, [], SETTINGS, { today: '2026-10-16', now: '2026-10-16T02:00:00Z', version: '0.2.0' });
  assert.ok(built.count >= 2);
  const ics = built.text;
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'));
  assert.ok(ics.includes('BEGIN:VEVENT'));
  assert.ok(ics.includes('UID:applydeck-1-follow_up@applydeck.local'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:' + addBusinessDays('2026-10-16', 3).replace(/-/g, '')));
  for (const line of linesOf(ics)) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, '行超过 75 字节：' + line.slice(0, 40));
  assert.ok(icsFilename('2026-10-24').endsWith('2026-10-24.ics'));
});

test('过期动作不会进入日历（只导出未来事件）', () => {
  const apps = [app({ applied_at: '2026-01-05', created_at: '2026-01-05' })];
  const built = buildIcs(apps, [], SETTINGS, { today: '2026-10-24' });
  assert.equal(built.count, 0);
  assert.ok(!built.text.includes('BEGIN:VEVENT'));
});
