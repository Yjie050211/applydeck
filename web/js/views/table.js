import { loadApps, state } from '../store.js';
import { esc, pill, fmtDate, relDays, channelLabel, loadingState, emptyState, toast, confirmDialog } from '../ui.js';
import { del } from '../api.js';
import { openDetail, openAppForm } from '../detail.js';

export async function renderTable(view, refresh) {
  view.innerHTML = loadingState();
  await loadApps();
  const statuses = state.meta.statuses;
  const channels = state.meta.channels;
  const statusOpts = '<option value="">全部状态</option>' + statuses.map(function (s) {
    return '<option value="' + s.key + '"' + (state.filterStatus === s.key ? ' selected' : '') + '>' + s.label + '</option>';
  }).join('');
  const channelOpts = '<option value="">全部渠道</option>' + channels.map(function (c) {
    return '<option value="' + c.key + '"' + (state.filterChannel === c.key ? ' selected' : '') + '>' + c.label + '</option>';
  }).join('');
  const rows = state.apps.map(function (a) {
    return '<tr data-id="' + esc(a.id) + '">'
      + '<td><div class="tbl-co">' + esc(a.company) + '</div><div class="tbl-role">' + esc(a.role || '未填岗位') + '</div></td>'
      + '<td>' + pill(a.status) + '</td>'
      + '<td>' + esc(channelLabel(a.channel)) + '</td>'
      + '<td>' + (a.applied_at ? esc(a.applied_at) : '<span class="muted">—</span>') + '</td>'
      + '<td class="muted">' + (a.applied_at ? relDays(a.applied_at) : '—') + '</td>'
      + '<td>' + (a.location ? esc(a.location) : '<span class="muted">—</span>') + '</td>'
      + '<td class="row-actions"><button class="btn sm ghost" data-edit="' + esc(a.id) + '">编辑</button><button class="btn sm danger" data-del="' + esc(a.id) + '">删除</button></td>'
      + '</tr>';
  }).join('');
  view.innerHTML = '<div class="panel">'
    + '<div class="toolbar">'
    + '<select class="select" id="f-status">' + statusOpts + '</select>'
    + '<select class="select" id="f-channel">' + channelOpts + '</select>'
    + '<span class="muted tiny" style="margin-left:auto">共 ' + state.apps.length + ' 条</span>'
    + '</div>'
    + (state.apps.length ? '<table class="tbl"><thead><tr><th>公司 / 岗位</th><th>状态</th><th>渠道</th><th>投递日</th><th>距今</th><th>地点</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
      : emptyState('没有匹配的记录', '试试清空筛选条件，或者新建一条投递。'))
    + '</div>';
  document.getElementById('f-status').addEventListener('change', async function (ev) {
    state.filterStatus = ev.target.value;
    await refresh();
  });
  document.getElementById('f-channel').addEventListener('change', async function (ev) {
    state.filterChannel = ev.target.value;
    await refresh();
  });
  view.querySelectorAll('tbody tr').forEach(function (tr) {
    tr.addEventListener('click', function (ev) {
      if (ev.target.closest('[data-edit]') || ev.target.closest('[data-del]')) return;
      openDetail(tr.getAttribute('data-id'), refresh);
    });
  });
  view.querySelectorAll('[data-edit]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      const id = btn.getAttribute('data-edit');
      const app = state.apps.find(function (a) { return a.id === id; });
      if (app) openAppForm(app, refresh);
    });
  });
  view.querySelectorAll('[data-del]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      const id = btn.getAttribute('data-del');
      const app = state.apps.find(function (a) { return a.id === id; });
      const ok = await confirmDialog('确定删除「' + (app ? app.company : '') + '」？此操作不可撤销。');
      if (!ok) return;
      try {
        await del('/api/apps/' + id);
        toast('已删除');
        await refresh();
      } catch (e) { toast(e.message, true); }
    });
  });
}
