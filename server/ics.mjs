// Minimal RFC 5545 (iCalendar) builder for ApplyDeck. Zero dependencies.
import { addDays, addBusinessDays, staleThresholdDays } from './reminders.mjs';
import { todayStr } from './db.mjs';

const CAL_NAME = '投递舱 ApplyDeck';

function pad2(n) { return n < 10 ? '0' + n : String(n); }

export function icsDateOnly(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return m ? m[1] + m[2] + m[3] : null;
}

function nextDateOnly(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  return String(d.getUTCFullYear()) + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate());
}

export function escapeIcsText(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\n');
}

export function foldIcsLine(line) {
  const text = String(line);
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= 75) return text;
  const parts = [];
  let start = 0;
  while (start < bytes.length) {
    const limit = parts.length === 0 ? 75 : 74;
    let end = Math.min(start + limit, bytes.length);
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    if (end <= start) end = Math.min(start + limit, bytes.length);
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
  }
  return parts.join('\r\n ');
}

export function dtStampNow(now) {
  const d = now ? new Date(now) : new Date();
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function statusLabel(key) {
  const map = { wishlist: '待投递', applied: '已投递', test: '笔试', interview: '面试', offer: 'Offer', closed: '已关闭' };
  return map[key] || key || '';
}

export function deriveEvents(apps, events, settings, refDate) {
  const refDay = refDate ? String(refDate).slice(0, 10) : todayStr();
  const byApp = new Map();
  for (const e of events || []) {
    if (!byApp.has(e.application_id)) byApp.set(e.application_id, []);
    byApp.get(e.application_id).push(e);
  }
  const out = [];
  function add(app, date, kind, summary, description) {
    const day = String(date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    out.push({ appId: app.id, date: day, kind: kind, summary: summary, description: description });
  }
  for (const app of apps || []) {
    const evs = byApp.get(app.id) || [];
    const desc = '公司：' + app.company + '\n岗位：' + (app.role || '未填岗位') + '\n当前状态：' + statusLabel(app.status) + (app.location ? '\n地点：' + app.location : '') + (app.salary ? '\n薪资：' + app.salary : '') + (app.jd_url ? '\n链接：' + app.jd_url : '');
    if (app.test_at) add(app, app.test_at, 'test', '笔试：' + app.company + ' · ' + (app.role || '未填岗位'), desc);
    if (app.interview_at) add(app, app.interview_at, 'interview', '面试：' + app.company + ' · ' + (app.role || '未填岗位'), desc);
    if (app.deadline_at) add(app, app.deadline_at, 'deadline', 'Offer 截止：' + app.company + ' · ' + (app.role || '未填岗位'), desc);
    if (app.next_action_at && app.next_action) add(app, app.next_action_at, 'next_action', '待办：' + app.next_action + '（' + app.company + '）', desc);
    if (app.status === 'applied') {
      const applied = app.applied_at || app.status_changed_at;
      if (applied) {
        const coldDue = addDays(applied, staleThresholdDays(app, settings));
        if (coldDue && coldDue >= refDay) add(app, coldDue, 'judge_cold', '预期回音截止：' + app.company + ' · ' + (app.role || '未填岗位'), desc + '\n到这天还没回音，就在投递舱里标记「无回复」。');
        const followUps = evs.filter(function (e) { return e.kind === 'follow_up'; });
        if (followUps.length < 2) {
          const base = followUps.length ? followUps[followUps.length - 1].occurred_at : applied;
          const due = addBusinessDays(base, settings.followUpDays);
          if (due && due >= refDay) add(app, due, 'follow_up', '跟进：' + app.company + ' · ' + (app.role || '未填岗位'), desc + '\n投递后第 ' + settings.followUpDays + ' 个工作日，礼貌问一次进度。');
        }
      }
    }
    if (app.status === 'wishlist') {
      const due = addDays(app.created_at, settings.wishlistStaleDays);
      if (due && due >= refDay) add(app, due, 'wishlist_stale', '决定要不要投：' + app.company + ' · ' + (app.role || '未填岗位'), desc + '\n收藏超过 ' + settings.wishlistStaleDays + ' 天了，投出去或删掉。');
    }
  }
  out.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.summary < b.summary ? -1 : a.summary > b.summary ? 1 : 0;
  });
  return out;
}

export function buildIcs(apps, events, settings, options) {
  options = options || {};
  const stamp = dtStampNow(options.now);
  const derived = deriveEvents(apps, events, settings, options.today);
  const lines = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//ApplyDeck//投递舱 ' + (options.version || '0.2.0') + '//CN');
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');
  lines.push('X-WR-CALNAME:' + escapeIcsText(CAL_NAME));
  lines.push('X-WR-TIMEZONE:Asia/Shanghai');
  for (const ev of derived) {
    const start = icsDateOnly(ev.date);
    const end = nextDateOnly(ev.date);
    if (!start || !end) continue;
    lines.push('BEGIN:VEVENT');
    lines.push('UID:applydeck-' + ev.appId + '-' + ev.kind + '@applydeck.local');
    lines.push('DTSTAMP:' + stamp);
    lines.push('DTSTART;VALUE=DATE:' + start);
    lines.push('DTEND;VALUE=DATE:' + end);
    lines.push('SUMMARY:' + escapeIcsText(ev.summary));
    lines.push('DESCRIPTION:' + escapeIcsText(ev.description));
    lines.push('CATEGORIES:求职');
    lines.push('STATUS:CONFIRMED');
    lines.push('TRANSP:TRANSPARENT');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const text = lines.map(foldIcsLine).join('\r\n') + '\r\n';
  return { text: text, count: derived.length, events: derived };
}

export function icsFilename(refDate) {
  return 'applydeck-' + (refDate ? String(refDate).slice(0, 10) : todayStr()) + '.ics';
}
