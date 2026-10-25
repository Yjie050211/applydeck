import { readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, createApp, listApps, counts, todayStr } from '../server/db.mjs';
import { parseNote, normalizeKey } from '../server/parser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const DB = path.join(DATA, 'applydeck.db');

const raw = readFileSync(path.join(ROOT, 'seeds', 'my-note.md'), 'utf8');
const parsed = parseNote(raw, { year: 2026 });

if (process.argv.includes('--reset')) {
  for (const f of ['applydeck.db', 'applydeck.db-wal', 'applydeck.db-shm']) {
    const p = path.join(DATA, f);
    if (existsSync(p)) rmSync(p);
  }
}

const db = openDb(DB);
const existing = new Set(listApps(db, {}).map(a => normalizeKey(a.company, a.role)));
let created = 0;
for (const r of parsed.records) {
  const key = normalizeKey(r.company, r.role);
  if (existing.has(key)) continue;
  existing.add(key);
  createApp(db, {
    company: r.company,
    role: r.role,
    channel: r.channel,
    job_type: r.job_type,
    status: r.status,
    applied_at: r.applied_at || (r.status === 'wishlist' ? null : todayStr()),
    location: r.location,
    priority: r.priority || 'normal',
    source: 'import'
  });
  created += 1;
}
console.log('created', created, 'of', parsed.records.length);
console.log('counts', JSON.stringify(counts(db)));
db.close();
