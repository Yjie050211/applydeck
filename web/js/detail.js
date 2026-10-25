import { get, post, patch, del } from './api.js';
import { esc, toast, overlay, closeOverlay, pill, fmtFull, fmtDate, statusMeta, statusCls, channelLabel } from './ui.js';

export const EVENT_LABELS = {
  status_change: '状态变更',
  applied: '投递',
  follow_up: '跟进',
  test: '笔试',
  test_done: '笔试完成',
  interview: '面试',
  offer: 'Offer',
  reject: '拒信',
  note: '备注',
  snooze: '稍后再看',
  thanks: '感谢信',
  review: '复盘',
  create: '创建'
};

function eventLine(ev) {
  const kind = EVENT_LABELS[ev.kind] || ev.kind;
  let text = kind;
  if (ev.kind === 'status_change' && ev.to_status) {
    text = (ev.from_status ? statusMeta(ev.from_status).label : '开始') + ' → ' + statusMeta(ev.to_status).label;
  }
  if (ev.content) text = text + '：' + ev.content;
  return '<div class="tl-item"><div class="tl-date">' + fmtFull(ev.occurred_at) + '</div><div class="tl-text">' + esc(text) + '</div></div>';
}

export async function openDetail(appId, onChanged) {
  const data = await get('/api/apps/' + appId);
  const app = data.app;
  const events = data.events || [];
  const statuses = ['wishlist', 'applied', 'test', 'interview', 'offer', 'closed'];
  const statusBtns = statuses.map(function (key) {
    const active = app.status === key ? ' active' : '';
    return '<button class="btn sm st-btn ' + statusCls(key) + active + '" data-status="' + key + '">' + statusMeta(key).label + '</button>';
  }).join('');
  const timeline = events.length ? events.slice().sort(function (a, b) { return String(a.occurred_at).localeCompare(String(b.occurred_at)); }).map(eventLine).join('') : '<div class="muted tiny">还没有时间线记录。每次状态变化自动记录。</div>';
  const html = '<div class="drawer-wrap">'
    + '<div class="drawer-mask"></div>'
    + '<div class="drawer">'
    + '<div class="drawer-head"><div style="flex:1">'
    + '<div class="drawer-title">' + esc(app.company) + ' <span class="muted" style="font-weight:400">' + esc(app.role || '') + '</span></div>'
    + '<div class="drawer-sub">' + esc(channelLabel(app.channel)) + ' · ' + esc(labelOfJobType(app.job_type)) + ' · 更新于 ' + esc(fmtFull(app.updated_at)) + '</div>'
    + '</div><button class="btn icon ghost" data-close aria-label="关闭">✕</button></div>'
    + '<div class="drawer-body">'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">' + statusBtns + '</div>'
    + '<dl class="kv">'
    + '<dt>投递日期</dt><dd>' + (app.applied_at ? esc(app.applied_at) + ' <span class="muted tiny">（' + esc(fmtDate(app.applied_at)) + '）</span>' : '<span class="muted">—</span>') + '</dd>'
    + '<dt>地点</dt><dd>' + esc(app.location || '—') + '</dd>'
    + '<dt>优先级</dt><dd>' + esc(labelOfPriority(app.priority)) + '</dd>'
    + '<dt>岗位链接</dt><dd>' + (app.jd_url ? '<a href="' + esc(app.jd_url) + '" target="_blank" rel="noreferrer">打开 JD ↗</a>' : '<span class="muted">—</span>') + '</dd>'
    + '<dt>下次行动</dt><dd>' + (app.next_action_at ? esc(app.next_action_at) + ' ' + esc(app.next_action || '') : '<span class="muted">—</span>') + '</dd>'
    + '</dl>'
    + (app.notes ? '<div class="hint-box" style="margin-bottom:16px"><b>备注</b><br>' + esc(app.notes).replace(/\n/g, '<br>') + '</div>' : '')
    + '<div class="section-head"><h2>时间线</h2><span>' + events.length + ' 条记录 · 统计基于事件历史</span></div>'
    + '<div class="timeline">' + timeline + '</div>'
    + '<div class="section-head" style="margin-top:18px"><h2>补一条记录</h2></div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
    + '<select class="select" id="ev-kind"><option value="note">备注</option><option value="follow_up">跟进</option><option value="test">笔试</option><option value="interview">面试</option><option value="offer">Offer</option><option value="reject">拒信</option></select>'
    + '<input class="input" id="ev-content" placeholder="例如：HR 约了下周一 10:30 一面" style="flex:1;min-width:170px" />'
    + '<input class="input" id="ev-date" type="date" style="width:150px" />'
    + '<button class="btn primary" id="ev-add">添加</button>'
    + '</div>'
    + '</div>'
    + '<div class="drawer-foot">'
    + '<button class="btn" id="d-edit">编辑</button>'
    + '<button class="btn danger" id="d-del" style="margin-left:auto">删除</button>'
    + '</div>'
    + '</div></div>';
  overlay(html);
  const changed = async function () { if (onChanged) await onChanged(); };
  document.querySelectorAll('[data-status]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      try {
        await patch('/api/apps/' + appId, { status: btn.getAttribute('data-status') });
        toast('状态已更新');
        await changed();
        openDetail(appId, onChanged);
      } catch (e) { toast(e.message, true); }
    });
  });
  document.getElementById('ev-add').addEventListener('click', async function () {
    const kind = document.getElementById('ev-kind').value;
    const content = document.getElementById('ev-content').value.trim();
    const date = document.getElementById('ev-date').value;
    try {
      await post('/api/apps/' + appId + '/events', { kind: kind, content: content, occurred_at: date ? date + 'T12:00:00' : undefined });
      toast('记录已添加');
      await changed();
      openDetail(appId, onChanged);
    } catch (e) { toast(e.message, true); }
  });
  document.getElementById('d-edit').addEventListener('click', function () { openAppForm(app, onChanged); });
  document.getElementById('d-del').addEventListener('click', async function () {
    if (!window.confirm('确定删除「' + app.company + ' · ' + (app.role || '') + '」？此操作不可撤销。')) return;
    try {
      await del('/api/apps/' + appId);
      toast('已删除');
      closeOverlay();
      await changed();
    } catch (e) { toast(e.message, true); }
  });
}

function labelOfJobType(key) {
  const map = { daily: '日常实习', summer: '暑期实习', autumn: '秋招', other: '其他' };
  return map[key] || key;
}
function labelOfPriority(key) {
  const map = { high: '冲刺', normal: '常规', low: '保底' };
  return map[key] || key;
}

export function openAppForm(app, onSaved) {
  const isEdit = !!app;
  const a = app || {};
  const statuses = ['wishlist', 'applied', 'test', 'interview', 'offer', 'closed'];
  const statusOpts = statuses.map(function (k) {
    return '<option value="' + k + '"' + (a.status === k ? ' selected' : '') + '>' + statusMeta(k).label + '</option>';
  }).join('');
  const channelOpts = ['official', 'boss', 'shixiseng', 'nowcoder', 'referral', 'other'].map(function (k) {
    const label = channelLabel(k);
    return '<option value="' + k + '"' + (a.channel === k ? ' selected' : '') + '>' + label + '</option>';
  }).join('');
  const jobTypeOpts = ['daily', 'summer', 'autumn', 'other'].map(function (k) {
    return '<option value="' + k + '"' + (a.job_type === k ? ' selected' : '') + '>' + labelOfJobType(k) + '</option>';
  }).join('');
  const priorityOpts = ['high', 'normal', 'low'].map(function (k) {
    return '<option value="' + k + '"' + (a.priority === k ? ' selected' : '') + '>' + labelOfPriority(k) + '</option>';
  }).join('');
  const html = '<div class="modal-wrap"><div class="modal-mask"></div><div class="modal">'
    + '<h3>' + (isEdit ? '编辑投递' : '新建投递') + '</h3>'
    + '<div class="modal-sub">' + (isEdit ? '修改信息不会重置时间线，状态变化会单独记录。' : '只填公司也能保存，其余可以之后补。') + '</div>'
    + '<div class="form-grid">'
    + '<div class="field"><label>公司 *</label><input id="f-company" value="' + esc(a.company || '') + '" placeholder="例如：字节跳动" /></div>'
    + '<div class="field"><label>岗位</label><input id="f-role" value="' + esc(a.role || '') + '" placeholder="例如：Agent 开发实习生" /></div>'
    + '<div class="field"><label>渠道</label><select id="f-channel">' + channelOpts + '</select></div>'
    + '<div class="field"><label>类型</label><select id="f-jobtype">' + jobTypeOpts + '</select></div>'
    + '<div class="field"><label>状态</label><select id="f-status">' + statusOpts + '</select></div>'
    + '<div class="field"><label>投递日期</label><input id="f-applied" type="date" value="' + esc((a.applied_at || '').slice(0, 10)) + '" /></div>'
    + '<div class="field"><label>地点</label><input id="f-location" value="' + esc(a.location || '') + '" placeholder="上海 / 北京 / 远程" /></div>'
    + '<div class="field"><label>优先级</label><select id="f-priority">' + priorityOpts + '</select></div>'
    + '<div class="field full"><label>JD 链接</label><input id="f-jdurl" value="' + esc(a.jd_url || '') + '" placeholder="https://..." /></div>'
    + '<div class="field full"><label>备注</label><textarea id="f-notes" placeholder="内推人、面试反馈、薪资、要不要去…">' + esc(a.notes || '') + '</textarea></div>'
    + '</div>'
    + '<div class="modal-foot"><button class="btn ghost" data-close>取消</button><button class="btn primary" id="f-save">' + (isEdit ? '保存' : '创建') + '</button></div>'
    + '</div></div>';
  overlay(html);
  document.getElementById('f-save').addEventListener('click', async function () {
    const body = {
      company: document.getElementById('f-company').value.trim(),
      role: document.getElementById('f-role').value.trim(),
      channel: document.getElementById('f-channel').value,
      job_type: document.getElementById('f-jobtype').value,
      status: document.getElementById('f-status').value,
      applied_at: document.getElementById('f-applied').value || null,
      location: document.getElementById('f-location').value.trim(),
      priority: document.getElementById('f-priority').value,
      jd_url: document.getElementById('f-jdurl').value.trim(),
      notes: document.getElementById('f-notes').value
    };
    if (!body.company) { toast('公司不能为空', true); return; }
    try {
      if (isEdit) await patch('/api/apps/' + app.id, body);
      else await post('/api/apps', body);
      toast(isEdit ? '已保存' : '已创建');
      closeOverlay();
      if (onSaved) await onSaved();
    } catch (e) { toast(e.message, true); }
  });
}
