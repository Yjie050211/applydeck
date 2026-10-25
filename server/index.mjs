#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import http from 'node:http';
import { openDb } from './db.mjs';
import { createAppServer } from './app.mjs';
import { listLanUrls, isLanHost } from './lan.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');

function parseArgs(argv) {
  const out = { port: null, host: null, dataDir: null, open: true, config: null, lan: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--host') out.host = argv[++i];
    else if (a === '--data') out.dataDir = argv[++i];
    else if (a === '--no-open') out.open = false;
    else if (a === '--lan') out.lan = true;
    else if (a === '--config') out.config = argv[++i];
  }
  return out;
}

function loadConfig(explicit) {
  const candidates = [explicit, path.join(PROJECT_ROOT, 'config.json')].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) {
      try { return JSON.parse(readFileSync(c, 'utf8')); } catch (e) { console.error('[warn] config.json 解析失败：' + e.message); return {}; }
    }
  }
  return {};
}

function probe(url) {
  return new Promise((resolve) => {
    const req = http.get(url + '/api/health', { timeout: 1200 }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve(res.statusCode === 200 && text.includes('applydeck'.slice(0, 3))));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args.config);
  const port = args.port || Number(config.port) || Number(process.env.APPLYDECK_PORT) || 8788;
  const lanMode = args.lan || config.lan === true || process.env.APPLYDECK_LAN === '1';
  const host = args.host || (lanMode ? '0.0.0.0' : (config.host || '127.0.0.1'));
  const dataDir = args.dataDir || config.dataDir || path.join(PROJECT_ROOT, 'data');
  const dbPath = path.join(dataDir, 'applydeck.db');
  const url = 'http://' + (host === '0.0.0.0' ? '127.0.0.1' : host) + ':' + port;

  if (await probe(url)) {
    console.log('[ok] ApplyDeck 已经在运行：' + url);
    if (args.open && process.platform === 'win32') exec('start "" "' + url + '"');
    return;
  }

  mkdirSync(dataDir, { recursive: true });
  const db = openDb(dbPath);
  const server = createAppServer(db, { dataDir: dataDir });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('[error] 端口 ' + port + ' 已被占用。换一个端口：node server/index.mjs --port 8789');
    } else {
      console.error('[error] ' + err.message);
    }
    process.exit(1);
  });

  server.listen(port, host, () => {
    const pidFile = path.join(dataDir, 'server.pid');
    writeFileSync(pidFile, String(process.pid), 'utf8');
    console.log('');
    console.log('  ==================================================');
    console.log('   投递舱 ApplyDeck v0.3.0');
    console.log('   ' + url);
    console.log('   数据目录：' + dataDir);
    console.log('   关闭窗口或 Ctrl+C 即可停止服务');
    console.log('  ==================================================');
    console.log('');
    if (isLanHost(host)) {
      const lanUrls = listLanUrls(port);
      if (lanUrls.length) {
        console.log('   [局域网访问] 手机连同一个 Wi-Fi，打开：');
        for (const item of lanUrls) console.log('     ' + item.url + '   (' + item.iface + ')');
        console.log('   注意：同一网络内的人都能访问，用完记得关服务。');
        console.log('');
      } else {
        console.log('   [局域网访问] 没有找到可用的局域网 IP，请检查网络。');
        console.log('');
      }
    }
    if (args.open && process.platform === 'win32') exec('start "" "' + url + '"');
  });

  const shutdown = () => {
    server.close(() => { try { db.close(); } catch (e) {} process.exit(0); });
    const pidFile = path.join(dataDir, 'server.pid');
    try { if (existsSync(pidFile)) unlinkSync(pidFile); } catch (e) {}
    setTimeout(() => process.exit(0), 1500);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => { console.error('[fatal] ' + (e && e.stack ? e.stack : e)); process.exit(1); });
