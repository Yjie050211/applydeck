/* ApplyDeck 采集器 · 弹窗逻辑（零依赖，普通 script；演示模式不调用 Chrome 扩展 API） */
(function () {
  'use strict';

  var API_BASE = 'http://127.0.0.1:8788';
  var HEALTH_URL = API_BASE + '/api/health';
  var CAPTURE_URL = API_BASE + '/api/capture';
  var DASH_URL = API_BASE + '/#/table';

  var CHANNEL_LABELS = {
    official: '官网',
    boss: 'BOSS直聘',
    shixiseng: '实习僧',
    nowcoder: '牛客',
    referral: '内推',
    other: '其他'
  };

  var DEMO_DATA = {
    company: '星海科技',
    role: 'AI 应用开发实习生',
    location: '北京·海淀区',
    salary: '300-500元/天',
    channel: 'boss',
    url: 'https://www.zhipin.com/job_detail/demo.html',
    title: 'AI 应用开发实习生_星海科技_北京-300-500元/天-BOSS直聘',
    page: 'fixture-boss'
  };

  var els = {};
  var state = {
    demo: false,
    online: false,
    busy: false,
    captured: null,
    tabId: null
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function cacheEls() {
    els.dot = byId('status-dot');
    els.statusText = byId('status-text');
    els.siteBadge = byId('site-badge');
    els.sourceHost = byId('source-host');
    els.salaryChip = byId('salary-chip');
    els.reload = byId('reload-btn');
    els.notice = byId('notice');
    els.form = byId('form');
    els.company = byId('company');
    els.role = byId('role');
    els.location = byId('location');
    els.channel = byId('channel');
    els.url = byId('url');
    els.submit = byId('submit-btn');
    els.submitLabel = byId('submit-label');
    els.spinner = byId('submit-spinner');
    els.result = byId('result');
    els.openLink = byId('open-link');
  }

  /* ------------------------------ 小工具 ------------------------------ */

  function hasChromeApi() {
    try {
      return typeof chrome !== 'undefined' && !!chrome &&
        !!chrome.scripting && !!chrome.tabs && typeof chrome.tabs.query === 'function';
    } catch (e) {
      return false;
    }
  }

  function detectDemo() {
    try {
      if (window.location && String(window.location.search).indexOf('demo=1') !== -1) return true;
    } catch (e) { /* ignore */ }
    return !hasChromeApi();
  }

  function extractDomain(url) {
    var s = String(url || '');
    var m = s.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]+)/);
    return m ? m[1].toLowerCase() : '';
  }

  function isHttpPage(url) {
    var s = String(url || '');
    if (!/^https?:\/\//i.test(s)) return false;
    if (s.indexOf('chrome.google.com/webstore') !== -1) return false;
    if (s.indexOf('chromewebstore.google.com') !== -1) return false;
    return true;
  }

  function setStatus(kind, text) {
    if (!els.dot || !els.statusText) return;
    els.dot.className = 'dot ' + kind;
    els.statusText.textContent = text;
    els.statusText.title = text;
  }

  function setBadge(text) {
    if (els.siteBadge) els.siteBadge.textContent = text;
  }

  function showNotice(kind, text) {
    if (!els.notice) return;
    els.notice.className = 'notice ' + kind;
    els.notice.textContent = text;
    els.notice.hidden = false;
  }

  function hideNotice() {
    if (!els.notice) return;
    els.notice.hidden = true;
    els.notice.textContent = '';
  }

  function setSalaryChip(salary) {
    if (!els.salaryChip) return;
    if (salary) {
      els.salaryChip.textContent = salary;
      els.salaryChip.hidden = false;
    } else {
      els.salaryChip.textContent = '';
      els.salaryChip.hidden = true;
    }
  }

  function setBusy(busy) {
    state.busy = busy;
    if (!els.submit) return;
    els.submit.disabled = busy;
    if (els.spinner) els.spinner.hidden = !busy;
    if (els.submitLabel) els.submitLabel.textContent = busy ? '正在写入…' : '加入投递舱';
  }

  function hideResult() {
    if (!els.result) return;
    els.result.hidden = true;
    els.result.className = 'result';
    els.result.textContent = '';
  }

  function makeAction(action) {
    var node;
    if (action.href) {
      node = document.createElement('a');
      node.href = action.href;
      node.target = '_blank';
      node.rel = 'noopener';
    } else {
      node = document.createElement('button');
      node.type = 'button';
      if (typeof action.onClick === 'function') node.addEventListener('click', action.onClick);
    }
    node.textContent = action.label;
    return node;
  }

  function showResult(kind, title, message, actions) {
    if (!els.result) return;
    els.result.className = 'result ' + kind;
    els.result.textContent = '';

    var head = document.createElement('div');
    head.className = 'result-head';
    var icon = document.createElement('span');
    icon.className = 'result-icon';
    icon.textContent = kind === 'ok' ? '✓' : kind === 'dup' ? '!' : '×';
    var titleNode = document.createElement('span');
    titleNode.textContent = title;
    head.appendChild(icon);
    head.appendChild(titleNode);
    els.result.appendChild(head);

    if (message) {
      var p = document.createElement('p');
      p.textContent = message;
      els.result.appendChild(p);
    }

    var list = actions && actions.length ? actions : [{ label: '打开投递舱 ↗', href: DASH_URL }];
    var bar = document.createElement('div');
    bar.className = 'result-actions';
    for (var i = 0; i < list.length; i++) bar.appendChild(makeAction(list[i]));
    els.result.appendChild(bar);

    els.result.hidden = false;
  }

  /* ------------------------------ 预览填充 ------------------------------ */

  function fillChannel(channel) {
    var value = CHANNEL_LABELS[channel] ? channel : 'official';
    if (els.channel) els.channel.value = value;
    return value;
  }

  function setChannelBadge(channel) {
    setBadge(CHANNEL_LABELS[channel] || '未知渠道');
  }

  function applyPreview(data, pageUrl) {
    var src = data && typeof data === 'object' ? data : {};
    state.captured = src;

    if (els.company) els.company.value = String(src.company || '');
    if (els.role) els.role.value = String(src.role || '');
    if (els.location) els.location.value = String(src.location || '');
    if (els.url) els.url.value = String(src.url || pageUrl || '');
    var channel = fillChannel(src.channel);
    setChannelBadge(channel);
    if (els.sourceHost) els.sourceHost.textContent = extractDomain(src.url || pageUrl) || '当前页面';
    setSalaryChip(String(src.salary || ''));

    var radios = document.querySelectorAll('input[name="status"]');
    for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === 'wishlist';

    hideResult();
    var company = String(src.company || '').trim();
    if (!company) {
      showNotice('warn', '没有识别到公司名称，请手动填写后再加入。');
      if (els.company) els.company.focus();
    } else if (!String(src.role || '').trim()) {
      showNotice('warn', '已读取公司，岗位名称请确认或手动补充。');
    } else {
      hideNotice();
    }
    markReady();
  }

  function applyDemo() {
    state.demo = true;
    applyPreview(DEMO_DATA, DEMO_DATA.url);
    setStatus('demo', '演示模式 · 内置样例');
    showNotice('warn', '演示模式：使用内置样例数据，不调用 Chrome 接口，可直接点按钮查看效果。');
  }

  function markReady() {
    window.__AD_POPUP_READY = true;
  }

  /* ------------------------------ 服务检测 ------------------------------ */

  function checkHealth() {
    setStatus('checking', '检测服务…');
    return fetchJson(HEALTH_URL, { method: 'GET' }, 2500)
      .then(function (res) {
        if (res.ok) {
          state.online = true;
          if (state.demo) setStatus('demo', '演示模式 · 服务在线');
          else setStatus('online', '投递舱在线');
        } else {
          throw new Error('health status ' + res.status);
        }
      })
      .catch(function () {
        state.online = false;
        if (state.demo) setStatus('demo', '演示模式 · 离线预览');
        else setStatus('offline', '离线 · 请先双击 start.bat');
      });
  }

  function fetchJson(url, options, timeoutMs) {
    var opts = options || {};
    return new Promise(function (resolve, reject) {
      var controller = null;
      var timer = null;
      try {
        controller = new AbortController();
        opts.signal = controller.signal;
      } catch (e) { /* 老旧内核没有 AbortController */ }

      if (controller) {
        timer = setTimeout(function () { controller.abort(); }, timeoutMs || 5000);
      }

      fetch(url, opts)
        .then(function (response) {
          if (timer) clearTimeout(timer);
          return response.text().then(function (text) {
            var body = null;
            try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
            resolve({ ok: response.ok, status: response.status, body: body, text: text });
          });
        })
        .catch(function (err) {
          if (timer) clearTimeout(timer);
          reject(err);
        });
    });
  }

  /* ------------------------------ 读取页面 ------------------------------ */

  function readCurrentTab() {
    if (!hasChromeApi()) { applyDemo(); return; }
    setBadge('读取中');
    setSalaryChip('');
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab || typeof tab.id !== 'number') {
        setBadge('未知页面');
        showNotice('error', '无法获取当前标签页，请关闭弹窗后重新点击扩展图标。');
        markReady();
        return;
      }
      state.tabId = tab.id;
      var url = String(tab.url || '');
      if (els.sourceHost) els.sourceHost.textContent = extractDomain(url) || '当前页面';
      if (!isHttpPage(url)) {
        setBadge('不支持');
        showNotice('warn', '这个页面无法采集（chrome://、扩展页、新标签页或本地文件）。请先打开 BOSS直聘 / 实习僧 / 牛客 的职位详情页，再点击扩展图标。');
        markReady();
        return;
      }
      injectExtractor(tab.id, url);
    });
  }

  function friendlyInjectError(message) {
    var text = String(message || '');
    var lower = text.toLowerCase();
    if (lower.indexOf('cannot access') !== -1 || lower.indexOf('extensions gallery') !== -1 || lower.indexOf('cannot be scripted') !== -1) {
      return '这个页面禁止注入脚本（浏览器内置页或受限页面）。请在 BOSS直聘 / 实习僧 / 牛客 的职位详情页使用。';
    }
    if (lower.indexOf('no tab') !== -1) return '标签页已关闭，请重新打开职位页后再试。';
    if (lower.indexOf('frame') !== -1) return '页面结构特殊，暂时读不到内容，可以手动填写后加入。';
    return '读取页面失败：' + text;
  }

  function onInjectFail(message, pageUrl) {
    setBadge('读取失败');
    showNotice('error', friendlyInjectError(message));
    if (els.url && pageUrl) els.url.value = String(pageUrl);
    if (state.demo) applyDemo();
    markReady();
  }

  function injectExtractor(tabId, pageUrl) {
    var func = null;
    try { func = typeof extractJob === 'function' ? extractJob : null; } catch (e) { func = null; }
    if (!func) {
      onInjectFail('extract.js 未加载', pageUrl);
      return;
    }
    try {
      chrome.scripting.executeScript({ target: { tabId: tabId }, func: func }, function (results) {
        var lastError = null;
        try { lastError = chrome.runtime && chrome.runtime.lastError; } catch (e) { lastError = null; }
        if (lastError) { onInjectFail(lastError.message || String(lastError), pageUrl); return; }
        var data = results && results[0] ? results[0].result : null;
        if (!data || typeof data !== 'object') {
          onInjectFail('页面没有返回采集数据，可能页面尚未加载完成。', pageUrl);
          return;
        }
        applyPreview(data, pageUrl);
      });
    } catch (e) {
      onInjectFail(e && e.message ? e.message : String(e), pageUrl);
    }
  }

  /* ------------------------------ 提交 ------------------------------ */

  function buildPayload() {
    var payload = {
      company: els.company ? els.company.value.trim() : '',
      channel: els.channel ? els.channel.value : 'official',
      status: selectedStatus()
    };
    var role = els.role ? els.role.value.trim() : '';
    if (role) payload.role = role;
    var location = els.location ? els.location.value.trim() : '';
    if (location) payload.location = location;
    var url = els.url ? els.url.value.trim() : '';
    if (url) payload.url = url;
    var salary = state.captured && state.captured.salary ? String(state.captured.salary).trim() : '';
    if (salary) payload.salary = salary;
    return payload;
  }

  function selectedStatus() {
    var checked = document.querySelector('input[name="status"]:checked');
    return checked && checked.value === 'applied' ? 'applied' : 'wishlist';
  }

  function onSubmit(ev) {
    if (ev) ev.preventDefault();
    if (state.busy) return;
    var payload = buildPayload();
    if (!payload.company) {
      showNotice('error', '公司名称不能为空，请先填写公司名称。');
      if (els.company) els.company.focus();
      return;
    }
    hideNotice();
    hideResult();
    setBusy(true);
    if (state.demo) {
      setTimeout(function () {
        setBusy(false);
        if (els.submitLabel) els.submitLabel.textContent = '已加入';
        showResult('ok', '已加入（演示）', '演示模式不会真正写入投递舱。真实安装扩展后，这里会显示服务端返回的记录编号。', [
          { label: '打开投递舱 ↗', href: DASH_URL },
          { label: '继续预览', onClick: function () { hideResult(); if (els.submitLabel) els.submitLabel.textContent = '加入投递舱'; } }
        ]);
      }, 420);
      return;
    }
    postCapture(payload);
  }

  function postCapture(payload) {
    fetchJson(CAPTURE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, 6000).then(function (res) {
      setBusy(false);
      var body = res.body || {};
      if (res.status === 201 && body.ok) {
        if (els.submitLabel) els.submitLabel.textContent = '已加入';
        showResult('ok', '已加入投递舱', '「' + payload.company + '」已保存为' + statusLabel(payload.status) + '，可在投递舱里继续补充信息。', [
          { label: '打开投递舱 ↗', href: DASH_URL },
          { label: '再采一条', onClick: function () { hideResult(); if (els.submitLabel) els.submitLabel.textContent = '加入投递舱'; } }
        ]);
        return;
      }
      if (res.status === 200 && body.duplicated) {
        if (els.submitLabel) els.submitLabel.textContent = '已存在';
        showResult('dup', '已存在，已为你定位', '这条投递记录此前已存在，没有重复创建。已为你打开投递舱，直接定位到原有记录。', [
          { label: '打开投递舱 ↗', href: DASH_URL },
          { label: '重新采集', onClick: function () { readCurrentTab(); hideResult(); } }
        ]);
        return;
      }
      if (res.status === 400) {
        var reason = body && body.error ? String(body.error) : '请求参数不正确';
        failResult('写入被拒绝：' + reason, payload);
        return;
      }
      failResult('服务返回异常（HTTP ' + res.status + '）', payload);
    }).catch(function () {
      setBusy(false);
      failResult('连不上投递舱服务，请确认已双击 start.bat 启动，然后重试。', payload);
    });
  }

  function failResult(message, payload) {
    if (els.submitLabel) els.submitLabel.textContent = '加入投递舱';
    showResult('err', '加入失败', message, [
      { label: '重试', onClick: function () { postCapture(payload); } },
      { label: '打开投递舱 ↗', href: DASH_URL }
    ]);
  }

  function statusLabel(status) {
    return status === 'applied' ? '已投递' : '待投递';
  }

  /* ------------------------------ 事件与启动 ------------------------------ */

  function bindEvents() {
    if (els.form) els.form.addEventListener('submit', onSubmit);
    if (els.reload) els.reload.addEventListener('click', function () {
      hideNotice();
      hideResult();
      if (state.demo) applyDemo();
      else readCurrentTab();
    });
    if (els.channel) els.channel.addEventListener('change', function () {
      setChannelBadge(els.channel.value);
    });
    if (els.openLink) els.openLink.href = DASH_URL;
  }

  function init() {
    cacheEls();
    bindEvents();
    state.demo = detectDemo();
    if (state.demo) {
      applyDemo();
      checkHealth();
    } else {
      checkHealth();
      readCurrentTab();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
