import { state } from '../store.js';
import { esc, toast, loadingState } from '../ui.js';
import { get, post } from '../api.js';

let preview = null;
let previewText = '';

const STATUS_OPTS = [['wishlist', '待投递'], ['applied', '已投递'], ['test', '笔试'], ['interview', '面试'], ['offer', 'Offer'], ['closed', '已关闭']];
const CHANNEL_OPTS = [['official', '官网'], ['boss', 'BOSS直聘'], ['shixiseng', '实习僧'], ['nowcoder', '牛客'], ['referral', '内推'], ['other', '其他']];

function optList(list, value) {
  return list.map(function (pair) {
    return '<option value="' + pair[0] + '"' + (value === pair[0] ? ' selected' : '') + '>' + pair[1] + '</option>';
  }).join('');
}

function renderPreview(host, refresh) {
  if (!preview) { host.innerHTML = ''; return; }
  const warnings = (preview.warnings || []).map(function (w) {
    return '<div>第 ' + w.line + ' 行「' + esc(w.text) + '」：' + esc(w.reason) + '</div>';
  }).join('');
  const dup = (preview.duplicates || []).length ? '<div class="warn-box">数据库里已存在 ' + preview.duplicates.length + ' 条相同公司+岗位，提交时自动跳过：<br>' + preview.duplicates.map(esc).join('、') + '</div>' : '';
  const rows = preview.records.map(function (r, idx) {
    return '<div class="preview-row" data-idx="' + idx + '">'
      + '<input data-field="company" value="' + esc(r.company) + '" />'
      + '<input data-field="role" value="' + esc(r.role) + '" placeholder="岗位（可空）" />'
      + '<select data-field="status">' + optList(STATUS_OPTS, r.status) + '</select>'
      + '<select data-field="channel">' + optList(CHANNEL_OPTS, r.channel) + '</select>'
      + '<span class="tiny muted" style="text-align:right">' + esc(r.applied_at || '') + '</span>'
      + '</div>';
  }).join('');
  const total = preview.records.length;
  host.innerHTML = '<div class="panel" style="margin-top:16px">'
    + '<div class="section-head"><h2>预览（' + total + ' 条）</h2><span>可以直接改，改完再提交</span></div>'
    + (dup || '')
    + (warnings ? '<div class="warn-box">解析提示：' + warnings + '</div>' : '')
    + '<div class="preview-row preview-head"><span>公司</span><span>岗位</span><span>状态</span><span>渠道</span><span>投递日</span></div>'
    + rows
    + '<div style="display:flex;gap:8px;margin-top:14px">'
    + '<button class="btn primary" id="btn-commit">确认导入 ' + total + ' 条</button>'
    + '<button class="btn ghost" id="btn-cancel">取消</button>'
    + '</div></div>';
  document.getElementById('btn-cancel').addEventListener('click', function () { preview = null; host.innerHTML = ''; });
  document.getElementById('btn-commit').addEventListener('click', async function () {
    const records = preview.records.map(function (r, idx) {
      const row = host.querySelector('[data-idx="' + idx + '"]');
      return Object.assign({}, r, {
        company: row.querySelector('[data-field="company"]').value.trim(),
        role: row.querySelector('[data-field="role"]').value.trim(),
        status: row.querySelector('[data-field="status"]').value,
        channel: row.querySelector('[data-field="channel"]').value
      });
    });
    try {
      const res = await post('/api/import/commit', { text: previewText, year: Number(document.getElementById('import-year').value) || 2026, records: records });
      state.lastImportBatch = res.batchId;
      localStorage.setItem('applydeck:lastBatch', res.batchId);
      toast('已导入 ' + res.created + ' 条' + (res.skipped && res.skipped.length ? '，跳过 ' + res.skipped.length + ' 条重复' : ''));
      preview = null;
      await refresh();
    } catch (e) { toast(e.message, true); }
  });
}

function renderUndo(host, refresh) {
  const batch = localStorage.getItem('applydeck:lastBatch');
  if (!batch) return '';
  return '<div class="hint-box" style="margin-top:12px">上次导入批次：<span class="mono tiny">' + esc(batch.slice(0, 8)) + '</span> · <button class="btn sm ghost" id="btn-undo">撤销这次导入</button></div>';
}

export async function renderImport(view, refresh) {
  view.innerHTML = '';
  const settings = state.meta ? state.meta.settings : {};
  view.innerHTML = '<div class="import-grid">'
    + '<div>'
    + '<div class="section-head"><h2>粘贴笔记</h2><span>支持 Obsidian 里的 md 列表</span></div>'
    + '<div class="toolbar" style="margin-bottom:10px">'
    + '<label class="tiny muted">年份</label><input class="input" id="import-year" type="number" value="' + (settings.importYear || 2026) + '" style="width:96px" />'
    + '<button class="btn ghost" id="btn-seed">加载我的示例笔记</button>'
    + '</div>'
    + '<textarea class="note-input" id="note-text" placeholder="把 Obsidian 笔记里「已投递 / 暂未投递 / BOSS / 实习僧 / 牛客」那几段直接粘进来…"></textarea>'
    + '<div style="display:flex;gap:8px;margin-top:12px">'
    + '<button class="btn primary" id="btn-preview">解析预览</button>'
    + '<span class="tiny muted" style="align-self:center">解析完全在本地完成，不会上传任何内容</span>'
    + '</div>'
    + '<div id="undo-host">' + renderUndo(null, refresh) + '</div>'
    + '</div>'
    + '<div class="panel">'
    + '<div class="section-head"><h2>怎么写的笔记能被认出来</h2></div>'
    + '<div class="hint-box">'
    + '<b>1. 用加粗标题分渠道/状态</b><br>**已投递**、**暂未投递**、**BOSS直聘**、**实习僧**、**牛客**<br><br>'
    + '<b>2. 每行一条，尽量包含：公司 + 岗位 + 日期</b><br>百度 大模型应用方向实习生（J105638） 10.9日<br><br>'
    + '<b>3. 自动识别</b><br>公司词典（百度/字节/Kimi/博世中国…）、岗位编号（J105638）、日期（10.9 / 10月9日）、城市（上海/北京…）、渠道词<br><br>'
    + '<b>4. 可撤销</b><br>每次导入生成一个批次，导入后后悔可以一键撤销，不影响手动录入的数据。'
    + '</div></div>'
    + '</div>'
    + '<div id="preview-host"></div>';

  document.getElementById('btn-seed').addEventListener('click', async function () {
    try {
      const data = await get('/api/seed-note');
      document.getElementById('note-text').value = data.text;
      toast('示例笔记已载入');
    } catch (e) { toast(e.message, true); }
  });

  document.getElementById('btn-preview').addEventListener('click', async function () {
    const text = document.getElementById('note-text').value.trim();
    if (!text) { toast('先粘贴笔记内容', true); return; }
    const host = document.getElementById('preview-host');
    host.innerHTML = loadingState();
    try {
      previewText = text;
      const year = Number(document.getElementById('import-year').value) || 2026;
      preview = await post('/api/import/preview', { text: text, year: year });
      if (!preview.records.length) { host.innerHTML = '<div class="panel" style="margin-top:16px"><div class="muted">没解析出记录，检查一下标题行和列表格式。</div></div>'; return; }
      renderPreview(host, refresh);
    } catch (e) {
      host.innerHTML = '';
      toast(e.message, true);
    }
  });

  const seed = document.getElementById('note-text');
  seed.addEventListener('keydown', function () { preview = null; });

  const undoBtn = document.getElementById('btn-undo');
  if (undoBtn) {
    undoBtn.addEventListener('click', async function () {
      const batch = localStorage.getItem('applydeck:lastBatch');
      if (!batch) return;
      if (!window.confirm('撤销这次导入会删除该批次创建的所有记录，确定？')) return;
      try {
        const res = await post('/api/import/undo', { batchId: batch });
        localStorage.removeItem('applydeck:lastBatch');
        toast('已撤销，删除 ' + res.removed + ' 条记录');
        await refresh();
      } catch (e) { toast(e.message, true); }
    });
  }
}
