import { readFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, todayStr, listApps, listAllEvents, getSettings } from '../server/db.mjs';
import { parseNote } from '../server/parser.mjs';
import { computeActions } from '../server/reminders.mjs';
import { computeStats } from '../server/stats.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const tmpDir = path.join(root, 'data', 'tmp-test');
const dbPath = path.join(tmpDir, 'test.db');
for (const f of ['test.db', 'test.db-wal', 'test.db-shm']) {
  const p = path.join(tmpDir, f);
  if (existsSync(p)) rmSync(p);
}

const note = readFileSync(path.join(root, 'seeds', 'my-note.md'), 'utf8');
const parsed = parseNote(note, { year: 2026 });
console.log('parsed records:', parsed.records.length, 'warnings:', parsed.warnings.length);
for (const r of parsed.records) {
  console.log(' -', r.status, '|', r.channel, '|', r.company, '|', r.role, '|', r.applied_at || '-', '|', r.location || '-');
}
if (parsed.warnings.length) console.log('warnings:', JSON.stringify(parsed.warnings, null, 1));

const db = openDb(dbPath);
let n = 0;
for (const r of parsed.records) {
  const c = await import('../server/db.mjs').then(m => m.createApp(db, {
    company: r.company, role: r.role, channel: r.channel, job_type: r.job_type,
    status: r.status, applied_at: r.applied_at, location: r.location, priority: r.priority
  }));
  n++;
}
console.log('inserted:', n, 'counts:', JSON.stringify((await import('../server/db.mjs')).counts(db)));
console.log('today:', todayStr());
const apps = listApps(db, {});
const events = listAllEvents(db);
const settings = getSettings(db);
const actions = [];
for (const a of apps) actions.push(...computeActions(a, events.filter(e => e.application_id === a.id), settings));
console.log('actions:', actions.length, JSON.stringify(actions.map(a => [a.kind, a.company, a.role, a.due, a.severity]), null, 0));
console.log('stats:', JSON.stringify(computeStats(apps, events), null, 1).slice(0, 1200));
db.close();
