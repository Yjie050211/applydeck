import http from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './db.mjs';
import { parseNote, normalizeKey } from './parser.mjs';
import { computeActions } from './reminders.mjs';
import { computeStats } from './stats.mjs';
import { backupDb } from './backup.mjs';
import { buildIcs, icsFilename } from './ics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, '..', 'web');
const VERSION = '0.3.0';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8'
};

function send(res, code, body, headers) {
  const h = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {});
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    res.writeHead(code, h);
    res.end(body);
  } else {
    res.writeHead(code, h);
    res.end(JSON.stringify(body));
  }
}

function sendFile(res, code, body, type, filename) {
  const h = { 'Content-Type': type || 'application/octet-stream', 'Cache-Control': 'no-store' };
  if (filename) h['Content-Disposition'] = 'attachment; filename="' + filename + '"';
  res.writeHead(code, h);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 4 * 1024 * 1024) { reject(new Error('请求体过大（上限 4MB）')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch (e) { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return '"' + s.replace(/"/g, '""') + '"';
}

function buildMarkdown(apps, events) {
  const byApp = new Map();
  for (const e of events) {
    if (!byApp.has(e.application_id)) byApp.set(e.application_id, []);
    byApp.get(e.application_id).push(e);
  }
  const statusLabel = {};
  for (const s of store.STATUSES) statusLabel[s.key] = s.label;
  const lines = [];
  lines.push('# 投递舱 · 导出快照');
  lines.push('');
  lines.push('> 导出时间：' + new Date().toLocaleString('zh-CN'));
  lines.push('> 记录数：' + apps.length);
  lines.push('');
  const groups = {};
  for (const a of apps) {
    if (!groups[a.status]) groups[a.status] = [];
    groups[a.status].push(a);
  }
  for (const st of store.STATUSES) {
    const list = groups[st.key] || [];
    if (!list.length) continue;
    lines.push('## ' + st.label + '（' + list.length + '）');
    lines.push('');
    for (const a of list) {
      lines.push('- **' + a.company + '** · ' + (a.role || '未填岗位') + (a.location ? ' · ' + a.location : '') + (a.applied_at ? ' · ' + a.applied_at : ''));
      const evs = byApp.get(a.id) || [];
      if (evs.length) {
        lines.push('  - 时间线：');
        for (const e of evs) lines.push('    - ' + String(e.occurred_at).slice(0, 10) + ' ' + statusLabel[e.from_status] + '→' + statusLabel[e.to_status] + ' ' + (e.content || ''));
      }
      if (a.notes) lines.push('  - 备注：' + a.notes.replace(/\n/g, ' '));
    }
    lines.push('');
  }
  return lines.join('\n');
}

function labelMap(list) {
  const m = {};
  for (const x of list) m[x.key] = x.label;
  return m;
}

function buildCsv(apps) {
  const statusMap = labelMap(store.STATUSES);
  const channelMap = labelMap(store.CHANNELS);
  const jobTypeMap = labelMap(store.JOB_TYPES);
  const priorityMap = labelMap(store.PRIORITIES);
  const head = ['公司', '岗位', '状态', '渠道', '岗位类型', '投递日期', '地点', '优先级', '下次行动', '备注'];
  const rows = [head.join(',')];
  for (const a of apps) {
    rows.push([
      a.company,
      a.role,
      statusMap[a.status] || a.status,
      channelMap[a.channel] || a.channel,
      jobTypeMap[a.job_type] || a.job_type,
      a.applied_at,
      a.location,
      priorityMap[a.priority] || a.priority,
      a.next_action ? a.next_action + (a.next_action_at ? ' ' + a.next_action_at : '') : a.next_action_at,
      a.notes
    ].map(csvEscape).join(','));
  }
  return '\ufeff' + rows.join('\r\n');
}

export function createAppServer(db, options) {
  options = options || {};
  const dataDir = options.dataDir || path.join(process.cwd(), 'data');
  const backupsDir = path.join(dataDir, 'backups');

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname);
      const method = req.method || 'GET';

      if (method === 'OPTIONS' && pathname.startsWith('/api/')) {
        res.writeHead(204, CORS_HEADERS);
        return res.end();
      }

      if (pathname === '/api/health') {
        return send(res, 200, { ok: true, version: VERSION, now: new Date().toISOString() }, CORS_HEADERS);
      }

      if (pathname.startsWith('/api/')) {
        if (method === 'GET' && pathname === '/api/bootstrap') {
          return send(res, 200, {
            version: VERSION,
            statuses: store.STATUSES,
            closedReasons: store.CLOSED_REASONS,
            channels: store.CHANNELS,
            jobTypes: store.JOB_TYPES,
            priorities: store.PRIORITIES,
            settings: store.getSettings(db),
            counts: store.counts(db)
          });
        }

        if (method === 'GET' && pathname === '/api/apps') {
          const apps = store.listApps(db, {
            status: url.searchParams.get('status') || '',
            channel: url.searchParams.get('channel') || '',
            job_type: url.searchParams.get('job_type') || '',
            q: url.searchParams.get('q') || ''
          });
          return send(res, 200, { apps: apps });
        }

        if (method === 'POST' && pathname === '/api/apps') {
          const body = await readBody(req);
          const app = store.createApp(db, body);
          return send(res, 201, { app: app });
        }

        if (method === 'POST' && pathname === '/api/capture') {
          const body = await readBody(req);
          const company = String(body.company || '').trim();
          if (!company) return send(res, 400, { error: '缺少公司名（company）' });
          const role = String(body.role || '').trim();
          const existing = store.listApps(db, {});
          const key = normalizeKey(company, role);
          const dup = existing.find(a => normalizeKey(a.company, a.role) === key);
          if (dup) return send(res, 200, { ok: true, duplicated: true, app: dup });
          const status = body.status === 'applied' ? 'applied' : 'wishlist';
          const app = store.createApp(db, {
            company: company,
            role: role || null,
            channel: body.channel || 'other',
            job_type: body.job_type || 'daily',
            status: status,
            applied_at: status === 'applied' ? store.todayStr() : null,
            jd_url: body.url || null,
            location: body.location || null,
            salary: body.salary || null,
            priority: body.priority || 'normal',
            notes: body.notes || null,
            source: 'extension'
          });
          return send(res, 201, { ok: true, duplicated: false, app: app }, CORS_HEADERS);
        }

        const appMatch = pathname.match(/^\/api\/apps\/([^/]+)$/);
        if (appMatch) {
          const id = appMatch[1];
          if (method === 'GET') {
            const app = store.getApp(db, id);
            if (!app) return send(res, 404, { error: '记录不存在' });
            return send(res, 200, { app: app, events: store.listEvents(db, id) });
          }
          if (method === 'PATCH') {
            const body = await readBody(req);
            const app = store.updateApp(db, id, body);
            if (!app) return send(res, 404, { error: '记录不存在' });
            return send(res, 200, { app: app, events: store.listEvents(db, id) });
          }
          if (method === 'DELETE') {
            const ok = store.deleteApp(db, id);
            if (!ok) return send(res, 404, { error: '记录不存在' });
            return send(res, 200, { ok: true });
          }
        }

        const eventsMatch = pathname.match(/^\/api\/apps\/([^/]+)\/events$/);
        if (eventsMatch && method === 'POST') {
          const appId = eventsMatch[1];
          if (!store.getApp(db, appId)) return send(res, 404, { error: '记录不存在' });
          const body = await readBody(req);
          store.addEvent(db, appId, {
            kind: body.kind || 'note',
            content: body.content || '',
            occurred_at: body.occurred_at || undefined
          });
          return send(res, 201, { events: store.listEvents(db, appId) });
        }

        if (method === 'GET' && pathname === '/api/today') {
          const settings = store.getSettings(db);
          const apps = store.listApps(db, {});
          const events = store.listAllEvents(db);
          const byApp = new Map();
          for (const e of events) {
            if (!byApp.has(e.application_id)) byApp.set(e.application_id, []);
            byApp.get(e.application_id).push(e);
          }
          const actions = [];
          for (const a of apps) actions.push.apply(actions, computeActions(a, byApp.get(a.id) || [], settings));
          actions.sort((x, y) => (x.due < y.due ? -1 : x.due > y.due ? 1 : 0));
          const summary = {
            overdue: actions.filter(a => a.severity === 'overdue').length,
            today: actions.filter(a => a.severity === 'today').length,
            soon: actions.filter(a => a.severity === 'soon').length
          };
          return send(res, 200, { actions: actions, summary: summary, date: store.todayStr() });
        }

        if (method === 'POST' && pathname === '/api/today/complete') {
          const body = await readBody(req);
          const app = store.getApp(db, body.appId);
          if (!app) return send(res, 404, { error: '记录不存在' });
          const today = store.todayStr();
          const kind = body.kind;
          const action = body.action || 'complete';
          const now = new Date().toISOString();
          if (kind === 'wishlist_stale' && action === 'complete') {
            store.updateApp(db, app.id, { status: 'applied', applied_at: today });
          } else if (kind === 'judge_cold' && action === 'complete') {
            store.updateApp(db, app.id, { status: 'closed', closed_reason: 'ghosted' });
          } else if (action === 'open') {
            store.addEvent(db, app.id, { kind: 'snooze', content: '稍后再看（' + kind + '）', occurred_at: now });
          } else {
            store.addEvent(db, app.id, { kind: kind, content: body.note || '从今日待办完成', occurred_at: now });
            if (kind === 'follow_up') store.updateApp(db, app.id, { next_action: null, next_action_at: null });
          }
          return send(res, 200, { ok: true, today: [] });
        }

        if (method === 'GET' && pathname === '/api/stats') {
          const apps = store.listApps(db, {});
          const events = store.listAllEvents(db);
          return send(res, 200, { stats: computeStats(apps, events) });
        }

        if (method === 'POST' && pathname === '/api/import/preview') {
          const body = await readBody(req);
          const year = Number(body.year) || store.getSettings(db).importYear || new Date().getFullYear();
          const parsed = parseNote(body.text || '', { year: year });
          const existing = store.listApps(db, {});
          const seen = new Set(existing.map(a => normalizeKey(a.company, a.role)));
          const duplicates = parsed.records.filter(r => seen.has(normalizeKey(r.company, r.role))).map(r => r.company + ' · ' + r.role);
          return send(res, 200, { records: parsed.records, warnings: parsed.warnings, stats: parsed.stats, duplicates: duplicates, existingCount: existing.length });
        }

        if (method === 'POST' && pathname === '/api/import/commit') {
          const body = await readBody(req);
          const year = Number(body.year) || store.getSettings(db).importYear || new Date().getFullYear();
          const parsed = parseNote(body.text || '', { year: year });
          const records = Array.isArray(body.records) ? body.records : parsed.records;
          const batch = store.createImportBatch(db, body.text || '', records.length);
          const existing = store.listApps(db, {});
          const seen = new Set(existing.map(a => normalizeKey(a.company, a.role)));
          const created = [];
          const skipped = [];
          for (const r of records) {
            const key = normalizeKey(r.company, r.role);
            if (seen.has(key) || r.duplicateInFile) { skipped.push(r.company + ' · ' + r.role); continue; }
            seen.add(key);
            const app = store.createApp(db, {
              company: r.company,
              role: r.role,
              channel: r.channel,
              job_type: r.job_type,
              status: r.status,
              applied_at: r.applied_at || (r.status === 'wishlist' ? null : store.todayStr()),
              location: r.location,
              priority: r.priority,
              source: 'import'
            }, { importBatchId: batch.id });
            if (r.applied_at) store.addEvent(db, app.id, { kind: 'applied', content: '从笔记导入（投递日 ' + r.applied_at + '）', occurred_at: r.applied_at + 'T09:00:00' });
            created.push(app);
          }
          return send(res, 200, { batchId: batch.id, created: created.length, skipped: skipped, apps: created });
        }

        if (method === 'POST' && pathname === '/api/import/undo') {
          const body = await readBody(req);
          if (!body.batchId) return send(res, 400, { error: '缺少 batchId' });
          const result = store.undoImportBatch(db, body.batchId);
          if (!result) return send(res, 404, { error: '导入批次不存在' });
          return send(res, 200, result);
        }

        if (method === 'GET' && pathname === '/api/export/md') {
          const md = buildMarkdown(store.listApps(db, {}), store.listAllEvents(db));
          if (url.searchParams.get('download') === '1') return sendFile(res, 200, md, 'text/markdown; charset=utf-8', 'applydeck-snapshot.md');
          return send(res, 200, { markdown: md });
        }

        if (method === 'GET' && pathname === '/api/export/csv') {
          return sendFile(res, 200, buildCsv(store.listApps(db, {})), 'text/csv; charset=utf-8', 'applydeck-applications.csv');
        }

        if (method === 'GET' && pathname === '/api/export/ics') {
          const settings = store.getSettings(db);
          const built = buildIcs(store.listApps(db, {}), store.listAllEvents(db), settings, { version: VERSION, now: new Date() });
          const filename = icsFilename(store.todayStr());
          if (url.searchParams.get('download') === '1') return sendFile(res, 200, built.text, 'text/calendar; charset=utf-8', filename);
          return send(res, 200, { filename: filename, count: built.count, events: built.events, ics: built.text }, CORS_HEADERS);
        }

        if (method === 'GET' && pathname === '/api/export/json') {
          const payload = {
            app: 'applydeck', version: VERSION, exported_at: new Date().toISOString(),
            applications: store.listApps(db, {}), events: store.listAllEvents(db)
          };
          return sendFile(res, 200, JSON.stringify(payload, null, 2), 'application/json; charset=utf-8', 'applydeck-backup.json');
        }

        if (method === 'POST' && pathname === '/api/export/obsidian') {
          const body = await readBody(req);
          const settings = store.getSettings(db);
          let dir = (body.dir || settings.obsidianDir || '').trim();
          if (!dir) return send(res, 400, { error: '请先在设置里填写 Obsidian 目录' });
          try {
            mkdirSync(dir, { recursive: true });
            const file = path.join(dir, 'ApplyDeck-' + store.todayStr() + '.md');
            writeFileSync(file, buildMarkdown(store.listApps(db, {}), store.listAllEvents(db)), 'utf8');
            return send(res, 200, { ok: true, file: file });
          } catch (e) {
            return send(res, 500, { error: '写入失败：' + e.message });
          }
        }

        if (method === 'POST' && pathname === '/api/backup') {
          try {
            const result = backupDb(db, backupsDir);
            return send(res, 200, result);
          } catch (e) {
            return send(res, 500, { error: '备份失败：' + e.message });
          }
        }

        if (method === 'GET' && pathname === '/api/settings') {
          return send(res, 200, { settings: store.getSettings(db) });
        }

        if (method === 'PATCH' && pathname === '/api/settings') {
          const body = await readBody(req);
          const patch = body && typeof body === 'object' ? Object.assign({}, body) : {};
          // theme 只接受三个合法值，其它值忽略（避免脏数据把界面卡在未知主题）
          if (patch.theme !== undefined && ['light', 'dark', 'system'].indexOf(patch.theme) < 0) delete patch.theme;
          return send(res, 200, { settings: store.updateSettings(db, patch) });
        }

        if (method === 'GET' && pathname === '/api/seed-note') {
          const p = path.join(__dirname, '..', 'seeds', 'my-note.md');
          if (!existsSync(p)) return send(res, 404, { error: '示例笔记不存在' });
          return send(res, 200, { text: readFileSync(p, 'utf8') });
        }

        return send(res, 404, { error: '接口不存在' });
      }

      let filePath = path.join(WEB_DIR, pathname === '/' ? 'index.html' : pathname);
      if (!filePath.startsWith(WEB_DIR)) return send(res, 403, { error: '禁止访问' });
      if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = path.join(WEB_DIR, 'index.html');
      const ext = path.extname(filePath).toLowerCase();
      const content = readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    } catch (e) {
      send(res, 500, { error: e && e.message ? e.message : String(e) });
    }
  });

  return server;
}
