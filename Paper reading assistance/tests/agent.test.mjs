import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgentTools } from '../lib/agent-tools.js';
import { fixturePdf, QUOTE } from './fixture.mjs';

test('无浏览器导入、证据提取、宿主译文与来源校验写回', async () => {
  const root = await mkdtemp(join(tmpdir(), 'paper-agent-test-'));
  try {
    const file = join(root, 'paper.pdf'); await writeFile(file, fixturePdf());
    const tools = await createAgentTools(root); const paper = await tools.execute('import', { file });
    assert.equal(paper.pageCount, 2); assert.match(paper.abstract.text, /We propose/);
    assert.match((await tools.execute('read', { paper: paper.id, page: 2 })).text, /limitations/);
    assert.ok((await tools.execute('search', { paper: paper.id, query: 'evidence' })).results.length);
    const translate = await tools.execute('prepare', { paper: paper.id, task: 'translate' });
    await tools.execute('complete', { job: translate.jobId, result: { translation: '我们提出一种将解读关联到原文页码的阅读助手。' } });
    assert.match((await tools.store.read(paper.id)).translation, /原文页码/);
    await assert.rejects(tools.execute('complete', { job: translate.jobId, result: { translation: 'duplicate' } }), /已完成/);
    const annotate = await tools.execute('prepare', { paper: paper.id, task: 'annotate', page: 1 });
    await assert.rejects(tools.execute('complete', { job: annotate.jobId, result: { notes: [{ title: '坏引用', quote: 'fabricated', explanation: '不保存' }] } }), /未能对应/);
    await tools.execute('complete', { job: annotate.jobId, result: { notes: [{ title: '来源核对', quote: QUOTE, explanation: '回答应关联原文，以便读者核验。' }] } });
    const qa = await tools.execute('prepare', { paper: paper.id, task: 'qa', question: '局限是什么' });
    await tools.store.update(paper.id, (p) => { p.pages[1].text += '\nUpdated source'; });
    await assert.rejects(tools.execute('complete', { job: qa.jobId, result: { answer: 'old answer' } }), /原文已更新/);
    const crop = await tools.execute('prepare', { paper: paper.id, task: 'visual', page: 1, rect: { x: .1, y: .1, width: .5, height: .3 } });
    assert.ok((await readFile(crop.imagePath)).length > 100);
    await tools.execute('complete', { job: crop.jobId, result: { answer: '可见论文内容 [p.1]。' } });
    assert.equal((await tools.store.read(paper.id)).visuals.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
