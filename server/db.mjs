import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const STATUSES = [
  { key: 'wishlist', label: '待投递', order: 0, hint: '收藏/种草，还没投' },
  { key: 'applied', label: '已投递', order: 1, hint: '已提交，等回音' },
  { key: 'test', label: '笔试', order: 2, hint: '笔试/测评阶段' },
  { key: 'interview', label: '面试', order: 3, hint: '面试进行中' },
  { key: 'offer', label: 'Offer', order: 4, hint: '拿到 Offer / 在谈' },
  { key: 'closed', label: '已关闭', order: 5, hint: '拒信 / 无回复 / 放弃' }
];
export const STATUS_KEYS = STATUSES.map(s => s.key);

export const CLOSED_REASONS = [
  { key: 'rejected', label: '拒信' },
  { key: 'ghosted', label: '无回复' },
  { key: 'withdrawn', label: '主动放弃' },
  { key: 'accepted_other', label: '已接其他' },
  { key: 'posting_gone', label: '岗位下架' }
];

export const CHANNELS = [
  { key: 'official', label: '官网' },
  { key: 'boss', label: 'BOSS直聘' },
  { key: 'shixiseng', label: '实习僧' },
  { key: 'nowcoder', label: '牛客' },
  { key: 'referral', label: '内推' },
  { key: 'other', label: '其他' }
];

export const JOB_TYPES = [
  { key: 'daily', label: '日常实习' },
  { key: 'summer', label: '暑期实习' },
  { key: 'autumn', label: '秋招' },
  { key: 'other', label: '其他' }
];

export const PRIORITIES = [
  { key: 'high', label: '冲刺' },
  { key: 'normal', label: '常规' },
  { key: 'low', label: '保底' }
];

export const DEFAULT_SETTINGS = {
  obsidianDir: '',
  importYear: 2026,
  followUpDays: 3,
  staleDaily: 7,
  staleSummer: 14,
  staleAutumn: 21,
  wishlistStaleDays: 7,
  theme: 'system'
};

export function nowIso() { return new Date().toISOString(); }

export function todayStr(d) {
  const x = d ? new Date(d) : new Date();
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

export function toDateOnly(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS applications (',
  '  id TEXT PRIMARY KEY,',
  '  company TEXT NOT NULL,',
  '  role TEXT NOT NULL DEFAULT "",',
  '  channel TEXT NOT NULL DEFAULT "other",',
  '  job_type TEXT NOT NULL DEFAULT "daily",',
  '  status TEXT NOT NULL DEFAULT "applied",',
  '  closed_reason TEXT,',
  '  applied_at TEXT,',
  '  status_changed_at TEXT,',
  '  test_at TEXT,',
  '  interview_at TEXT,',
  '  deadline_at TEXT,',
  '  next_action TEXT,',
  '  next_action_at TEXT,',
  '  jd_url TEXT,',
  '  jd_text TEXT,',
  '  location TEXT,',
  '  salary TEXT,',
  '  resume_version TEXT,',
  '  priority TEXT NOT NULL DEFAULT "normal",',
  '  tags TEXT NOT NULL DEFAULT "[]",',
  '  notes TEXT NOT NULL DEFAULT "",',
  '  source TEXT NOT NULL DEFAULT "manual",',
  '  import_batch_id TEXT,',
  '  created_at TEXT NOT NULL,',
  '  updated_at TEXT NOT NULL',
  ');',
  'CREATE INDEX IF NOT EXISTS idx_app_status ON applications(status);',
  'CREATE INDEX IF NOT EXISTS idx_app_applied ON applications(applied_at);',
  'CREATE TABLE IF NOT EXISTS events (',
  '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
  '  application_id TEXT NOT NULL,',
  '  kind TEXT NOT NULL,',
  '  from_status TEXT,',
  '  to_status TEXT,',
  '  content TEXT NOT NULL DEFAULT "",',
  '  occurred_at TEXT NOT NULL,',
  '  created_at TEXT NOT NULL',
  ');',
  'CREATE INDEX IF NOT EXISTS idx_events_app ON events(application_id, occurred_at);',
  'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS import_batches (id TEXT PRIMARY KEY, source_hash TEXT, source_text TEXT, count INTEGER, created_at TEXT);',
  'CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);'
].join('\n');

export function openDb(dbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  const row = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('version');
  if (!row) db.prepare('INSERT INTO schema_meta (key, value) VALUES (?, ?)').run('version', '1');
  return db;
}

const COLUMNS = ['id','company','role','channel','job_type','status','closed_reason','applied_at','status_changed_at','test_at','interview_at','deadline_at','next_action','next_action_at','jd_url','jd_text','location','salary','resume_version','priority','tags','notes','source','import_batch_id','created_at','updated_at'];

const EDITABLE = ['company','role','channel','job_type','status','closed_reason','applied_at','test_at','interview_at','deadline_at','next_action','next_action_at','jd_url','jd_text','location','salary','resume_version','priority','tags','notes'];

function rowToApp(row) {
  if (!row) return null;
  let tags = [];
  try { tags = JSON.parse(row.tags || '[]'); } catch (e) { tags = []; }
  return Object.assign({}, row, { tags });
}

export function listApps(db, filters) {
  filters = filters || {};
  const where = [];
  const params = [];
  if (filters.status) { where.push('status = ?'); params.push(filters.status); }
  if (filters.channel) { where.push('channel = ?'); params.push(filters.channel); }
  if (filters.job_type) { where.push('job_type = ?'); params.push(filters.job_type); }
  if (filters.q) {
    where.push('(company LIKE ? OR role LIKE ? OR notes LIKE ?)');
    const q = '%' + filters.q + '%';
    params.push(q, q, q);
  }
  const sql = 'SELECT * FROM applications' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY updated_at DESC';
  return db.prepare(sql).all(...params).map(rowToApp);
}

export function getApp(db, id) {
  return rowToApp(db.prepare('SELECT * FROM applications WHERE id = ?').get(id));
}

export function listEvents(db, appId) {
  return db.prepare('SELECT * FROM events WHERE application_id = ? ORDER BY occurred_at ASC, id ASC').all(appId);
}

export function listAllEvents(db) {
  return db.prepare('SELECT * FROM events ORDER BY occurred_at ASC, id ASC').all();
}

export function addEvent(db, appId, ev) {
  const occurred = ev.occurred_at || nowIso();
  db.prepare('INSERT INTO events (application_id, kind, from_status, to_status, content, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(appId, ev.kind, ev.from_status || null, ev.to_status || null, ev.content || '', occurred, nowIso());
}

export function createApp(db, input, opts) {
  opts = opts || {};
  const id = input.id || crypto.randomUUID();
  const status = STATUS_KEYS.indexOf(input.status) >= 0 ? input.status : 'applied';
  const appliedAt = input.applied_at || null;
  const now = nowIso();
  const row = {
    id: id,
    company: (input.company || '').trim() || '未命名公司',
    role: (input.role || '').trim(),
    channel: CHANNELS.some(c => c.key === input.channel) ? input.channel : 'other',
    job_type: JOB_TYPES.some(t => t.key === input.job_type) ? input.job_type : 'daily',
    status: status,
    closed_reason: input.closed_reason || null,
    applied_at: appliedAt,
    status_changed_at: input.status_changed_at || appliedAt || now,
    test_at: input.test_at || null,
    interview_at: input.interview_at || null,
    deadline_at: input.deadline_at || null,
    next_action: input.next_action || null,
    next_action_at: input.next_action_at || null,
    jd_url: input.jd_url || null,
    jd_text: input.jd_text || null,
    location: input.location || null,
    salary: input.salary || null,
    resume_version: input.resume_version || null,
    priority: PRIORITIES.some(p => p.key === input.priority) ? input.priority : 'normal',
    tags: JSON.stringify(Array.isArray(input.tags) ? input.tags : []),
    notes: input.notes || '',
    source: input.source || (opts.importBatchId ? 'import' : 'manual'),
    import_batch_id: opts.importBatchId || input.import_batch_id || null,
    created_at: input.created_at || now,
    updated_at: now
  };
  const insertSql = 'INSERT INTO applications (' + COLUMNS.join(',') + ') VALUES (' + COLUMNS.map(() => '?').join(',') + ')';
  db.prepare(insertSql).run(...COLUMNS.map(c => row[c]));
  addEvent(db, id, {
    kind: 'status_change',
    from_status: null,
    to_status: status,
    content: opts.importBatchId ? '从笔记导入' : (status === 'wishlist' ? '收藏' : '创建'),
    occurred_at: appliedAt ? appliedAt + 'T09:00:00' : now
  });
  return getApp(db, id);
}

export function updateApp(db, id, patch) {
  const app = getApp(db, id);
  if (!app) return null;
  const sets = [];
  const params = [];
  const now = nowIso();
  let statusChanged = false;
  let fromStatus = app.status;
  for (const key of EDITABLE) {
    if (!(key in patch)) continue;
    let value = patch[key];
    if (key === 'tags') value = JSON.stringify(Array.isArray(value) ? value : []);
    if (key === 'status') {
      if (STATUS_KEYS.indexOf(value) < 0) continue;
      if (value !== app.status) statusChanged = true;
    }
    if (key === 'applied_at' || key === 'test_at' || key === 'interview_at' || key === 'deadline_at' || key === 'next_action_at') {
      value = value || null;
    }
    sets.push(key + ' = ?');
    params.push(value === undefined ? null : value);
  }
  if (statusChanged) {
    sets.push('status_changed_at = ?');
    params.push(now);
    if (patch.status === 'closed' && !patch.closed_reason) {
      sets.push('closed_reason = ?');
      params.push('withdrawn');
    }
    if (patch.status !== 'closed' && !('closed_reason' in patch)) {
      sets.push('closed_reason = ?');
      params.push(null);
    }
  }
  if (!sets.length) return app;
  sets.push('updated_at = ?');
  params.push(now);
  params.push(id);
  db.prepare('UPDATE applications SET ' + sets.join(', ') + ' WHERE id = ?').run(...params);
  if (statusChanged) {
    addEvent(db, id, { kind: 'status_change', from_status: fromStatus, to_status: patch.status, content: patch.status_note || '状态更新', occurred_at: now });
  }
  return getApp(db, id);
}

export function deleteApp(db, id) {
  db.prepare('DELETE FROM events WHERE application_id = ?').run(id);
  const info = db.prepare('DELETE FROM applications WHERE id = ?').run(id);
  return info.changes > 0;
}

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const stored = {};
  for (const r of rows) {
    try { stored[r.key] = JSON.parse(r.value); } catch (e) { stored[r.key] = r.value; }
  }
  return Object.assign({}, DEFAULT_SETTINGS, stored);
}

export function updateSettings(db, patch) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const key of Object.keys(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    stmt.run(key, JSON.stringify(patch[key]));
  }
  return getSettings(db);
}

export function createImportBatch(db, text, count) {
  const id = crypto.randomUUID();
  const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
  db.prepare('INSERT INTO import_batches (id, source_hash, source_text, count, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, hash, text, count, nowIso());
  return { id: id, hash: hash };
}

export function getImportBatch(db, id) {
  return db.prepare('SELECT * FROM import_batches WHERE id = ?').get(id) || null;
}

export function undoImportBatch(db, id) {
  const batch = getImportBatch(db, id);
  if (!batch) return null;
  const apps = db.prepare('SELECT id FROM applications WHERE import_batch_id = ?').all(id);
  for (const a of apps) {
    db.prepare('DELETE FROM events WHERE application_id = ?').run(a.id);
    db.prepare('DELETE FROM applications WHERE id = ?').run(a.id);
  }
  db.prepare('DELETE FROM import_batches WHERE id = ?').run(id);
  return { removed: apps.length };
}

export function counts(db) {
  const total = db.prepare('SELECT COUNT(*) AS n FROM applications').get().n;
  const closed = db.prepare("SELECT COUNT(*) AS n FROM applications WHERE status = 'closed'").get().n;
  const wishlist = db.prepare("SELECT COUNT(*) AS n FROM applications WHERE status = 'wishlist'").get().n;
  const active = total - closed - wishlist;
  const byStatus = {};
  for (const row of db.prepare('SELECT status, COUNT(*) AS n FROM applications GROUP BY status').all()) byStatus[row.status] = row.n;
  return { total: total, active: active, closed: closed, wishlist: wishlist, byStatus: byStatus };
}