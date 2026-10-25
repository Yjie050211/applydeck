import { loadMeta, loadToday, state } from './store.js';
import { toast, esc } from './ui.js';
import { patch } from './api.js';
import { initTheme, cycleTheme, modeLabel, themeMode } from './theme.js';
import { openAppForm } from './detail.js';
import { renderToday } from './views/today.js';
import { renderBoard } from './views/board.js';
import { renderTable } from './views/table.js';
import { renderStats } from './views/stats.js';
import { renderImport } from './views/importView.js';
import { renderSettings } from './views/settings.js';

const ICONS = {
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="M8 15h3"/></svg>',
  board: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="5" height="16" rx="1.6"/><rect x="10" y="4" width="5" height="11" rx="1.6"/><rect x="17" y="4" width="4" height="7" rx="1.6"/></svg>',
  table: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.4"/><path d="M3 9.5h18M3 15h18M9 9.5V20"/></svg>',
  stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  import: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11M8 10l4 4 4-4"/><path d="M4 17v2.4A1.6 1.6 0 0 0 5.6 21h12.8A1.6 1.6 0 0 0 20 19.4V17"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6l-.06.08a2 2 0 1 1-2.88 0L11 20a1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1l-.08-.06a2 2 0 1 1 0-2.88L4 11a1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6l.06-.08a2 2 0 1 1 2.88 0L13 4a1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.12.38.34.72.6 1l.08.06a2 2 0 1 1 0 2.88L20 13a1.7 1.7 0 0 0-.6 1z"/></svg>',
  // 三枚主题图标，由 CSS 按 data-mode 只显示其中一枚
  sun: '<svg class="theme-ico ico-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/></svg>',
  moon: '<svg class="theme-ico ico-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5a8.7 8.7 0 1 0 10.7 10.7z"/></svg>',
  monitor: '<svg class="theme-ico ico-system" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12.4" rx="1.8"/><path d="M8.6 20h6.8M12 16.4V20"/></svg>'
};

const ROUTES = [
  { key: 'today', label: '今日待办', icon: ICONS.today, view: renderToday, sub: '只显示今天到期的动作，清完就收工' },
  { key: 'board', label: '进度看板', icon: ICONS.board, view: renderBoard, sub: '拖拽卡片推进状态，时间线自动记录' },
  { key: 'table', label: '全部投递', icon: ICONS.table, view: renderTable, sub: '筛选、搜索、编辑，随时定位' },
  { key: 'stats', label: '数据复盘', icon: ICONS.stats, view: renderStats, sub: '漏斗、渠道、响应速度都从事件历史算' },
  { key: 'import', label: '笔记导入', icon: ICONS.import, view: renderImport, sub: '把 Obsidian 笔记一键搬进来，可撤销' },
  { key: 'settings', label: '设置', icon: ICONS.settings, view: renderSettings, sub: '外观、阈值、备份、导出' }
];

let todoBadge = 0;

function routeFromHash() {
  const hash = (location.hash || '').replace(/^#\/?/, '');
  return ROUTES.find(function (r) { return r.key === hash; }) || ROUTES[0];
}

function themeButtonHtml() {
  return '<button class="btn theme-btn" id="btn-theme" data-theme-cycle data-mode="' + themeMode() + '" title="主题：' + modeLabel(themeMode()) + '（点击切换）" aria-label="切换主题">'
    + ICONS.sun + ICONS.moon + ICONS.monitor
    + '<span class="theme-btn-label" data-theme-label>' + modeLabel(themeMode()) + '</span>'
    + '</button>';
}

export function renderRail() {
  const rail = document.getElementById('rail');
  const counts = state.meta ? state.meta.counts : { total: 0, active: 0 };
  const items = ROUTES.map(function (r) {
    const active = routeFromHash().key === r.key;
    const badge = r.key === 'today' && todoBadge > 0 ? '<span class="nav-badge">' + todoBadge + '</span>' : '';
    return '<button class="nav-item' + (active ? ' active' : '') + '" data-route="' + r.key + '">' + r.icon + '<span>' + r.label + '</span>' + badge + '</button>';
  }).join('');
  rail.innerHTML = '<div class="brand"><div class="brand-mark">投</div><div class="brand-text"><div class="brand-name">投递舱</div><div class="brand-sub">ApplyDeck</div></div></div>'
    + '<nav class="nav">' + items + '</nav>'
    + '<div class="rail-foot">'
    + '<div class="rail-stat"><span>总记录</span><b>' + counts.total + '</b></div>'
    + '<div class="rail-stat"><span>在推进</span><b>' + counts.active + '</b></div>'
    + '<div class="rail-stat"><span>待投递</span><b>' + (counts.wishlist || 0) + '</b></div>'
    + '<div class="rail-stat"><span>今日待办</span><b>' + todoBadge + '</b></div>'
    + '<div class="rail-version">v0.3.0 · local first</div>'
    + '</div>';
  rail.querySelectorAll('[data-route]').forEach(function (btn) {
    btn.addEventListener('click', function () { location.hash = '#/' + btn.getAttribute('data-route'); });
  });
}

function renderTopbar() {
  const route = routeFromHash();
  const topbar = document.getElementById('topbar');
  const showSearch = route.key === 'board' || route.key === 'table';
  const searchHtml = showSearch ? '<label class="search">' + ICONS.search + '<input id="global-q" placeholder="搜索公司 / 岗位 / 备注" value="' + esc(state.q) + '" /></label>' : '';
  topbar.innerHTML = '<div class="topbar-heading"><div class="topbar-title">' + route.label + '</div><div class="topbar-sub">' + route.sub + '</div></div>'
    + '<div class="topbar-spacer"></div>'
    + searchHtml
    + themeButtonHtml()
    + '<button class="btn" id="btn-refresh" title="重新加载">刷新</button>'
    + '<button class="btn primary" id="btn-new">+ 新建投递</button>';
  const q = document.getElementById('global-q');
  if (q) {
    q.addEventListener('input', function () {
      state.q = q.value;
      const view = document.getElementById('view');
      route.view(view, refresh).catch(function (e) { toast(e.message, true); });
    });
  }
  document.getElementById('btn-theme').addEventListener('click', function () {
    const next = cycleTheme();
    toast('主题：' + modeLabel(next));
    patch('/api/settings', { theme: next }).catch(function () {});
  });
  document.getElementById('btn-refresh').addEventListener('click', function () { refresh(true); });
  document.getElementById('btn-new').addEventListener('click', function () { openAppForm(null, function () { refresh(); }); });
}

export async function refresh(notify) {
  await loadMeta();
  try { await loadToday(); } catch (e) {}
  todoBadge = state.today ? (state.today.summary.overdue + state.today.summary.today) : 0;
  renderRail();
  renderTopbar();
  const route = routeFromHash();
  const view = document.getElementById('view');
  view.innerHTML = '';
  try {
    await route.view(view, refresh);
  } catch (e) {
    view.innerHTML = '<div class="empty"><b>加载失败</b>' + esc(e.message) + '</div>';
    toast(e.message, true);
  }
  if (notify) toast('已刷新');
}

function start() {
  loadMeta().then(function () {
    initTheme(state.meta.settings.theme);
    renderRail();
    refresh();
  }).catch(function (e) {
    initTheme();
    document.getElementById('view').innerHTML = '<div class="empty"><b>无法连接本地服务</b>' + esc(e.message) + '<br><span class="tiny">请确认 start.bat 正在运行，或手动执行 npm start</span></div>';
  });
  window.addEventListener('hashchange', function () {
    refresh();
  });
}

ICONS.search = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';

start();
