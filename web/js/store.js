import { get } from './api.js';

export const state = {
  meta: null,
  apps: [],
  today: null,
  stats: null,
  route: 'today',
  q: '',
  filterStatus: '',
  filterChannel: '',
  lastImportBatch: localStorage.getItem('applydeck:lastBatch') || '',
  obsidianSaved: false
};

export function setQuery(q) { state.q = q || ''; }

export async function loadMeta() {
  state.meta = await get('/api/bootstrap');
  return state.meta;
}

export async function loadApps() {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.filterStatus) params.set('status', state.filterStatus);
  if (state.filterChannel) params.set('channel', state.filterChannel);
  const qs = params.toString();
  const data = await get('/api/apps' + (qs ? '?' + qs : ''));
  state.apps = data.apps || [];
  return state.apps;
}

export async function loadToday() {
  state.today = await get('/api/today');
  return state.today;
}

export async function loadStats() {
  const data = await get('/api/stats');
  state.stats = data.stats;
  return state.stats;
}

export function statusLabel(key) {
  const row = (state.meta && state.meta.statuses || []).find(function (s) { return s.key === key; });
  return row ? row.label : key;
}

export function channelLabel(key) {
  const row = (state.meta && state.meta.channels || []).find(function (c) { return c.key === key; });
  return row ? row.label : key;
}
