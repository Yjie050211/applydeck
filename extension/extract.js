/*
 * ApplyDeck 采集器 · 页面上下文提取脚本
 * ---------------------------------------------------------------------------
 * classic script（没有 import/export），唯一定义的全局函数是 extractJob()。
 *
 * popup.js 通过 chrome.scripting.executeScript({ target, func: extractJob })
 * 把本函数注入当前职位页。Chrome 会序列化函数源码后在页面里重新执行，
 * 所以函数体内不能引用本文件之外的任何变量/函数，否则注入后会 ReferenceError。
 *
 * 返回（所有字段保证是字符串，取不到就是 ''）：
 *   {
 *     company:  '公司名',
 *     role:     '岗位名',
 *     location: '城市',
 *     salary:   '薪资',
 *     channel:  'official | boss | shixiseng | nowcoder | referral | other',
 *     url:      当前页面完整链接,
 *     title:    document.title,
 *     page:     当前站点 hostname（调试/展示用，完整链接看 url）
 *   }
 *
 * 任何异常都在函数内被吞掉：最差返回字段全空的对象，绝不把异常抛给调用方。
 */
function extractJob() {
  'use strict';
  try {
    var doc = document;

    /* ------------------------------ 基础工具 ------------------------------ */
    function clean(value) {
      return String(value === null || value === undefined ? '' : value)
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function safeQuery(selector) {
      try { return doc.querySelector(selector); } catch (e) { return null; }
    }

    function textOf(selector) {
      var el = safeQuery(selector);
      if (!el) return '';
      return clean(el.textContent || '');
    }

    function firstText(selectors) {
      for (var i = 0; i < selectors.length; i++) {
        var value = textOf(selectors[i]);
        if (value) return value;
      }
      return '';
    }

    function metaContent(keys) {
      for (var i = 0; i < keys.length; i++) {
        var el = safeQuery('meta[property="' + keys[i] + '"]') || safeQuery('meta[name="' + keys[i] + '"]');
        if (el) {
          var content = clean(el.getAttribute('content') || '');
          if (content) return content;
        }
      }
      return '';
    }

    var CITY_RE = /(北京|上海|深圳|广州|杭州|成都|南京|武汉|西安|苏州|长沙|重庆|天津|合肥|厦门|青岛|郑州|大连|珠海|无锡|佛山|东莞|宁波|济南|福州|南昌|昆明|贵阳|南宁|海口|石家庄|太原|沈阳|长春|哈尔滨|兰州|乌鲁木齐|呼和浩特|银川|西宁|拉萨|香港|澳门|台北)/;

    function cityFrom(value) {
      var m = clean(value).match(CITY_RE);
      return m ? m[1] : '';
    }

    /* 整段文字基本就是个城市（允许「北京·海淀区」这类后缀）时返回城市名 */
    function cityOnly(value) {
      var s = clean(value);
      if (!s || s.length > 24) return '';
      var m = s.match(CITY_RE);
      if (!m) return '';
      var rest = clean(s.replace(CITY_RE, '').replace(/[·•\-—–_\/|]/g, ''));
      return rest.length <= 4 ? m[1] : '';
    }

    /* 从一段文字里抠出薪资（避免把整段职位描述当薪资） */
    function salaryOnly(value) {
      var s = clean(value);
      if (!s || s.length > 32) return '';
      if (s.indexOf('面议') !== -1) return '面议';
      var m = s.match(/\d+(?:\.\d+)?\s*[-~—–]\s*\d+(?:\.\d+)?\s*(?:元\s*\/\s*[天月时]|元\/天|元\/月|元\/时|万\/年|K\/月|k\/月|K|k|元)/);
      if (m) return clean(m[0]);
      m = s.match(/\d+(?:\.\d+)?\s*(?:元\s*\/\s*[天月时]|元\/天|元\/月|元\/时|万\/年|K\/月|k\/月|K|k|元)/);
      return m ? clean(m[0]) : '';
    }

    var ROLE_RE = /(实习|工程师|开发|研发|算法|产品|运营|设计|分析|研究|测试|前端|后端|全栈|数据|机器学习|深度学习|大模型|人工智能|AI|专员|助理|经理|管培|校招|秋招|春招|架构|运维|安全|策略|市场|品牌|人力|财务|法务|销售|编辑|记者|策划|美术|视觉|交互|客户端|服务端|岗位)/i;

    function looksRole(value) {
      return ROLE_RE.test(clean(value));
    }

    var BRANDS = ['BOSS直聘', 'boss直聘', '直聘网', '直聘', '实习僧', '牛客网', '牛客', '拉勾网', '拉勾', '智联招聘', '前程无忧', '猎聘网', '猎聘', '大街网', '应届生求职网', '招聘官网', '官方网站'];

    /* 只剥离标题末尾用分隔符接上的站点名，例如 "……-BOSS直聘" */
    function stripBrands(value) {
      var t = clean(value);
      for (var i = 0; i < BRANDS.length; i++) {
        var brand = BRANDS[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var re = new RegExp('\\s*[-_|｜·•—–/]\\s*' + brand + '\\s*$', 'i');
        t = t.replace(re, '');
      }
      return clean(t);
    }

    function cleanCompany(value) {
      var s = clean(value);
      s = s.replace(/^(?:公司|企业|招聘方|雇主)\s*[:：]\s*/, '');
      s = s.replace(/\s*(?:招聘中|招聘|诚聘|官网|官微|官方)$/, '');
      s = s.replace(/[（(](?:招聘|官网)[^）)]*[）)]$/, '');
      return clean(s);
    }

    function cleanRole(value) {
      var s = clean(value);
      s = s.replace(/^(?:岗位|职位|招聘岗位|职位名称)\s*[:：]\s*/, '');
      s = s.replace(/\s*(?:急招|热招)$/, '');
      return clean(s);
    }

    function cleanParts(parts) {
      var out = [];
      for (var i = 0; i < parts.length; i++) {
        var part = clean(parts[i]);
        if (part) out.push(part);
      }
      return out;
    }

    /* 从「岗位 - 公司 - 地点/薪资」类标题里拆分字段 */
    function parseTitle(raw) {
      var out = { company: '', role: '', location: '', salary: '' };
      var t = clean(raw);
      if (!t) return out;

      /* 0) 开头的【上海】/（北京）等城市标记（实习僧常见） */
      var lead = t.match(/^[【\[（(]\s*([^】\]）)]{2,16})\s*[】\]）)]\s*/);
      if (lead) {
        var leadCity = cityFrom(lead[1]);
        if (leadCity) out.location = leadCity;
        t = clean(t.slice(lead[0].length));
      }
      t = stripBrands(t);
      if (!t) return out;

      /* 1) BOSS 三段式：岗位_公司_地点-薪资 */
      var segments = t.split(/\s*_\s*/);
      if (segments.length >= 3) {
        out.role = cleanRole(segments[0]);
        out.company = cleanCompany(segments[1]);
        var rest = clean(segments.slice(2).join('-'));
        var restCity = cityFrom(rest);
        if (restCity) out.location = restCity;
        out.salary = salaryOnly(rest);
        return out;
      }

      /* 2) 常见标题：岗位 - 公司 - 地点/薪资 */
      var parts = [];
      if (segments.length === 2) {
        parts = [segments[0], segments[1]];
      } else {
        var seps = [/\s+[-—–]\s+/, /\s*[|｜]\s*/, /\s*[·•]\s*/, /\s*[-—–]\s*/];
        for (var i = 0; i < seps.length; i++) {
          if (seps[i].test(t)) { parts = t.split(seps[i]); break; }
        }
        if (!parts.length) parts = [t];
      }
      parts = cleanParts(parts);
      if (!parts.length) return out;

      /* 先把明显是「地点」「薪资」的段摘出来 */
      var remaining = [];
      for (var j = 0; j < parts.length; j++) {
        var part = parts[j];
        if (!part) continue;
        if (!out.location && cityOnly(part)) { out.location = cityOnly(part); continue; }
        var sal = salaryOnly(part);
        if (!out.salary && sal && !looksRole(part)) { out.salary = sal; continue; }
        remaining.push(part);
      }
      if (!remaining.length) return out;

      if (remaining.length === 1) {
        var single = remaining[0];
        var hireMatch = single.match(/^(.{2,40}?)(?:招聘|诚聘)(.{2,60})$/);
        if (hireMatch) {
          out.company = cleanCompany(hireMatch[1]);
          out.role = cleanRole(hireMatch[2]);
        } else if (looksRole(single)) {
          out.role = cleanRole(single);
        } else {
          out.company = cleanCompany(single);
        }
        return out;
      }

      var first = remaining[0];
      var second = remaining[1];
      if (looksRole(first) && !looksRole(second)) {
        out.role = cleanRole(first);
        out.company = cleanCompany(second);
      } else if (looksRole(second) && !looksRole(first)) {
        out.company = cleanCompany(first);
        out.role = cleanRole(second);
      } else {
        /* 默认顺序：岗位在前、公司在后 */
        out.role = cleanRole(first);
        out.company = cleanCompany(second);
      }
      return out;
    }

    /* 站点识别：hostname 优先；镜像站 / 本地 fixture 用标题与 DOM 特征兜底 */
    function detectChannel(host, title) {
      var h = String(host || '');
      if (h.indexOf('zhipin.com') !== -1 || h.indexOf('zhipin.cn') !== -1) return 'boss';
      if (h.indexOf('shixiseng.com') !== -1) return 'shixiseng';
      if (h.indexOf('nowcoder.com') !== -1) return 'nowcoder';
      var t = String(title || '');
      if (t.indexOf('BOSS直聘') !== -1 || /boss\s*直聘/i.test(t)) return 'boss';
      if (t.indexOf('实习僧') !== -1) return 'shixiseng';
      if (t.indexOf('牛客') !== -1) return 'nowcoder';
      if (safeQuery('.job-banner')) return 'boss';
      if (safeQuery('.new_job_name')) return 'shixiseng';
      if (safeQuery('.job-detail-header')) return 'nowcoder';
      return 'official';
    }

    function limit(value, max) {
      var s = clean(value);
      return s.length > max ? s.slice(0, max) : s;
    }

    /* ------------------------------ 页面信息 ------------------------------ */
    var hostname = '';
    var href = '';
    var pageTitle = '';
    try { hostname = String((window.location && window.location.hostname) || '').toLowerCase(); } catch (e) { hostname = ''; }
    try { href = String((window.location && window.location.href) || ''); } catch (e) { href = ''; }
    try { pageTitle = clean(doc.title || ''); } catch (e) { pageTitle = ''; }

    var channel = detectChannel(hostname, pageTitle);
    var result = {
      company: '',
      role: '',
      location: '',
      salary: '',
      channel: channel,
      url: href,
      title: pageTitle,
      page: hostname
    };

    /* --------------------------- 站点级选择器 --------------------------- */
    if (channel === 'boss') {
      result.role = firstText(['.job-banner .job-name', '.job-banner h1', '.job-banner .name', '.job-primary .job-name', '.job-primary .name h1', '.job-name']);
      result.salary = firstText(['.job-banner .salary', '.job-primary .salary', '.job-banner .job-salary', '.salary']);
      result.location = firstText(['.job-banner .job-address .text', '.job-banner .job-address', '.job-primary .job-area', '.job-address .text', '.job-area']);
      result.company = firstText(['.company-info .company-name', '.job-banner .company-name', '.company-info .name', '.company-name']);
    } else if (channel === 'shixiseng') {
      result.role = firstText(['.new_job_name', '.job_name', '.newjob_name', '.job-title h1', '.job-name']);
      result.company = firstText(['.com-name', '.com_name', '.com_info .com-name', '.job-com-name', '.company-name']);
      result.location = firstText(['.job_msg .city', '.job_msg .job-city', '.job-city', '.msg .city']);
      result.salary = firstText(['.job_msg .salary', '.job_msg .money', '.job-salary', '.salary']);
      var msgText = firstText(['.job_msg', '.job_msg_list', '.job-msg']);
      if ((!result.location || !result.salary) && msgText) {
        if (!result.location) result.location = cityOnly(msgText);
        if (!result.salary) result.salary = salaryOnly(msgText);
      }
    } else if (channel === 'nowcoder') {
      result.role = firstText(['.job-detail-header .job-name', '.job-detail .job-name', '.job-name', 'h1.job-name', '.job-title']);
      result.company = firstText(['.job-detail-header .company-name', '.company-name', '.job-company', '.company .name']);
      result.location = firstText(['.job-detail-header .job-city', '.job-city', '.job-address', '.job-location']);
      result.salary = firstText(['.job-detail-header .job-salary', '.job-salary', '.salary', '.job-money']);
    }

    result.company = cleanCompany(result.company);
    result.role = cleanRole(result.role);
    result.location = cityOnly(result.location) || clean(result.location);
    result.salary = salaryOnly(result.salary) || clean(result.salary);

    /* ---------------- 字段缺失时：og:title / document.title 兜底 ---------------- */
    if (!result.company || !result.role || !result.location || !result.salary) {
      var titleSources = [metaContent(['og:title', 'twitter:title']), pageTitle];
      for (var s = 0; s < titleSources.length; s++) {
        var source = titleSources[s];
        if (!source) continue;
        var parsed = parseTitle(source);
        if (!result.company && parsed.company) result.company = parsed.company;
        if (!result.role && parsed.role) result.role = parsed.role;
        if (!result.location && parsed.location) result.location = parsed.location;
        if (!result.salary && parsed.salary) result.salary = parsed.salary;
      }
    }

    var CHANNELS = ['official', 'boss', 'shixiseng', 'nowcoder', 'referral', 'other'];
    return {
      company: limit(result.company, 80),
      role: limit(result.role, 120),
      location: limit(result.location, 60),
      salary: limit(result.salary, 40),
      channel: CHANNELS.indexOf(result.channel) >= 0 ? result.channel : 'official',
      url: String(href || '').slice(0, 2000),
      title: limit(pageTitle, 300),
      page: limit(hostname, 120)
    };
  } catch (err) {
    var safeUrl = '';
    var safeTitle = '';
    var safePage = '';
    try { safeUrl = String((window.location && window.location.href) || ''); } catch (e) { safeUrl = ''; }
    try { safeTitle = String(document.title || ''); } catch (e) { safeTitle = ''; }
    try { safePage = String((window.location && window.location.hostname) || ''); } catch (e) { safePage = ''; }
    return {
      company: '',
      role: '',
      location: '',
      salary: '',
      channel: 'official',
      url: safeUrl,
      title: safeTitle,
      page: safePage
    };
  }
}
