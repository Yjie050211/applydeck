import { state, loadMeta } from '../store.js';
import { esc, toast } from '../ui.js';
import { patch, post } from '../api.js';
import { THEME_MODES, applyTheme, themeMode } from '../theme.js';

const THEME_ICON = {
  light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4.1"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6"/></svg>',
  dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5a8.7 8.7 0 1 0 10.7 10.7z"/></svg>',
  system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.8" y="4" width="18.4" height="12.4" rx="1.8"/><path d="M8.6 20h6.8M12 16.4V20"/></svg>'
};

export async function renderSettings(view, refresh) {
  await loadMeta();
  const s = state.meta.settings;
  const themeCards = THEME_MODES.map(function (m) {
    const active = themeMode() === m.key;
    return '<button class="theme-opt' + (active ? ' active' : '') + '" data-theme-option="' + m.key + '" role="radio" aria-checked="' + (active ? 'true' : 'false') + '">'
      + '<span class="theme-opt-ico">' + THEME_ICON[m.key] + '</span>'
      + '<span class="theme-opt-txt"><b>' + m.label + '</b><span>' + m.desc + '</span></span>'
      + '</button>';
  }).join('');
  view.innerHTML = '<div class="settings-grid">'
    + '<div class="panel">'
    + '<div class="section-head"><h2>提醒阈值</h2><span>按你的节奏微调，默认值来自实习复盘</span></div>'
    + '<div class="form-grid">'
    + '<div class="field"><label>跟进间隔（工作日）</label><input id="s-follow" type="number" min="1" max="15" value="' + s.followUpDays + '" /></div>'
    + '<div class="field"><label>日常实习判冷（天）</label><input id="s-daily" type="number" min="3" max="60" value="' + s.staleDaily + '" /></div>'
    + '<div class="field"><label>暑期实习判冷（天）</label><input id="s-summer" type="number" min="3" max="90" value="' + s.staleSummer + '" /></div>'
    + '<div class="field"><label>秋招判冷（天）</label><input id="s-autumn" type="number" min="3" max="120" value="' + s.staleAutumn + '" /></div>'
    + '<div class="field"><label>待投递提醒（天）</label><input id="s-wish" type="number" min="1" max="60" value="' + s.wishlistStaleDays + '" /></div>'
    + '<div class="field"><label>导入默认年份</label><input id="s-year" type="number" min="2000" max="2100" value="' + s.importYear + '" /></div>'
    + '</div>'
    + '<div style="margin-top:14px"><button class="btn primary" id="s-save">保存设置</button></div>'
    + '</div>'
    + '<div class="panel">'
    + '<div class="section-head"><h2>备份与导出</h2><span>你的数据永远在本机</span></div>'
    + '<div class="field" style="margin-bottom:12px"><label>Obsidian 导出目录（可选）</label><input id="s-obsidian" value="' + esc(s.obsidianDir || '') + '" placeholder="例如：C:\\Users\\you\\Obsidian\\投递记录" /></div>'
    + '<div class="export-row">'
    + '<button class="btn" id="btn-obsidian">导出到 Obsidian</button>'
    + '<button class="btn" id="btn-backup">立即备份数据库</button>'
    + '<a class="btn ghost" href="/api/export/md?download=1">下载 Markdown</a>'
    + '<a class="btn ghost" href="/api/export/csv">下载 CSV</a>'
    + '<a class="btn ghost" href="/api/export/json">下载 JSON</a>'
    + '<a class="btn ghost" href="/api/export/ics?download=1">下载日历 .ics</a>'
    + '</div>'
    + '<div class="hint-box" style="margin-top:12px">备份用 SQLite 的 VACUUM INTO 生成一致性快照，自动保留最近 10 份，位置：data/backups/。'
    + 'Markdown 是单向下游产物：app 是唯一真相源，md 用于 Obsidian 浏览和归档。</div>'
    + '</div>'
    + '<div class="panel">'
    + '<div class="section-head"><h2>外观</h2><span>微软 Fluent 风格 · 明暗两套令牌</span></div>'
    + '<div class="theme-options" role="radiogroup" aria-label="外观主题">' + themeCards + '</div>'
    + '<div class="hint-box" style="margin-top:12px">选择会立即生效，并同时记住在浏览器和本地数据库里。'
    + '「跟随系统」时自动读取 Windows 的明暗设置，系统切换时页面跟着变。</div>'
    + '</div>'
    + '<div class="panel">'
    + '<div class="section-head"><h2>关于</h2><span>投递舱 ApplyDeck v0.3.0</span></div>'
    + '<div class="hint-box">本地优先的单人投递追踪台：Node 内置 http + node:sqlite，零 npm 依赖，端口 8788，数据只存在 data/applydeck.db。'
    + '<br>停止服务：关闭启动窗口，或运行 stop.bat。'
    + '<br>界面：Windows 11 Fluent 设计语言，浅色 / 深色 / 跟随系统三种主题，状态色随主题自适应。'
    + '<br>设计取舍：只保留 6 个固定状态，避免状态机发散；指标全部来自事件历史，改状态不篡改过去；不做好友排行榜、不做好运签、不做 streak——追踪工具不该制造焦虑。</div>'
    + '</div>'
    + '</div>';

  document.querySelectorAll('[data-theme-option]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      const key = btn.getAttribute('data-theme-option');
      applyTheme(key);
      if (state.meta && state.meta.settings) state.meta.settings.theme = key;
      try { await patch('/api/settings', { theme: key }); } catch (e) {}
      toast('外观已切换为「' + (THEME_MODES.find(function (m) { return m.key === key; }) || {}).label + '」');
    });
  });

  document.getElementById('s-save').addEventListener('click', async function () {
    try {
      await patch('/api/settings', {
        followUpDays: Number(document.getElementById('s-follow').value) || 3,
        staleDaily: Number(document.getElementById('s-daily').value) || 7,
        staleSummer: Number(document.getElementById('s-summer').value) || 14,
        staleAutumn: Number(document.getElementById('s-autumn').value) || 21,
        wishlistStaleDays: Number(document.getElementById('s-wish').value) || 7,
        importYear: Number(document.getElementById('s-year').value) || 2026,
        obsidianDir: document.getElementById('s-obsidian').value.trim(),
        theme: themeMode()
      });
      toast('设置已保存');
      await loadMeta();
      await refresh();
    } catch (e) { toast(e.message, true); }
  });
  document.getElementById('btn-obsidian').addEventListener('click', async function () {
    const dir = document.getElementById('s-obsidian').value.trim();
    try {
      const res = await post('/api/export/obsidian', { dir: dir });
      toast('已写入：' + res.file);
    } catch (e) { toast(e.message, true); }
  });
  document.getElementById('btn-backup').addEventListener('click', async function () {
    try {
      const res = await post('/api/backup', {});
      toast('备份完成：' + res.file.split(/[\\/]/).pop() + '（' + Math.round(res.size / 1024) + ' KB）');
    } catch (e) { toast(e.message, true); }
  });
}
