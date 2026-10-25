import { todayStr } from './db.mjs';

export function parseDate(value) {
  if (!value) return null;
  const s = String(value);
  const d = new Date(s.length <= 10 ? s + 'T12:00:00' : s);
  return isNaN(d.getTime()) ? null : d;
}

export function dateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

export function today() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d;
}

export function addDays(value, n) {
  const d = parseDate(value);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return dateStr(d);
}

export function addBusinessDays(value, n) {
  const d = parseDate(value);
  if (!d) return null;
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const w = d.getDay();
    if (w !== 0 && w !== 6) added += 1;
  }
  return dateStr(d);
}

export function diffDays(from, to) {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function staleThresholdDays(app, settings) {
  if (app.job_type === 'daily') return settings.staleDaily;
  if (app.job_type === 'summer') return settings.staleSummer;
  return settings.staleAutumn;
}

function completionsFor(kind) {
  const map = {
    follow_up: [{ key: 'complete', label: '已跟进' }],
    judge_cold: [{ key: 'complete', label: '标记无回复' }, { key: 'open', label: '再等等' }],
    wishlist_stale: [{ key: 'complete', label: '已投递' }, { key: 'open', label: '先放着' }],
    thanks: [{ key: 'complete', label: '已发感谢信' }],
    review: [{ key: 'complete', label: '复盘完成' }],
    test_prep: [{ key: 'complete', label: '笔试完成' }]
  };
  return map[kind] || [{ key: 'open', label: '打开' }];
}

export function computeActions(app, events, settings, refDate) {
  const t = refDate ? dateStr(refDate) : todayStr();
  const out = [];
  const push = (kind, due, title, detail) => {
    if (!due) return;
    const severity = due < t ? 'overdue' : (due === t ? 'today' : 'soon');
    out.push({
      id: app.id + ':' + kind,
      appId: app.id,
      kind: kind,
      due: due,
      severity: severity,
      title: title,
      detail: detail || '',
      company: app.company,
      role: app.role,
      status: app.status,
      completions: completionsFor(kind)
    });
  };

  if (app.status === 'wishlist') {
    const due = addDays(app.created_at, settings.wishlistStaleDays);
    if (t >= due) push('wishlist_stale', due, '收藏了几天，还投吗？', '超过 ' + settings.wishlistStaleDays + ' 天未投递');
    return out;
  }

  if (app.status === 'applied') {
    const appliedDate = app.applied_at || app.status_changed_at;
    const burstDays = diffDays(appliedDate, t);
    const followUps = events.filter(e => e.kind === 'follow_up' && e.occurred_at >= appliedDate);
    const coldDue = addDays(appliedDate, staleThresholdDays(app, settings));
    const isCold = t >= coldDue;
    if (isCold) {
      push('judge_cold', coldDue, '已 ' + burstDays + ' 天没有回音', '按规则建议判冷：标记「无回复」参与统计');
    } else if (followUps.length < 2) {
      const base = followUps.length ? followUps[followUps.length - 1].occurred_at : appliedDate;
      const due = addBusinessDays(base, settings.followUpDays);
      if (due && t >= due) {
        push('follow_up', due, followUps.length ? '第二次跟进（最后一次）' : '投递后第 3 个工作日，发条跟进', '同环节最多跟进 2 次，间隔不少于 3 个工作日');
      }
    }
  }

  if (app.status === 'test') {
    const testDate = app.test_at ? String(app.test_at).slice(0, 10) : null;
    if (testDate) {
      const due = addDays(testDate, -1);
      if (t >= due && t <= testDate) push('test_prep', due, '笔试快到了', '笔试日期：' + testDate + '，准备好设备和身份证件');
    } else {
      const due = addDays(app.status_changed_at, 3);
      if (t >= due) push('test_prep', due, '笔试完成了吗？', '完成后把状态推进到下一阶段，或标记「无回复」');
    }
  }

  if (app.status === 'interview') {
    const iv = app.interview_at ? String(app.interview_at).slice(0, 10) : null;
    if (iv) {
      const prepDue = addDays(iv, -1);
      if (iv >= t && t >= prepDue) push('interview_prep', prepDue, '面试前准备', '面试时间：' + app.interview_at + '，确认地点/链接、过一遍公司业务');
      const thanksDue = addDays(iv, 1);
      if (t >= thanksDue && t <= addDays(iv, 3)) push('thanks', thanksDue, '发一条感谢信', '面试后 24 小时内，简短、具体、不催结果');
      const reviewDue = addBusinessDays(iv, 3);
      if (t >= reviewDue) push('review', reviewDue, '记 3 行复盘', '问了什么 / 哪里答虚 / 下次怎么改');
    } else {
      const due = addDays(app.status_changed_at, 3);
      if (t >= due) push('follow_up', due, '面试后跟进', '面试没有下一步时，主动问一次进度');
    }
  }

  if (app.status === 'offer' && app.deadline_at) {
    const dl = String(app.deadline_at).slice(0, 10);
    const left = diffDays(t, dl);
    if (left !== null && left <= 3) push('offer_deadline', addDays(dl, -3), 'Offer 截止还有 ' + Math.max(left, 0) + ' 天', '做决定，或联系 HR 申请延期（7–15 天窗口）');
  }

  return out;
}
