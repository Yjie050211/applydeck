import { existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import path from 'node:path';

export function backupDb(db, backupsDir, keep) {
  keep = keep || 10;
  mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const name = 'applydeck-' + stamp.getFullYear() + pad(stamp.getMonth() + 1) + pad(stamp.getDate()) + '-' + pad(stamp.getHours()) + pad(stamp.getMinutes()) + pad(stamp.getSeconds()) + '.db';
  const target = path.join(backupsDir, name);
  const escaped = target.replace(/'/g, "''");
  db.exec("VACUUM INTO '" + escaped + "'");
  const files = readdirSync(backupsDir).filter(f => f.endsWith('.db')).map(f => {
    const p = path.join(backupsDir, f);
    return { name: f, path: p, mtime: statSync(p).mtimeMs };
  }).sort((a, b) => b.mtime - a.mtime);
  const removed = [];
  for (const f of files.slice(keep)) {
    try { unlinkSync(f.path); removed.push(f.name); } catch (e) {}
  }
  return { ok: true, file: target, size: existsSync(target) ? statSync(target).size : 0, removed: removed };
}
