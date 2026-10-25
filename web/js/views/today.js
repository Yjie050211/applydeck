import { loadToday, state } from '../store.js';
import { esc, pill, severityChip, emptyState, loadingState, toast } from '../ui.js';
import { post } from '../api.js';
import { openDetail } from '../detail.js';

const KIND_LABEL = {
  follow_up: '跟进',
  judge_cold: '判冷',
  wishlist_stale: '迟迟没投',
  test_prep: '笔试准备',
  interview_prep: '面试准备',
  thanks: '感谢信',
  review: '复盘',
  offer_deadline: 'Offer 决策'
};

function actionRow(item, refresh) {
  const completions = (item.completions || []).map(function (c) {
    const cls = c.key === 'complete' ? 'btn primary sm' : 'btn ghost sm';
    return '<button class="' + cls + '" data-app="' + esc(item.appId) + '" data-kind="' + esc(item.kind) + '" data-action="' + esc(c.key) + '">' + esc(c.label) + '</button>';
  }).join('');
  return '<div class="action" data-open="' + esc(item.appId) + '">'
    + '<div class="action-main">'
    + '<div class="action-title"><span class="co">' + esc(item.company) + '</span> · ' + esc(item.role || '未填岗位') + '</div>'
    + '<div class="action-detail">' + (KIND_LABEL[item.kind] || item.kind) + ' · ' + esc(item.detail || '') + '</div>'
    + '</div>'
    + (severityChip(item.severity, item.due))
    + '<div class="action-btns">' + completions + '</div>'
    + '</div>';
}

function groupBlock(key, title, items, refresh) {
  if (!items.length) return '';
  const rows = items.map(function (it) { return actionRow(it, refresh); }).join('');
  return '<div class="today-group"><div class="group-title ' + key + '"><span class="dot"></span>' + title + '（' + items.length + '）</div>' + rows + '</div>';
}

export async function renderToday(view, refresh) {
  view.innerHTML = loadingState();
  await loadToday();
  const t = state.today;
  if (!t) { view.innerHTML = emptyState('加载失败', '请稍后刷新'); return; }
  const overdue = t.actions.filter(function (a) { return a.severity === 'overdue'; });
  const todayItems = t.actions.filter(function (a) { return a.severity === 'today'; });
  const soon = t.actions.filter(function (a) { return a.severity === 'soon'; });
  const cards = '<div class="cards">'
    + '<div class="stat-card danger"><div class="stat-label">已逾期</div><div class="stat-value">' + overdue.length + '</div><div class="stat-hint">拖着不处理最伤心态</div></div>'
    + '<div class="stat-card warn"><div class="stat-label">今天该做</div><div class="stat-value">' + todayItems.length + '</div><div class="stat-hint">按规则自动生成</div></div>'
    + '<div class="stat-card"><div class="stat-label">未来 7 天</div><div class="stat-value">' + soon.length + '</div><div class="stat-hint">提前知道要准备什么</div></div>'
    + '<div class="stat-card ok"><div class="stat-label">当前进行中</div><div class="stat-value">' + (state.meta ? state.meta.counts.active : 0) + '</div><div class="stat-hint">' + t.date + '</div></div>'
    + '</div>';
  let body;
  if (!t.actions.length) {
    body = '<div class="panel">' + emptyState('今天没有待办', '所有投递都在正常推进中。可以去「进度看板」推进状态，或「全部投递」里补一条记录。') + '</div>';
  } else {
    body = groupBlock('overdue', '已逾期', overdue, refresh)
      + groupBlock('today', '今天', todayItems, refresh)
      + groupBlock('soon', '即将到期', soon, refresh);
  }
  view.innerHTML = cards + body;
  view.querySelectorAll('[data-action]').forEach(function (btn) {
    btn.addEventListener('click', async function (ev) {
      ev.stopPropagation();
      const appId = btn.getAttribute('data-app');
      const kind = btn.getAttribute('data-kind');
      const action = btn.getAttribute('data-action');
      try {
        await post('/api/today/complete', { appId: appId, kind: kind, action: action });
        toast(action === 'complete' ? '已处理' : '已稍后提醒');
        await refresh();
      } catch (e) { toast(e.message, true); }
    });
  });
  view.querySelectorAll('[data-open]').forEach(function (row) {
    row.addEventListener('click', function () { openDetail(row.getAttribute('data-open'), refresh); });
  });
}
