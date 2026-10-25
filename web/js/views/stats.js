import { loadStats, state } from '../store.js';
import { esc, loadingState, emptyState } from '../ui.js';

function pct(v) { return Math.round((v || 0) * 100) + '%'; }

export async function renderStats(view) {
  view.innerHTML = loadingState();
  await loadStats();
  const s = state.stats;
  if (!s) { view.innerHTML = emptyState('还没有数据', '先导入或新建一条投递记录吧。'); return; }
  const cards = '<div class="cards">'
    + '<div class="stat-card"><div class="stat-label">总投递</div><div class="stat-value">' + s.applied + '<small>份</small></div><div class="stat-hint">含已关闭，按事件历史算</div></div>'
    + '<div class="stat-card"><div class="stat-label">在推进</div><div class="stat-value">' + s.active + '<small>条</small></div><div class="stat-hint">待投递 ' + (s.wishlist || 0) + ' 条 · 总记录 ' + s.total + '</div></div>'
    + '<div class="stat-card ok"><div class="stat-label">Offer</div><div class="stat-value">' + s.offers + '<small>个</small></div><div class="stat-hint">当前持有</div></div>'
    + '<div class="stat-card"><div class="stat-label">中位响应</div><div class="stat-value">' + (s.responseMedianDays === null ? '—' : s.responseMedianDays) + '<small>' + (s.responseMedianDays === null ? '' : '天') + '</small></div><div class="stat-hint">' + s.responseSamples + ' 个样本 · 从投递到首次反馈</div></div>'
    + '</div>';

  const funnel = s.funnel.map(function (f) {
    const width = f.rate * 100;
    return '<div class="bar-row"><span>' + esc(f.label) + '</span><div class="bar-track"><div class="bar-fill" style="width:' + Math.max(width, 2) + '%"></div></div><span class="n">' + f.count + '</span></div>'
      + '<div class="tiny muted" style="margin:-4px 0 4px 96px">转化率 ' + pct(f.rate) + (f.stepRate ? ' · 环节转化 ' + pct(f.stepRate) : '') + '</div>';
  }).join('');

  const channels = s.channels.length
    ? '<table class="tbl"><thead><tr><th>渠道</th><th>投递</th><th>进面</th><th>面试率</th><th>Offer</th></tr></thead><tbody>'
      + s.channels.map(function (c) {
        return '<tr><td>' + esc(channelName(c.channel)) + '</td><td>' + c.count + '</td><td>' + c.interview + '</td><td>' + pct(c.interviewRate) + '</td><td>' + c.offer + '</td></tr>';
      }).join('') + '</tbody></table>'
    : '<div class="muted tiny">还没有投递数据。</div>';

  const maxWeek = Math.max.apply(null, s.cadence.map(function (w) { return w.count; }).concat([1]));
  const cadence = '<div class="cadence">' + s.cadence.map(function (w) {
    const h = Math.round((w.count / maxWeek) * 100);
    return '<div class="c" title="' + w.week + '：' + w.count + ' 份"><div class="b" style="height:' + Math.max(h, 2) + '%"></div><div class="lb">' + w.week.slice(5) + '</div></div>';
  }).join('') + '</div>';

  const reasons = Object.keys(s.closedReasons || {});
  const reasonList = reasons.length
    ? reasons.map(function (k) {
      const label = { rejected: '拒信', ghosted: '无回复', withdrawn: '主动放弃', accepted_other: '已接其他', posting_gone: '岗位下架', unknown: '未标注' }[k] || k;
      return '<div class="rail-stat" style="padding:5px 0"><span>' + label + '</span><b>' + s.closedReasons[k] + '</b></div>';
    }).join('')
    : '<div class="muted tiny">还没有关闭的投递。</div>';

  view.innerHTML = '<div class="section-head"><h2>关键指标</h2><span>数字都从事件历史推导，改状态不会篡改过去</span></div>'
    + cards
    + '<div class="split">'
    + '<div class="panel"><div class="section-head"><h2>投递漏斗</h2><span>以「已投递」为分母</span></div><div class="bars">' + funnel + '</div>'
    + '<div class="section-head" style="margin-top:22px"><h2>每周投递节奏</h2><span>最近 8 周</span></div>' + cadence
    + '<div class="ctx-note">连续投递比突击投递有效，但别用它制造焦虑。</div></div>'
    + '<div class="panel"><div class="section-head"><h2>渠道效果</h2><span>哪个渠道值得加码</span></div>' + channels
    + '<div class="section-head" style="margin-top:22px"><h2>关闭原因</h2><span>分母是全部关闭记录</span></div>' + reasonList
    + '<div class="ctx-note" style="margin-top:14px">近 7 天状态推进 ' + s.weeklyMoves + ' 次。</div></div>'
    + '</div>';
}

function channelName(key) {
  const map = { official: '官网', boss: 'BOSS直聘', shixiseng: '实习僧', nowcoder: '牛客', referral: '内推', other: '其他' };
  return map[key] || key;
}