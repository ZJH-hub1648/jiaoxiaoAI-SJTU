import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { DIMENSIONS } from '../lib/assessment.mjs';

const exec = promisify(execFile), root = dirname(dirname(fileURLToPath(import.meta.url))), digest = value => createHash('sha256').update(value).digest('hex');
const temp = await realpath(await mkdtemp(join(tmpdir(),'interview-release-')));
let client, transport;
try {
  const packed = JSON.parse((await exec(process.execPath,[join(root,'build-package.mjs')],{ cwd: temp })).stdout);
  const zip = await readFile(packed.path); assert.equal(digest(zip),packed.sha256);
  assert.ok((await readFile(packed.path + '.sha256','utf8')).startsWith(packed.sha256));
  const unpacked = join(temp,'unpacked'); await mkdir(unpacked);
  const entries = new Map();
  for (let offset = 0; zip.readUInt32LE(offset) === 0x04034b50;) {
    const method = zip.readUInt16LE(offset + 8), size = zip.readUInt32LE(offset + 18), length = zip.readUInt16LE(offset + 26), extra = zip.readUInt16LE(offset + 28);
    const path = zip.subarray(offset+30,offset+30+length).toString('utf8');
    assert.ok(path.startsWith('project-interview/') && !path.split('/').includes('..') && !path.includes('\\'));
    assert.ok(!/(^|\/)(node_modules|release|snapshots|sessions|jobs|\.git)(\/|$)/.test(path));
    const begin = offset + 30 + length + extra, bytes = zip.subarray(begin,begin+size), content = method === 8 ? inflateRawSync(bytes) : bytes;
    const output = resolve(unpacked,path); assert.ok(output.startsWith(unpacked + sep));
    await mkdir(dirname(output),{ recursive: true }); await writeFile(output,content); entries.set(path,content); offset = begin + size;
  }
  const manifest = JSON.parse(entries.get('project-interview/RELEASE.json').toString('utf8'));
  for (const file of manifest.files) assert.equal(digest(entries.get(file.path)),file.sha256);
  assert.equal(entries.size,manifest.files.length + 1);
  const extracted = join(unpacked,'project-interview'), target = join(temp,'device','.agents','skills','project-interview');
  const install = JSON.parse((await exec(process.execPath,[join(extracted,'scripts/install.mjs'),'--target',target],{ cwd: temp })).stdout);
  assert.equal(install.path,await realpath(target));
  await assert.rejects(exec(process.execPath,[join(extracted,'scripts/install.mjs'),'--target',target],{ cwd: temp }), error => error.code === 1);
  const data = join(temp,'private-data'), project = join(temp,'project with spaces'); await mkdir(project);
  await writeFile(join(project,'server.mjs'),'const cache = new Map();\nexport const read = key => cache.get(key);\nexport const write = (key, value) => cache.set(key, value);\n');
  const cli = async args => JSON.parse((await exec(process.execPath,[join(target,'scripts/interview.mjs'),...args,'--data-dir',data],{ cwd: temp, env: { ...process.env, NODE_PATH: '' } })).stdout);
  const status = await cli(['status']); assert.equal(status.extraModelKeyRequired,false);
  // The installed CLI works before any dependencies are installed.
  const snapshot = await cli(['index','--project',project]); assert.equal(snapshot.ok,true);
  const installArgs = ['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'];
  if (process.platform === 'win32') await exec(process.env.ComSpec || 'cmd.exe',['/d','/s','/c',`npm ${installArgs.join(' ')}`],{ cwd: target, timeout: 180000 });
  else await exec('npm',installArgs,{ cwd: target, timeout: 180000 });
  client = new Client({ name: 'project-interview-release-test', version: '1.0.0' });
  transport = new StdioClientTransport({ command: process.execPath, args: [join(target,'mcp.mjs'),'--data-dir',data], cwd: temp, env: { NODE_PATH: '' }, stderr: 'pipe' });
  await client.connect(transport);
  const tools = await client.listTools(); assert.equal(tools.tools.length,19);
  const call = async (name,args = {}) => { const response = await client.callTool({ name: `interview_${name}`, arguments: args }); assert.ok(!response.isError,JSON.stringify(response.content)); return JSON.parse(response.content[0].text); };
  assert.equal((await call('status')).mcpReady,true);
  const session = await call('start',{ snapshot: snapshot.id, mode: 'learning', rounds: 1 });
  const prepared = await call('prepare',{ session: session.id, query: 'cache' }), source = prepared.evidence.find(x => x.path === 'server.mjs');
  const citation = { id: source.id, quote: source.text };
  await call('question',{ session: session.id, job: prepared.job.id, result: { question: '缓存持续写入时有什么风险，怎样验证？', kind: 'failure', evidence: [citation] } });
  const hint = await call('prepare_hint',{ session: session.id, level: 1 });
  await call('hint',{ session: session.id, job: hint.job.id, result: { hint: '先考虑 Map 的容量和生命周期，再提出可以观测的指标。', evidence: [citation] } });
  const answer = '我会监控缓存条目数量和堆大小，再设置容量并验证淘汰行为。';
  await call('answer',{ session: session.id, answer });
  const review = await call('prepare_review',{ session: session.id, round: 1 });
  const result = { dimensions: Object.fromEntries(DIMENSIONS.map(key => [key, { score: key === 'tradeoffs' ? null : 3, reason: key === 'tradeoffs' ? '本轮未比较替代方案' : '回答有合理的观察和验证方向，仍需具体实现', answerQuote: key === 'tradeoffs' ? null : answer }])), explanation: 'Map 无容量限制；持续增长是根据源码作出的假设，需要实际实验验证。', strengths: ['提出可观察指标'], gaps: ['尚未比较替代方案'], exercises: [{ task: '实现有界缓存', successCriteria: '边界测试验证淘汰行为并保存实际结果' }], evidence: [citation] };
  await call('review',{ session: session.id, job: review.job.id, result });
  const report = await call('report',{ session: session.id }); assert.equal(report.complete,true); assert.equal(report.metrics.practiceScore100,null); assert.equal(report.turns[0].assisted,true); assert.equal(report.independentMetrics.dimensions.accuracy.score,null);
  const output = join(temp,'private-report.md'); await call('export',{ session: session.id, output }); assert.ok((await readFile(output,'utf8')).includes('代码来源'));
  assert.ok((await call('list')).sessions.some(x => x.id === session.id));
  const rejected = await client.callTool({ name: 'interview_answer', arguments: { session: session.id, answer: '已结束后不应接受' } }); assert.equal(rejected.isError,true);
  // Verify core and CLI also remain compatible with pre-review 0.3.0 records (same schemaVersion).
  const cliReport = await cli(['report','--session',session.id]); assert.equal(cliReport.turns[0].review.dimensions.accuracy.score,3);
  console.log(JSON.stringify({ ok: true, platform: process.platform, arch: process.arch, version: manifest.version, checks: ['ZIP SHA-256 and per-file manifest','standalone Agent directory install','refuse nonempty target','CLI before dependency installation','clean npm ci --omit=dev','standard MCP initialize and 19 tools','source-grounded question','recorded learning hint','real answer record','nullable rubric assessment','assisted/independent separation','Markdown report export','session discovery','invalid transition rejection','shared CLI/MCP storage'], modelResults: 'fixed synthetic host samples; not a real-model quality benchmark' },null,2));
} finally {
  try { if (client) await client.close(); } finally { if (transport) await transport.close(); }
  assert.equal(dirname(temp),await realpath(tmpdir())); assert.ok(temp.split(sep).at(-1).startsWith('interview-release-')); await rm(temp,{ recursive: true, force: true });
}
