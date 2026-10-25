import { todayStr } from './db.mjs';

const COMPANIES = [
  '哔哩哔哩', '字节跳动', 'MiniMax', '阶跃星辰', '科锐国际', '博世中国', '亚信科技', '安克创新',
  '小红书', '快手', '百度', '字节', '联想', 'Kimi', 'B站', '腾讯', '阿里巴巴', '美团', '京东',
  '米哈游', '商汤', '旷视', '网易', '滴滴', '华为', '小米', 'OPPO', 'vivo', '科大讯飞', '月之暗面',
  '智谱', '百川智能', '零一万物', 'deepseek', 'DeepSeek', '微软', '亚马逊', 'Shopee', 'SHEIN'
].sort((a, b) => b.length - a.length);

const CITIES = ['北京', '上海', '深圳', '杭州', '广州', '南京', '成都', '武汉', '西安', '合肥', '苏州', '厦门', '长沙', '重庆', '天津', '青岛', '大连', '珠海', '无锡', '香港', '远程'];

const CHANNEL_WORDS = ['实习僧', '牛客', 'BOSS直聘', 'BOSS', '官网', '内推'];

function pad(n) { return String(n).padStart(2, '0'); }

function sectionFromHeading(text) {
  const s = text.replace(/\s+/g, '');
  if (/暂未投递/.test(s)) return { channel: 'official', status: 'wishlist', label: '暂未投递' };
  if (/已投递/.test(s)) return { channel: 'official', status: 'applied', label: '已投递' };
  if (/boss/i.test(s)) return { channel: 'boss', status: 'applied', label: 'BOSS直聘' };
  if (/实习僧/.test(s)) return { channel: 'shixiseng', status: 'applied', label: '实习僧' };
  if (/牛客/.test(s)) return { channel: 'nowcoder', status: 'applied', label: '牛客' };
  if (/内推/.test(s)) return { channel: 'referral', status: 'applied', label: '内推' };
  return null;
}

function normalizeKey(company, role) {
  return (company || '').replace(/\s+/g, '').toLowerCase() + '|' + (role || '').replace(/\s+/g, '').toLowerCase();
}

export function parseNote(text, options) {
  options = options || {};
  const year = Number(options.year) || new Date().getFullYear();
  const lines = String(text || '').split(/\r?\n/);
  const records = [];
  const warnings = [];
  let section = { channel: 'official', status: 'applied', label: '已投递' };
  let lineNo = 0;

  for (const rawLine of lines) {
    lineNo += 1;
    const line = rawLine.trim();
    if (!line) continue;

    const heading = line.match(/^\*\*(.+?)\*\*$/) || line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      const parsed = sectionFromHeading(heading[1]);
      if (parsed) { section = parsed; continue; }
    }

    let body = line.replace(/^[-*•]\s*/, '').trim();
    if (!body) continue;

    let status = section.status;
    let channel = section.channel;

    if (/待投递[！!]?/.test(body)) { status = 'wishlist'; body = body.replace(/待投递[！!]?/g, ' '); }

    let appliedAt = null;
    const dateMatch = body.match(/(\d{1,2})\s*[.\/月]\s*(\d{1,2})\s*日?/);
    if (dateMatch) {
      const month = Number(dateMatch[1]);
      const day = Number(dateMatch[2]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        appliedAt = year + '-' + pad(month) + '-' + pad(day);
        body = body.replace(dateMatch[0], ' ');
      }
    }

    let jobCode = null;
    const codeMatch = body.match(/[（(]?\s*([A-Za-z]{1,3}\d{4,8})\s*[)）]?/);
    if (codeMatch) {
      jobCode = codeMatch[1].toUpperCase();
      body = body.replace(codeMatch[0], ' ');
    }

    let company = null;
    let rest = body;
    for (const name of COMPANIES) {
      if (rest.includes(name)) {
        company = name;
        rest = rest.replace(name, ' ');
        break;
      }
    }

    let location = null;
    for (const city of CITIES) {
      if (rest.includes(city)) { location = city; rest = rest.replace(city, ' '); break; }
    }

    for (const w of CHANNEL_WORDS) rest = rest.split(w).join(' ');

    rest = rest.replace(/[（(]\s*[)）]/g, ' ');
    rest = rest.replace(/^[\s\-｜|·:：,，]+/, '').replace(/[\s\-｜|·:：,，]+$/, '');
    const role = rest.replace(/\s{2,}/g, ' ').trim();

    if (!company) {
      if (/直接联系|联系并投递/.test(body)) {
        warnings.push({ line: lineNo, text: rawLine.trim(), reason: '渠道说明行，已跳过' });
        continue;
      }
      if (!role) continue;
      const first = role.split(/\s+/)[0];
      if (!first || first.length < 2) { warnings.push({ line: lineNo, text: rawLine.trim(), reason: '无法识别公司名，已跳过' }); continue; }
      company = first;
      warnings.push({ line: lineNo, text: rawLine.trim(), reason: '未匹配到公司词典，暂用首词 "' + first + '"，导入后可修改' });
      rest = role.slice(first.length).replace(/^[\s\-－]+/, '');
    }

    const finalRole = (company === role ? '' : rest).replace(/^[\s\-－]+|[\s\-－]+$/g, '').trim();
    const record = {
      company: company,
      role: finalRole,
      channel: channel,
      job_type: 'daily',
      status: status,
      applied_at: status === 'wishlist' ? null : appliedAt,
      job_code: jobCode,
      location: location,
      priority: 'normal',
      source: 'import',
      raw: rawLine.trim(),
      warnings: []
    };
    if (finalRole && finalRole.length > 40) {
      record.role = finalRole.slice(0, 40);
      record.warnings.push('岗位名过长，已截断');
    }
    if (jobCode) record.role = (record.role || '').replace(/\s+$/g, '') + '（' + jobCode + '）';
    records.push(record);
  }

  const dedupeMap = new Map();
  for (const r of records) {
    const key = normalizeKey(r.company, r.role);
    if (dedupeMap.has(key)) {
      r.duplicateInFile = true;
      warnings.push({ line: 0, text: r.company + ' ' + r.role, reason: '笔记内重复，已标记' });
    } else {
      dedupeMap.set(key, r);
    }
  }

  const stats = {
    applied: records.filter(r => r.status !== 'wishlist').length,
    wishlist: records.filter(r => r.status === 'wishlist').length
  };
  return { records: records, warnings: warnings, stats: stats, sections: [] };
}

export { normalizeKey, COMPANIES, CITIES };