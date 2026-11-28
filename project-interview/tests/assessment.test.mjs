import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, question, evaluation } from './helpers.mjs';

test('simulation hides feedback until ended, validates actual answer/citations and computes its own scores', async t => {
  const { app, snapshot, project, temp } = await fixture(t);
  const session = await app.start({ snapshot: snapshot.id, rounds: 1 });
  const q = await app.prepare(session.id); await app.question(session.id,q.job.id,question(q));
  await assert.rejects(app.prepareReview(session.id,1),/结束/);
  await assert.rejects(app.prepareHint(session.id),/仅学习/);
  await app.answer(session.id,'进程内缓存简单，但没有容量上限，持续写入需要监控内存。');
  const prepared = await app.prepareReview(session.id,1), result = evaluation(prepared);
  const forged = structuredClone(result); forged.dimensions.accuracy.answerQuote = '用户从未说过的长句';
  await assert.rejects(app.review(session.id,prepared.job.id,forged),/原样引用/);
  const wrongSource = structuredClone(result); wrongSource.evidence[0].quote = 'not present in indexed code';
  await assert.rejects(app.review(session.id,prepared.job.id,wrongSource),/原样匹配/);
  // Assess against the exact historical code even if the project subsequently changes.
  await writeFile(join(project,'server.mjs'),'export const updated = true;\n');
  await app.review(session.id,prepared.job.id,result);
  await assert.rejects(app.review(session.id,prepared.job.id,result),/过期/);
  const report = await app.report(session.id);
  assert.equal(report.complete,true); assert.equal(report.metrics.practiceScore100,75); assert.equal(report.independentMetrics.practiceScore100,75);
  assert.equal(report.turns[0].review.historicalSnapshot,true);
  await app.exportReport(session.id,join(temp,'report.json'));
  assert.equal(JSON.parse(await readFile(join(temp,'report.json'),'utf8')).metrics.practiceScore100,75);
  await app.exportReport(session.id,join(temp,'report.md'));
  assert.ok((await readFile(join(temp,'report.md'),'utf8')).includes('独立作答总分'));
  await assert.rejects(app.exportReport(session.id,join(temp,'report.md')), error => error.code === 'EEXIST');
  await assert.rejects(app.exportReport(session.id,join(project,'private.md')),/不能导出/);
});
test('progressive learning hints are recorded and assisted answers do not count as independent understanding', async t => {
  const { app, snapshot } = await fixture(t);
  const session = await app.start({ snapshot: snapshot.id, mode: 'learning', rounds: 2 });
  const q = await app.prepare(session.id); await app.question(session.id,q.job.id,question(q));
  await assert.rejects(app.prepareHint(session.id,2),/逐级/);
  for (const level of [1,2,3]) {
    const prepared = await app.prepareHint(session.id,level), source = prepared.evidence[0];
    await app.hint(session.id,prepared.job.id,{ hint: `第${level}级：考虑 Map 的生命周期、容量和验证。`, evidence: [{ id: source.id, quote: source.text }] });
  }
  await assert.rejects(app.prepareHint(session.id,3),/逐级/);
  await app.answer(session.id,'根据提示，我会为 Map 设置容量上限并跟踪条目数。');
  const prepared = await app.prepareReview(session.id,1);
  // A review task must not be reusable as a question task at the same revision.
  await assert.rejects(app.question(session.id,prepared.job.id,question({ evidence: prepared.evidence })),/过期/);
  await app.review(session.id,prepared.job.id,evaluation(prepared,4));
  await app.transition(session.id,'end');
  const report = await app.report(session.id);
  assert.equal(report.turns[0].hints.length,3); assert.equal(report.turns[0].assisted,true);
  assert.equal(report.metrics.practiceScore100,100); assert.equal(report.independentMetrics.practiceScore100,null);
});
test('untested dimensions stay null, unknown short answers can be assessed and incomplete reports have no overall score', async t => {
  const { app, snapshot } = await fixture(t);
  const session = await app.start({ snapshot: snapshot.id, mode: 'learning', rounds: 2 });
  const q = await app.prepare(session.id); await app.question(session.id,q.job.id,question(q));
  await app.answer(session.id,'不懂');
  const prepared = await app.prepareReview(session.id,1), result = evaluation(prepared,0);
  result.dimensions.tradeoffs = { score: null, reason: '尚未得到可用于判断该维度的回答', answerQuote: null };
  result.dimensions.failureReasoning = { score: null, reason: '本轮没有考察诊断方法' };
  await app.review(session.id,prepared.job.id,result);
  const next = await app.prepare(session.id);
  await app.question(session.id,next.job.id,{ ...question(next), question: '你说不懂，能否先指出读取缓存的那一行？', answerQuote: '不懂', rationale: '从最小代码定位开始' });
  // A short honest answer still supports a followup; never invent its next answer.
  await app.transition(session.id,'end');
  const report = await app.report(session.id);
  assert.equal(report.metrics.dimensions.accuracy.score,0); assert.equal(report.metrics.dimensions.tradeoffs.score,null); assert.equal(report.metrics.practiceScore100,null);
  const empty = await app.start({ snapshot: snapshot.id }); await app.transition(empty.id,'end');
  assert.equal((await app.report(empty.id)).complete,false);
});
test('unreviewed or unanswered rounds are explicit, not silently scored, and exports neutralize markup', async t => {
  const { app, snapshot, temp } = await fixture(t);
  const session = await app.start({ snapshot: snapshot.id, rounds: 2 });
  const q = await app.prepare(session.id); await app.question(session.id,q.job.id,{ ...question(q), question: '<img src=x> ![x](https://example.invalid/track)' });
  await app.answer(session.id,'我知道缓存没有容量限制，但尚未设计验证方案。');
  const next = await app.prepare(session.id);
  await app.question(session.id,next.job.id,{ ...question(next), question: '在没有容量限制的情况下，你如何设计验证方案？', answerQuote: '尚未设计验证方案', rationale: '检验回答中承认的缺口', kind: 'testing' });
  await app.transition(session.id,'end');
  const review = await app.prepareReview(session.id,1); await app.review(session.id,review.job.id,evaluation(review,4));
  const report = await app.report(session.id);
  assert.deepEqual(report.unanswered,[2]); assert.equal(report.complete,false); assert.equal(report.metrics.practiceScore100,null);
  await app.exportReport(session.id,join(temp,'safe.md')); const markdown = await readFile(join(temp,'safe.md'),'utf8');
  assert.ok(!markdown.includes('<img')); assert.ok(!markdown.includes('![x]('));
});
