import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixturePdf, QUOTE } from './fixture.mjs';
import { scannedFixture } from './scanned-fixture.mjs';
const exec = promisify(execFile);
const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(join(tmpdir(), 'paper-portability-'));
const env = { ...process.env, NODE_PATH: '', PAPER_READER_NO_OPEN: '1' };
let child, client;
function text(result) { return JSON.parse(result.content.find((item) => item.type === 'text').text); }
try {
  const build = JSON.parse((await exec(process.execPath, [join(source, 'build-package.mjs')], { env })).stdout);
  const archive = await readFile(build.path);
  assert.equal(createHash('sha256').update(archive).digest('hex'), (await readFile(build.path + '.sha256', 'utf8')).split(/\s/)[0]);
  const unpack = join(temp, 'bundle'); await mkdir(unpack); let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8), size = archive.readUInt32LE(offset + 18), nameSize = archive.readUInt16LE(offset + 26), extra = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 30, offset + 30 + nameSize).toString('utf8');
    assert.ok(name.startsWith('paper-reading-assistance/'));
    const path = resolve(unpack, name); assert.ok(path.startsWith(unpack + sep));
    const start = offset + 30 + nameSize + extra; const bytes = archive.subarray(start, start + size);
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, method === 8 ? inflateRawSync(bytes) : bytes);
    offset = start + size;
  }
  const bundle = join(unpack, 'paper-reading-assistance');
  assert.equal(await stat(join(unpack, 'package.json')).then(() => true, () => false), false, '没有父仓库 package.json');
  const installed = join(temp, 'device', '.agents', 'skills', 'paper-reading-assistance');
  const unrelated = join(temp, 'unrelated-cwd'); await mkdir(unrelated);
  const install = JSON.parse((await exec(process.execPath, [join(bundle, 'scripts/install.mjs'), '--agent', 'custom', '--target', installed], { cwd: unrelated, env })).stdout);
  assert.equal(install.ok, true); assert.equal(install.path, installed);
  const npmArgs = ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'];
  if (process.platform === 'win32') await exec(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm', ...npmArgs], { cwd: installed, env, timeout: 180000, maxBuffer: 2e6, windowsHide: true });
  else await exec('npm', npmArgs, { cwd: installed, env, timeout: 180000, maxBuffer: 2e6 });
  const dataDir = join(temp, 'private-data'); const file = join(temp, 'paper.pdf'); await writeFile(file, fixturePdf());
  const cli = async (...args) => JSON.parse((await exec(process.execPath, [join(installed, 'scripts/paper.mjs'), ...args, '--data-dir', dataDir], { cwd: unrelated, env, maxBuffer: 2e6 })).stdout);
  assert.equal((await cli('status')).result.browserRequired, false);
  const paper = (await cli('import', '--file', file)).result; assert.equal(paper.pageCount, 2);
  assert.match((await cli('read', '--paper', paper.id, '--page', '2')).result.text, /limitations/);
  const scanned = join(temp, 'scan.pdf'); await writeFile(scanned, scannedFixture());
  const scanPaper = (await cli('import', '--file', scanned)).result; assert.deepEqual(scanPaper.needsOcrPages, [1]);
  const recognized = (await cli('ocr', '--paper', scanPaper.id, '--page', '1', '--language', 'eng')).result;
  assert.match(recognized.text, /source evidence/i); assert.ok(recognized.confidence > 50 && recognized.wordCount > 10, '无浏览器真实 OCR');
  const prepared = (await cli('prepare', '--paper', paper.id, '--task', 'translate')).result;
  const resultFile = join(temp, 'host-translation.json'); await writeFile(resultFile, JSON.stringify({ translation: '我们提出一种将解释关联到原文页码的阅读助手。' }));
  assert.match((await cli('complete', '--job', prepared.jobId, '--result-file', resultFile)).result.translation, /原文页码/);
  assert.equal(await stat(join(dataDir, 'model.json')).then(() => true, () => false), false, '无需配置模型 Key');

  client = new Client({ name: 'isolated-agent-harness', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(installed, 'mcp.mjs'), '--data-dir', dataDir], cwd: unrelated, env, stderr: 'pipe' }));
  assert.ok((await client.listTools()).tools.some((tool) => tool.name === 'paper_prepare'));
  const annotation = text(await client.callTool({ name: 'paper_prepare', arguments: { task: 'annotate', paper: paper.id, page: 1 } }));
  const saved = text(await client.callTool({ name: 'paper_complete', arguments: { job: annotation.jobId, result: { notes: [{ title: '宿主 Agent 注释', quote: QUOTE, explanation: '应把回答关联到原文，便于读者核验。' }] } } }));
  assert.equal(saved.notes.length, 1);
  const visual = await client.callTool({ name: 'paper_prepare', arguments: { task: 'visual', paper: paper.id, page: 1, rect: { x: .1, y: .1, width: .4, height: .3 } } });
  assert.ok(visual.content.some((item) => item.type === 'image'), 'MCP 返回真实页面裁剪图');

  child = spawn(process.execPath, [join(installed, 'server.mjs'), '--no-open', '--data-dir', dataDir], { cwd: unrelated, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const launched = await new Promise((done, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error('隔离服务启动超时')), 15000);
    child.stdout.on('data', (chunk) => { output += chunk; try { const value = JSON.parse(output); clearTimeout(timer); done(value); } catch {} });
    child.once('error', reject); child.once('exit', (code) => { if (code) reject(new Error(`隔离服务退出 ${code}`)); });
  });
  const base = new URL(launched.url).origin; const first = await fetch(launched.url, { redirect: 'manual' }); const cookie = first.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json' };
  assert.equal((await fetch(base + '/vendor/build/pdf.mjs', { headers })).status, 200, '阅读器从自己的依赖提供 PDF.js');
  await fetch(base + '/api/config', { method: 'POST', headers, body: JSON.stringify({ protocol: 'host', consent: true, vision: true, imageConsent: true }) });
  const response = await fetch(base + `/api/papers/${paper.id}/ask`, { method: 'POST', headers, body: JSON.stringify({ question: '这篇论文强调什么？', page: 1 }) });
  let pending;
  for (let attempt = 0; attempt < 10; attempt++) {
    const items = text(await client.callTool({ name: 'paper_pending', arguments: { wait: 1 } })); pending = items.find((item) => item.kind === 'reader-request'); if (pending) break;
  }
  assert.ok(pending, '阅读器问题可由宿主 Agent 取回');
  await client.callTool({ name: 'paper_respond', arguments: { job: pending.id, answer: '论文强调依据原文进行证据核验 [p.1]。' } });
  const events = (await response.text()).trim().split('\n').map(JSON.parse); assert.equal(events.at(-1).type, 'done');
  assert.match(events.at(-1).message.answer, /证据核验/);
  console.log(JSON.stringify({ ok: true, checks: ['standalone ZIP', 'Agent skill directory install', 'clean npm ci --omit=dev', 'arbitrary working directory', 'headless PDF import/read',
    'headless real OCR', 'host model prepare/complete without API key', 'MCP initialize/tools/call', 'source-checked annotations', 'visual MCP image', 'standalone reader assets', 'reader-to-host question bridge'],
    installedDependenciesOnly: true, isolation: 'temporary folder outside the repository; no parent package or NODE_PATH', platform: process.platform }, null, 2));
} finally {
  await client?.close();
  if (child && child.exitCode === null) { const ended = new Promise((done) => child.once('exit', done)); child.kill(); await ended; }
  if (resolve(temp).startsWith(resolve(tmpdir()) + sep) && dirname(temp) === resolve(tmpdir()) && temp.includes('paper-portability-')) await rm(temp, { recursive: true, force: true });
}
