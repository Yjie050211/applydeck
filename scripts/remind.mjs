#!/usr/bin/env node
/**
 * ApplyDeck 每日提醒（Windows 任务计划程序调用，每天 09:30）
 *
 * 流程：GET /api/today -> 组装中文通知 -> 弹 Windows Toast（Windows PowerShell 5.1 + WinRT）。
 *
 * 约束：
 *   - 零 npm 依赖，只用 Node 标准库（Node >= 22）。
 *   - 任何失败都 exit 0：服务没开是常态，计划任务不能弹错误窗口。
 *   - 整体 15 秒内必须结束（看门狗兜底）。
 *
 * 用法：
 *   node scripts/remind.mjs                   按 config.json 的 host/port 找服务并弹通知
 *   node scripts/remind.mjs --dry-run         只打印标题/正文，不弹窗（测试用）
 *   node scripts/remind.mjs --url http://127.0.0.1:8788
 *   node scripts/remind.mjs --quiet           成功时不打印 "toast shown: ..."
 */

import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config.json');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const LOG_PATH = path.join(DATA_DIR, 'reminder-last.log');

const HTTP_TIMEOUT_MS = 2000;   // 服务没开 / 卡住时立刻放弃
const TOAST_TIMEOUT_MS = 8000;  // PowerShell 卡住也不拖死计划任务
const HARD_LIMIT_MS = 15000;    // 整个脚本最长存活时间
const TOAST_APP_ID = 'ApplyDeck';
const TOAST_OK_MARKER = 'APPLYDECK_TOAST_OK';

// kind -> 中文动作名（action.title 缺失时兜底；正常由 reminders.mjs 提供 title）
const KIND_LABELS = Object.freeze({
  follow_up: '发跟进',
  judge_cold: '判断无回复',
  wishlist_stale: '还投吗',
  thanks: '发感谢信',
  review: '写复盘',
  test_prep: '准备笔试',
  interview_prep: '准备面试',
  offer_deadline: 'Offer 决定'
});

const HELP_TEXT = [
  'ApplyDeck 每日提醒',
  '',
  '用法：node scripts/remind.mjs [--url <base>] [--dry-run] [--quiet]',
  '',
  '  --url <base>   服务地址，默认从 config.json 的 host/port 拼接',
  '  --dry-run      只打印将要通知的标题/正文，不弹窗',
  '  --quiet        成功时不打印 "toast shown: ..."',
  '',
  '退出码恒为 0（供 Windows 任务计划程序使用）。',
  ''
].join('\n');

class HttpError extends Error {
  constructor(status) {
    super('HTTP ' + status);
    this.name = 'HttpError';
    this.status = status;
  }
}

function parseArgs(argv) {
  const options = { url: '', dryRun: false, quiet: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--url') {
      options.url = argv[index + 1] || '';
      index += 1;
    } else if (arg.indexOf('--url=') === 0) {
      options.url = arg.slice('--url='.length);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--quiet') {
      options.quiet = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }
  return options;
}

function loadConfig() {
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return config && typeof config === 'object' ? config : {};
  } catch (error) {
    return {};
  }
}

function resolveBaseUrl(explicitUrl) {
  if (explicitUrl) return explicitUrl.replace(/\/+$/, '');
  const config = loadConfig();
  const host = typeof config.host === 'string' && config.host.trim() ? config.host.trim() : '127.0.0.1';
  // config.json 没写 port 时，与 server/index.mjs 的默认端口保持一致（不在代码里写死 URL）
  const port = Number(config.port) || 8788;
  const targetHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  return 'http://' + targetHost + ':' + port;
}

async function fetchToday(baseUrl) {
  const url = baseUrl.replace(/\/+$/, '') + '/api/today';
  const response = await fetch(url, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    headers: { accept: 'application/json' }
  });
  if (!response.ok) throw new HttpError(response.status);
  return await response.json();
}

function severityLabel(severity) {
  if (severity === 'overdue') return '逾期';
  if (severity === 'today') return '今天';
  return '即将';
}

function actionLabel(action) {
  if (action && typeof action.title === 'string' && action.title.trim()) return action.title.trim();
  const kind = action && action.kind;
  if (kind && KIND_LABELS[kind]) return KIND_LABELS[kind];
  return kind ? String(kind) : '待办';
}

// /api/today 的返回 -> { title, bodyLines }
function buildMessage(today) {
  const actions = today && Array.isArray(today.actions) ? today.actions : [];
  const summary = today && today.summary && typeof today.summary === 'object' ? today.summary : {};

  if (actions.length === 0) {
    return { title: '投递舱 · 今天没有待办', bodyLines: ['放心去写代码吧。'] };
  }

  const summaryOverdue = Number(summary.overdue);
  const overdue = Number.isFinite(summaryOverdue) && summaryOverdue > 0
    ? summaryOverdue
    : actions.filter((action) => action && action.severity === 'overdue').length;

  let title = '投递舱 · 今天 ' + actions.length + ' 件事';
  if (overdue > 0) title += '（逾期 ' + overdue + '）';

  const bodyLines = actions.slice(0, 3).map((action) => {
    const company = action && action.company ? String(action.company) : '未填公司';
    const role = action && action.role ? String(action.role) : '未填岗位';
    const when = severityLabel(action && action.severity);
    return company + ' · ' + role + '｜' + actionLabel(action) + '（' + when + '）';
  });
  if (actions.length > 3) bodyLines.push('…等 ' + actions.length + ' 条');

  return { title: title, bodyLines: bodyLines };
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildToastXml(title, bodyLines) {
  const texts = [title].concat(bodyLines)
    .map((line) => '<text>' + escapeXml(line) + '</text>')
    .join('');
  return '<toast><visual><binding template="ToastGeneric">' + texts + '</binding></visual></toast>';
}

function quotePowerShell(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

// 用 -EncodedCommand（UTF-16LE base64）传入，避开 Windows PowerShell 的 UTF-8 命令行乱码问题
function buildToastScript(xml) {
  return [
    "$ProgressPreference = 'SilentlyContinue'",
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'try {',
    '  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
    '  $xmlDoc = New-Object Windows.Data.Xml.Dom.XmlDocument',
    '  $xmlDoc.LoadXml(' + quotePowerShell(xml) + ')',
    '  $toast = New-Object Windows.UI.Notifications.ToastNotification $xmlDoc',
    '  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(' + quotePowerShell(TOAST_APP_ID) + ').Show($toast)',
    "  Write-Output '" + TOAST_OK_MARKER + "'",
    '} catch {',
    "  [Console]::Error.WriteLine('APPLYDECK_TOAST_FAILED: ' + $_.Exception.Message)",
    '  exit 1',
    '}'
  ].join('\r\n');
}

// PowerShell 的 stderr 可能混着 CLIXML 进度垃圾，只取真正有用的那行
function cleanFailureMessage(text) {
  const rows = String(text || '').split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  for (const row of rows) {
    const marker = row.indexOf('APPLYDECK_TOAST_FAILED');
    if (marker >= 0) {
      return row.slice(marker + 'APPLYDECK_TOAST_FAILED'.length).replace(/^[:：]\s*/, '').slice(0, 300);
    }
  }
  for (const row of rows) {
    if (row.indexOf('#< CLIXML') === 0 || row.indexOf('<Objs') === 0 || row.indexOf('</Objs') === 0) continue;
    return row.slice(0, 300);
  }
  return '';
}

function showToast(title, bodyLines) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, reason: '非 Windows 平台' });
      return;
    }

    let child = null;
    try {
      const script = buildToastScript(buildToastXml(title, bodyLines));
      const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
      child = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-WindowStyle', 'Hidden',
        '-EncodedCommand', encodedCommand
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, reason: '无法启动 PowerShell: ' + (error && error.message ? error.message : String(error)) });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    timer = setTimeout(() => {
      try { child.kill(); } catch (error) {}
      finish({ ok: false, reason: 'PowerShell 超时' });
    }, TOAST_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { if (stderr.length < 4000) stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
      finish({ ok: false, reason: '无法启动 PowerShell: ' + (error && error.message ? error.message : String(error)) });
    });
    child.on('close', (code) => {
      if (code === 0 && stdout.indexOf(TOAST_OK_MARKER) >= 0) {
        finish({ ok: true });
        return;
      }
      const detail = cleanFailureMessage(stderr) || cleanFailureMessage(stdout);
      finish({ ok: false, reason: 'PowerShell 退出码 ' + code + (detail ? '：' + detail : '') });
    });
  });
}

// Toast 弹不出来时：stdout 输出同样内容，并追加到 data/reminder-last.log
function emitFallback(title, bodyLines, reason) {
  const lines = [title].concat(bodyLines);
  process.stdout.write(lines.join('\n') + '\n');
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(
      LOG_PATH,
      '[' + new Date().toISOString() + '] toast 不可用（' + reason + '），已回退 stdout\n' + lines.join('\n') + '\n\n',
      'utf8'
    );
  } catch (error) {
    // 日志写不进去也不能影响计划任务
  }
}

function finish(code) {
  process.exitCode = code;
  // 给 stdout 一点落盘时间，再兜底退出
  setTimeout(() => process.exit(code), 100);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP_TEXT);
    return finish(0);
  }

  let today = null;
  try {
    today = await fetchToday(resolveBaseUrl(options.url));
  } catch (error) {
    if (error instanceof HttpError) {
      process.stderr.write('[applydeck-reminder] /api/today 返回 HTTP ' + error.status + '，跳过本次提醒\n');
    }
    // 连接失败 / 超时 / 返回非 JSON：静默退出（服务没开是常态）
    return finish(0);
  }

  const message = buildMessage(today);

  if (options.dryRun) {
    process.stdout.write('title: ' + message.title + '\n');
    process.stdout.write('body:\n');
    for (const line of message.bodyLines) process.stdout.write(line + '\n');
    return finish(0);
  }

  const toast = await showToast(message.title, message.bodyLines);
  if (toast.ok) {
    if (!options.quiet) process.stdout.write('toast shown: ' + message.title + '\n');
    return finish(0);
  }

  emitFallback(message.title, message.bodyLines, toast.reason);
  return finish(0);
}

// 看门狗：无论卡在 HTTP 还是 PowerShell，最长 15 秒后强制结束（unref 不阻止正常退出）
const hardLimit = setTimeout(() => process.exit(0), HARD_LIMIT_MS);
hardLimit.unref();

main().catch((error) => {
  // 兜底：计划任务只关心「不能报错」，异常也吞掉，最多打一行 stderr
  try {
    const message = error && error.stack ? String(error.stack).split('\n')[0] : String(error);
    process.stderr.write('[applydeck-reminder] ' + message + '\n');
  } catch (ignored) {}
  finish(0);
});
