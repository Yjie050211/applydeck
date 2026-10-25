// 主题控制：浅色 / 深色 / 跟随系统
// 设计：document.documentElement.dataset.theme = 'light' | 'dark'
// 选择结果同时写入 localStorage（首屏 pre-paint 用）和服务端 settings.theme（跨设备/重装保留）

const STORAGE_KEY = 'applydeck-theme';
const VALID = ['light', 'dark', 'system'];

export const THEME_MODES = [
  { key: 'light', label: '浅色', desc: 'Fluent 亮色，白底浅灰层叠' },
  { key: 'dark', label: '深色', desc: 'Mica 深色，夜间护眼' },
  { key: 'system', label: '跟随系统', desc: '跟着 Windows 的明暗设置走' }
];

const THEME_COLOR = { light: '#f3f3f3', dark: '#202020' };
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
let mode = 'system';
let resolved = 'light';
const listeners = [];

function readStored() {
  try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
}
function writeStored(value) {
  try { localStorage.setItem(STORAGE_KEY, value); } catch (e) {}
}

export function resolveTheme(value) {
  if (value === 'dark' || value === 'light') return value;
  return media && media.matches ? 'dark' : 'light';
}

export function themeMode() { return mode; }
export function themeResolved() { return resolved; }
export function modeLabel(value) {
  const row = THEME_MODES.find(function (x) { return x.key === value; });
  return row ? row.label : '跟随系统';
}

export function applyTheme(value, options) {
  mode = VALID.indexOf(value) >= 0 ? value : 'system';
  resolved = resolveTheme(mode);
  if (!options || options.persist !== false) writeStored(mode);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[resolved]);
  syncControls();
  listeners.forEach(function (fn) {
    try { fn(mode, resolved); } catch (e) {}
  });
  return resolved;
}

export function cycleTheme() {
  const order = ['light', 'dark', 'system'];
  const next = order[(order.indexOf(mode) + 1) % order.length];
  applyTheme(next);
  return next;
}

export function onThemeChange(fn) { listeners.push(fn); }

// 同步页面上所有声明了 data-theme-option / data-theme-cycle 的控件
export function syncControls() {
  document.querySelectorAll('[data-theme-option]').forEach(function (el) {
    const on = el.getAttribute('data-theme-option') === mode;
    el.classList.toggle('active', on);
    el.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  document.querySelectorAll('[data-theme-cycle]').forEach(function (el) {
    el.setAttribute('data-mode', mode);
    el.setAttribute('title', '主题：' + modeLabel(mode) + '（点击切换）');
    el.setAttribute('aria-label', '切换主题，当前' + modeLabel(mode));
    const label = el.querySelector('[data-theme-label]');
    if (label) label.textContent = modeLabel(mode);
  });
}

export function initTheme(serverMode) {
  const cached = readStored();
  // 即便本地没有缓存，也把服务端选择写回 localStorage：下次刷新首屏 pre-paint 就能直接用对主题，避免闪白
  applyTheme(cached || serverMode || 'system');
  if (media) {
    const onChange = function () { if (mode === 'system') applyTheme('system'); };
    if (media.addEventListener) media.addEventListener('change', onChange);
    else if (media.addListener) media.addListener(onChange);
  }
  window.addEventListener('storage', function (ev) {
    if (ev.key !== STORAGE_KEY) return;
    applyTheme(VALID.indexOf(ev.newValue) >= 0 ? ev.newValue : 'system', { persist: false });
  });
  return mode;
}
