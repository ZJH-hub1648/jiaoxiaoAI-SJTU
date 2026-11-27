import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Interview } from '../lib/core.mjs';

const exec = promisify(execFile), cli = fileURLToPath(new URL('../scripts/interview.mjs', import.meta.url));
async function fixture(t, git = false) {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'project-interview-test-')));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const project = join(temp, 'project with spaces'), data = join(temp, 'private'), resume = join(temp, 'resume.md');
  await mkdir(join(project, 'tests'), { recursive: true });
  await writeFile(join(project, 'server.mjs'), 'const cache = new Map();\nexport function lookup(key) {\n  return cache.get(key);\n}\nexport function store(key, value) { cache.set(key, value); }\n');
  await writeFile(join(project, 'tests/cache.test.mjs'), 'import { lookup, store } from "../server.mjs";\n// cache regression fixture, not executed by the interviewer\n');
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'fixture', main: 'server.mjs', dependencies: { example: '1.0.0' }, scripts: { postinstall: 'THIS MUST NEVER EXECUTE' } }));
  await writeFile(join(project, 'README.md'), '# Cache service\nlookup uses in-memory cache; this describes intent, not verified behavior.\n');
  await writeFile(resume, '- Implemented cache lookup and regression coverage\n- Implemented imaginary Kubernetes autoscaling\n');
  if (git) await exec('git', ['init', project]);
  const tool = new Interview(data), snapshot = await tool.index({ project, resume });
  return { temp, project, data, resume, tool, snapshot };
}
function result(prepared, question = 'lookup 的缓存为什么没有过期策略？', extra = {}) {
  const source = prepared.evidence.find(x => x.path === 'server.mjs') || prepared.evidence[0];
  return { question, kind: 'implementation', evidence: [{ id: source.id, quote: source.text }], ...extra };
}
test('project profile, exact line evidence, resume implementation/test candidates and unknown claims', async t => {
  const { tool, snapshot } = await fixture(t);
  assert.equal(snapshot.coverage.indexedFiles, 4);
  assert.equal(snapshot.profile.manifestSummaries[0].dependencies.example, '1.0.0');
  assert.deepEqual(snapshot.profile.entryCandidates, ['server.mjs']);
  assert.equal(snapshot.claims[0].status, 'unverified');
  assert.ok(snapshot.claims[0].implementationCandidates.length > 0);
  assert.ok(snapshot.claims[0].testCandidates.length > 0);
  assert.deepEqual(snapshot.claims[1].implementationCandidates, []);
  const source = await tool.evidence(snapshot.id, snapshot.claims[0].implementationCandidates.find(key => key));
  assert.ok(source.sha256.length === 64 && source.startLine >= 1 && source.endLine >= source.startLine);
});
test('git ignore, sensitive paths/content, dependencies, symlinks, oversized files and no execution', async t => {
  const { project, temp, tool } = await fixture(t, true);
  await writeFile(join(project, '.gitignore'), 'ignored.mjs\n');
  await writeFile(join(project, 'ignored.mjs'), 'this should not be read');
  await writeFile(join(project, '.env'), 'PRIVATE_VALUE=should-not-leak');
  await writeFile(join(project, 'config.js'), 'const password = "very-secret-real-value";');
  await writeFile(join(project, 'huge.js'), 'a'.repeat(192 * 1024 + 1));
  await mkdir(join(project, 'node_modules')); await writeFile(join(project, 'node_modules/no.js'), 'not-a-source');
  await writeFile(join(temp, 'outside.mjs'), 'external private source');
  try { await symlink(join(temp, 'outside.mjs'), join(project, 'link.mjs')); } catch (e) { if (!['EPERM','EACCES'].includes(e.code)) throw e; }
  const snapshot = await tool.index({ project });
  const value = JSON.stringify(await tool.load('snapshots', snapshot.id));
  for (const marker of ['should-not-leak','very-secret-real-value','not-a-source','external private source','this should not be read']) assert.ok(!value.includes(marker));
  assert.equal(snapshot.discovery, 'git');
  assert.ok(!snapshot.files.some(x => ['ignored.mjs','huge.js','link.mjs','config.js'].includes(x.path)));
});
test('answer-driven followup, persistence, pause/resume, stale jobs and round limit', async t => {
  const { tool, data, snapshot } = await fixture(t);
  const session = await tool.start({ snapshot: snapshot.id, rounds: 2 });
  const first = await tool.prepare(session.id, { query: 'cache lookup' });
  await tool.question(session.id, first.job.id, result(first));
  await assert.rejects(tool.question(session.id, first.job.id, result(first)), /过期/);
  await tool.transition(session.id, 'pause');
  await assert.rejects(tool.answer(session.id, '不能在暂停时回答'), /等待回答/);
  const reloaded = new Interview(data); assert.equal((await reloaded.show(session.id)).state, 'paused');
  assert.equal((await reloaded.transition(session.id, 'resume')).state, 'awaiting-answer');
  await reloaded.answer(session.id, '我使用进程内 Map，但尚未实现容量限制。');
  const second = await reloaded.prepare(session.id);
  assert.equal(second.history[0].answer, '我使用进程内 Map，但尚未实现容量限制。');
  await assert.rejects(reloaded.question(session.id, second.job.id, result(second, '假设流量增加，如何控制内存？')), /answerQuote/);
  await reloaded.question(session.id, second.job.id, result(second, '你提到没有容量限制；假设请求持续增长，会如何排查内存增长？', { answerQuote: '尚未实现容量限制', rationale: '根据回答继续追问资源上限及故障诊断', kind: 'failure' }));
  assert.equal((await reloaded.answer(session.id, '先观察缓存条目数与堆大小，再设计容量和淘汰策略。')).state, 'ended');
  await assert.rejects(reloaded.prepare(session.id), /ready/);
  assert.equal((await reloaded.show(session.id)).turns[1].followup.parentRound, 1);
});
test('reject fabricated citations, changed sources, repeated question and invalidated prepare after pause', async t => {
  const { tool, project, snapshot } = await fixture(t);
  const session = await tool.start({ snapshot: snapshot.id });
  const prepared = await tool.prepare(session.id, { query: 'lookup cache' });
  const invalid = result(prepared); invalid.evidence[0].quote = 'This quote never existed in any indexed source.';
  await assert.rejects(tool.question(session.id, prepared.job.id, invalid), /原样匹配/);
  await tool.transition(session.id, 'pause'); await tool.transition(session.id, 'resume');
  await assert.rejects(tool.question(session.id, prepared.job.id, result(prepared)), /过期/);
  const fresh = await tool.prepare(session.id, { query: 'lookup cache' });
  await writeFile(join(project, 'server.mjs'), 'export const changed = true;\n');
  await assert.rejects(tool.question(session.id, fresh.job.id, result(fresh)), /代码已变化/);
  assert.equal((await tool.show(session.id)).turns.length, 0);
});
test('reject overlapping data, invalid formats/modes/limits, traverse IDs and concurrent writers', async t => {
  const { project, snapshot, tool, resume } = await fixture(t);
  await assert.rejects(new Interview(join(project, 'private')).index({ project }), /不能与项目目录重叠/);
  await assert.rejects(tool.index({ project, resume: resume.replace('.md','.pdf') }), /仅支持/);
  await assert.rejects(tool.start({ snapshot: snapshot.id, rounds: 0 }), /rounds/);
  await assert.rejects(tool.start({ snapshot: snapshot.id, mode: 'unknown' }), /mode/);
  await assert.rejects(tool.show('../../private'), /无效 ID/);
  const session = await tool.start({ snapshot: snapshot.id });
  const results = await Promise.allSettled([tool.transition(session.id,'pause'),tool.transition(session.id,'pause')]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  await tool.transition(session.id, 'end'); assert.equal((await tool.show(session.id)).state,'ended');
});
test('CLI from unrelated cwd, failed inputs nonzero, no dependency install or API required', async t => {
  const { temp, project, data } = await fixture(t);
  const installed = join(temp, 'standalone skill');
  await cp(dirname(dirname(cli)), installed, { recursive: true });
  const run = async args => JSON.parse((await exec(process.execPath, [join(installed,'scripts/interview.mjs'), ...args, '--data-dir',data], { cwd: temp })).stdout);
  const snapshot = await run(['index','--project',project]); assert.equal(snapshot.ok,true);
  const session = await run(['start','--snapshot',snapshot.id,'--mode','learning']);
  const prepared = await run(['prepare','--session',session.id,'--query','cache']);
  assert.equal(prepared.mode,'learning');
  const file = join(temp,'question.json'); await writeFile(file,JSON.stringify(result(prepared)));
  assert.equal((await run(['question','--session',session.id,'--job',prepared.job.id,'--result-file',file])).state,'awaiting-answer');
  const answer = join(temp,'answer.txt'); await writeFile(answer,'我尚不理解该缓存的生命周期，需要先查看数据流。');
  assert.equal((await run(['answer','--session',session.id,'--answer-file',answer])).state,'ready');
  await assert.rejects(run(['start','--snapshot','../../invalid']), e => e.code === 1 && JSON.parse(e.stdout).ok === false);
  const record = JSON.parse(await readFile(join(data,'sessions',`${session.id}.json`),'utf8')); assert.equal(record.turns.length,1);
});
test('exact source line positions, wrong session and duplicate question rejection', async t => {
  const { tool, snapshot } = await fixture(t);
  const source = (await tool.inspect(snapshot.id, 'lookup cache')).evidence.find(x => x.path === 'server.mjs');
  const session = await tool.start({ snapshot: snapshot.id }), other = await tool.start({ snapshot: snapshot.id });
  const prepared = await tool.prepare(session.id, { evidenceIds: [source.id] });
  const question = { question: 'lookup 返回空值时如何区分未命中？', kind: 'implementation', evidence: [{ id: source.id, quote: '  return cache.get(key);' }] };
  await assert.rejects(tool.question(other.id, prepared.job.id, question), /不属于/);
  const accepted = await tool.question(session.id, prepared.job.id, question);
  assert.equal(accepted.turn.evidence[0].startLine, 3); assert.equal(accepted.turn.evidence[0].endLine, 3);
  await tool.answer(session.id, '我需要检查 Map.has 区分未命中与空值。');
  const follow = await tool.prepare(session.id, { evidenceIds: [source.id] });
  await assert.rejects(tool.question(session.id, follow.job.id, { ...question, answerQuote: '检查 Map.has', rationale: '继续追问' }), /问题重复/);
  assert.equal((await tool.show(session.id)).turns.length, 1);
});
test('coverage reports bounded indexes rather than claiming a complete large-project scan', async t => {
  const { tool, project } = await fixture(t);
  await Promise.all(Array.from({ length: 401 }, (_, index) => writeFile(join(project, `module-${index}.mjs`), `export const value${index} = ${index};\n`)));
  const snapshot = await tool.index({ project });
  assert.equal(snapshot.coverage.indexedFiles, 400);
  assert.equal(snapshot.coverage.partial, true);
  assert.ok(snapshot.warnings.some(x => x.includes('上限')));
});
