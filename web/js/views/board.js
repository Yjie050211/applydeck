import { loadApps, state } from '../store.js';
import { esc, pill, statusMeta, statusCls, fmtDate, staleClass, channelLabel, loadingState, emptyState, toast } from '../ui.js';
import { patch } from '../api.js';
import { openDetail } from '../detail.js';

export async function renderBoard(view, refresh) {
  view.innerHTML = loadingState();
  await loadApps();
  const statuses = state.meta.statuses.slice().sort(function (a, b) { return a.order - b.order; });
  const cols = statuses.map(function (st) {
    const list = state.apps.filter(function (a) { return a.status === st.key; });
    const cards = list.map(function (a) {
      return '<div class="job-card" draggable="true" data-id="' + esc(a.id) + '">'
        + '<div class="jc-company">' + esc(a.company) + '<span class="stale-dot ' + staleClass(a) + '"></span></div>'
        + '<div class="jc-role">' + esc(a.role || '未填岗位') + '</div>'
        + '<div class="jc-meta">'
        + '<span class="tag accent">' + esc(channelLabel(a.channel)) + '</span>'
        + (a.applied_at ? '<span class="tag">' + esc(fmtDate(a.applied_at)) + '</span>' : '')
        + (a.location ? '<span class="tag">' + esc(a.location) + '</span>' : '')
        + '</div></div>';
    }).join('');
    return '<div class="col" data-status="' + st.key + '">'
      + '<div class="col-head"><span class="dot st-dot ' + statusCls(st.key) + '"></span><span>' + st.label + '</span><span class="n">' + list.length + '</span></div>'
      + '<div class="col-body" data-drop="' + st.key + '">' + (cards || '<div class="tiny muted" style="padding:10px 4px">拖到这里</div>') + '</div>'
      + '</div>';
  }).join('');
  view.innerHTML = '<div class="section-head"><h2>进度看板</h2><span>' + state.apps.length + ' 条记录 · 拖拽卡片即可改状态 · 点卡片看时间线</span></div>'
    + '<div class="board">' + cols + '</div>';

  let dragId = '';
  view.querySelectorAll('.job-card').forEach(function (card) {
    card.addEventListener('dragstart', function (ev) {
      dragId = card.getAttribute('data-id');
      card.classList.add('dragging');
      ev.dataTransfer.setData('text/plain', dragId);
      ev.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', function () { card.classList.remove('dragging'); });
    card.addEventListener('click', function () {
      if (card.classList.contains('dragging')) return;
      openDetail(card.getAttribute('data-id'), refresh);
    });
  });
  view.querySelectorAll('[data-drop]').forEach(function (body) {
    body.addEventListener('dragover', function (ev) { ev.preventDefault(); body.parentElement.classList.add('dragover'); });
    body.addEventListener('dragleave', function () { body.parentElement.classList.remove('dragover'); });
    body.addEventListener('drop', async function (ev) {
      ev.preventDefault();
      body.parentElement.classList.remove('dragover');
      const id = dragId || ev.dataTransfer.getData('text/plain');
      const status = body.getAttribute('data-drop');
      if (!id) return;
      try {
        await patch('/api/apps/' + id, { status: status });
        toast('已移动到「' + statusMeta(status).label + '」');
        await refresh();
      } catch (e) { toast(e.message, true); }
    });
  });
}
