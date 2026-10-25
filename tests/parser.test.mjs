import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNote, normalizeKey } from '../server/parser.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const note = readFileSync(path.join(ROOT, 'seeds', 'my-note.md'), 'utf8');

test('示例笔记解析出 16 条：11 条已投递 + 5 条待投递', () => {
  const out = parseNote(note, { year: 2026 });
  assert.equal(out.records.length, 16);
  assert.equal(out.stats.applied, 11);
  assert.equal(out.stats.wishlist, 5);
});

test('百度 J105638：岗位编号并入岗位名，日期与渠道正确', () => {
  const out = parseNote(note, { year: 2026 });
  const baidu = out.records.find(r => r.company === '百度' && r.role.includes('J105638'));
  assert.ok(baidu, '应能找到百度 J105638');
  assert.equal(baidu.role, '大模型应用方向实习生（J105638）');
  assert.equal(baidu.applied_at, '2026-10-09');
  assert.equal(baidu.channel, 'official');
  assert.equal(baidu.status, 'applied');
});

test('实习僧段落归到 shixiseng 渠道，日期为 2026', () => {
  const out = parseNote(note, { year: 2026 });
  const bosch = out.records.find(r => r.company === '博世中国');
  assert.equal(bosch.channel, 'shixiseng');
  assert.equal(bosch.applied_at, '2026-10-16');
  assert.equal(bosch.location, '上海');
  const nowcoder = out.records.find(r => r.company === '快手');
  assert.equal(nowcoder.channel, 'nowcoder');
  assert.equal(nowcoder.applied_at, '2026-10-24');
});

test('暂未投递段落是 wishlist，且没有投递日期', () => {
  const out = parseNote(note, { year: 2026 });
  const names = out.records.filter(r => r.status === 'wishlist').map(r => r.company).sort();
  assert.deepEqual(names, ['MiniMax', '亚信科技', '哔哩哔哩', '安克创新', '联想'].sort());
  for (const r of out.records.filter(r => r.status === 'wishlist')) assert.equal(r.applied_at, null);
});

test('BOSS段落里的「直接联系并投递」作为渠道说明跳过并给出提示', () => {
  const out = parseNote(note, { year: 2026 });
  assert.equal(out.records.filter(r => r.company === 'BOSS直聘' || r.role.includes('直接联系')).length, 0);
  const w = out.warnings.find(x => /渠道说明行/.test(x.reason));
  assert.ok(w, '应有渠道说明行提示');
});

test('自定义笔记：加粗标题、bullet、中文日期都能识别', () => {
  const text = ['**实习僧**', '- 博世中国 AI Agent developer 上海 10月16日', '- 阶跃星辰 Agent算法工程师(实习) 10.19'].join('\n');
  const out = parseNote(text, { year: 2026 });
  assert.equal(out.records.length, 2);
  assert.equal(out.records[0].channel, 'shixiseng');
  assert.equal(out.records[0].applied_at, '2026-10-16');
  assert.equal(out.records[0].location, '上海');
  assert.equal(out.records[1].applied_at, '2026-10-19');
});

test('笔记内重复的公司+岗位会被标记 duplicateInFile', () => {
  const text = ['**已投递**', '- 百度 大模型应用方向实习生 10.9', '- 百度 大模型应用方向实习生 10.10'].join('\n');
  const out = parseNote(text, { year: 2026 });
  assert.equal(out.records.length, 2);
  assert.equal(out.records[1].duplicateInFile, true);
  assert.ok(out.warnings.some(w => /笔记内重复/.test(w.reason)));
});

test('公司词典外的公司用首词兜底并给出提示', () => {
  const out = parseNote('**已投递**\n- 某某科技 后端开发实习生 10.1', { year: 2026 });
  assert.equal(out.records[0].company, '某某科技');
  assert.ok(out.warnings.some(w => /未匹配到公司词典/.test(w.reason)));
});

test('normalizeKey 归一去重键', () => {
  assert.equal(normalizeKey(' 百度 ', 'AI 工程师'), normalizeKey('百度', 'AI工程师'));
});
