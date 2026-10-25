import { get } from './api.js';

export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function pad(n) { return String(n).padStart(2, '0'); }

export function fmtDate(value) {
  if (!value) return '—';
  const s = String(value);
  return s.slice(5, 10);
}

export function fmtFull(value) {
  if (!value) return '—';
  const s = String(value).replace('T', ' ');
  return s.slice(0, 16);
}

export function daysSince(value) {
  if (!value) return null;
  const d = new Date(String(value).slice(0, 10) + 'T12:00:00');
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return Math.round((now.getTime() - d.getTime()) / 86400000);
}

export function relDays(value) {
  const n = daysSince(value);
  if (n === null) return '—';
  if (n === 0) return '今天';
  if (n === 1) return '昨天';
  if (n < 0) return Math.abs(n) + ' 天后';
  return n + ' 天前';
}

const STATUS_LABELS = {
  wishlist: '待投递',
  applied: '已投递',
  test: '笔试',
  interview: '面试',
  offer: 'Offer',
  closed: '已关闭'
};

// 颜色不再写死在 JS 里：由 style.css 的 .st-* 类按明暗主题分别提供，
// 这样切主题时状态色会自动适配，也不会出现内联样式覆盖主题的问题。
export function statusMeta(key) {
  return { label: STATUS_LABELS[key] || key };
}

export function statusCls(key) {
  return 'st-' + (STATUS_LABELS[key] ? key : 'wishlist');
}

const CHANNEL_LABELS = { official: '官网', boss: 'BOSS直聘', shixiseng: '实习僧', nowcoder: '牛客', referral: '内推', other: '其他' };
export function channelLabel(key) {
  return CHANNEL_LABELS[key] || key || '其他';
}

export function pill(key) {
  return '<span class="pill ' + statusCls(key) + '"><i class="dot"></i>' + statusMeta(key).label + '</span>';
}

export function severityChip(sev, due) {
  const cls = sev === 'overdue' ? 'overdue' : sev === 'today' ? 'today' : 'soon';
  const label = sev === 'overdue' ? '逾期 ' + fmtDate(due) : sev === 'today' ? '今天' : fmtDate(due);
  return '<span class="chip ' + cls + '">' + label + '</span>';
}

export function staleClass(app) {
  const days = daysSince(app.applied_at || app.status_changed_at);
  if (days === null) return 'fresh';
  const limit = app.job_type === 'summer' ? 14 : app.job_type === 'autumn' ? 21 : 7;
  if (days >= limit) return 'cold';
  if (days >= Math.ceil(limit / 2)) return 'warm';
  return 'fresh';
}

let toastTimer = null;
export function toast(message, isError) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = 'toast show' + (isError ? ' err' : '');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.className = 'toast'; }, 2600);
}

export function overlay(html, onClose) {
  const host = document.getElementById('overlay');
  host.innerHTML = html;
  const wrap = host.firstElementChild;
  if (!wrap) return;
  const mask = wrap.querySelector('.modal-mask, .drawer-mask');
  if (mask) {
    mask.addEventListener('click', function () { closeOverlay(); if (onClose) onClose(); });
  }
  host.querySelectorAll('[data-close]').forEach(function (btn) {
    btn.addEventListener('click', function () { closeOverlay(); if (onClose) onClose(); });
  });
  return wrap;
}

export function closeOverlay() {
  const host = document.getElementById('overlay');
  if (host) host.innerHTML = '';
}

export function confirmDialog(message) {
  return Promise.resolve(window.confirm(message));
}

export function emptyState(title, hint) {
  return '<div class="empty"><b>' + esc(title) + '</b>' + esc(hint || '') + '</div>';
}

export function loadingState() {
  return '<div class="loading"><div class="spinner"></div>加载中…</div>';
}

export function debounce(fn, ms) {
  let timer = null;
  return function () {
    const args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function () { fn.apply(null, args); }, ms || 200);
  };
}