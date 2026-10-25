import { diffDays } from './reminders.mjs';

export function computeStats(apps, events) {
  const byApp = new Map();
  for (const e of events) {
    if (!byApp.has(e.application_id)) byApp.set(e.application_id, []);
    byApp.get(e.application_id).push(e);
  }

  const rank = { wishlist: 0, applied: 1, test: 2, interview: 3, offer: 4, closed: 0 };
  const everReached = new Map();
  for (const app of apps) {
    const set = new Set();
    if (app.status !== 'closed') set.add(app.status);
    for (const e of (byApp.get(app.id) || [])) {
      if (e.to_status && e.to_status !== 'closed') set.add(e.to_status);
      if (e.kind === 'reject') set.add('closed');
    }
    everReached.set(app.id, set);
  }

  const appliedApps = apps.filter(a => a.applied_at || rank[a.status] >= 1);
  const funnelDefs = [
    { key: 'applied', label: '已投递' },
    { key: 'test', label: '笔试' },
    { key: 'interview', label: '面试' },
    { key: 'offer', label: 'Offer' }
  ];
  const funnel = funnelDefs.map((def, idx) => {
    const count = idx === 0 ? appliedApps.length : appliedApps.filter(a => everReached.get(a.id).has(def.key)).length;
    return {
      key: def.key,
      label: def.label,
      count: count,
      rate: appliedApps.length ? count / appliedApps.length : 0,
      stepRate: 0
    };
  });
  for (let i = 1; i < funnel.length; i++) {
    funnel[i].stepRate = funnel[i - 1].count ? funnel[i].count / funnel[i - 1].count : 0;
  }

  const channels = {};
  for (const app of appliedApps) {
    if (!channels[app.channel]) channels[app.channel] = { channel: app.channel, count: 0, interview: 0, offer: 0 };
    const row = channels[app.channel];
    row.count += 1;
    if (everReached.get(app.id).has('interview')) row.interview += 1;
    if (everReached.get(app.id).has('offer')) row.offer += 1;
  }
  const channelList = Object.values(channels).map(c => Object.assign({}, c, {
    interviewRate: c.count ? c.interview / c.count : 0,
    offerRate: c.count ? c.offer / c.count : 0
  })).sort((a, b) => b.count - a.count);

  const responseDays = [];
  for (const app of appliedApps) {
    if (!app.applied_at) continue;
    let first = null;
    for (const e of (byApp.get(app.id) || [])) {
      const isResponse = (e.kind === 'status_change' && ['test', 'interview', 'offer', 'closed'].indexOf(e.to_status) >= 0) || e.kind === 'reject' || e.kind === 'test' || e.kind === 'interview' || e.kind === 'offer';
      if (!isResponse) continue;
      if (String(e.occurred_at).slice(0, 10) <= String(app.applied_at).slice(0, 10)) continue;
      if (!first || e.occurred_at < first) first = e.occurred_at;
    }
    if (first) responseDays.push(diffDays(app.applied_at, first));
  }
  responseDays.sort((a, b) => a - b);
  const median = responseDays.length ? responseDays[Math.floor(responseDays.length / 2)] : null;

  const weeks = [];
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const monday = new Date(d);
    const w = (monday.getDay() + 6) % 7;
    monday.setDate(monday.getDate() - w);
    const key = monday.toISOString().slice(0, 10);
    weeks.push({ week: key, count: 0 });
  }
  const weekIndex = new Map(weeks.map((w, i) => [w.week, i]));
  for (const app of appliedApps) {
    if (!app.applied_at) continue;
    const d = new Date(String(app.applied_at).slice(0, 10) + 'T12:00:00');
    if (isNaN(d.getTime())) continue;
    const w = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - w);
    const key = d.toISOString().slice(0, 10);
    if (weekIndex.has(key)) weeks[weekIndex.get(key)].count += 1;
  }

  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const weeklyMoves = events.filter(e => e.kind === 'status_change' && new Date(e.occurred_at) >= sevenDaysAgo).length;

  const closedReasons = {};
  for (const app of apps) {
    if (app.status !== 'closed') continue;
    const key = app.closed_reason || 'unknown';
    closedReasons[key] = (closedReasons[key] || 0) + 1;
  }

  const active = apps.filter(a => a.status !== 'closed' && a.status !== 'wishlist');
  return {
    total: apps.length,
    active: active.length,
    wishlist: apps.filter(a => a.status === 'wishlist').length,
    closed: apps.filter(a => a.status === 'closed').length,
    applied: appliedApps.length,
    currentlyInterviewing: apps.filter(a => a.status === 'interview').length,
    offers: apps.filter(a => a.status === 'offer').length,
    funnel: funnel,
    channels: channelList,
    responseMedianDays: median,
    responseSamples: responseDays.length,
    cadence: weeks,
    weeklyMoves: weeklyMoves,
    closedReasons: closedReasons
  };
}