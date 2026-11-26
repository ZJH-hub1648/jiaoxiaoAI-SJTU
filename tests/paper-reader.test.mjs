import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abstractOf, checkedCitations, contextFor, validateNotes, validPages } from '../Paper reading assistance/lib/paper.js';
import { completion, endpointUrl, sseData } from '../Paper reading assistance/lib/model.js';
import { createStore } from '../Paper reading assistance/lib/store.js';
import { createReaderServer } from '../Paper reading assistance/lib/server.js';
import { fixturePdf, PAGES, QUOTE, mockFetch } from '../Paper reading assistance/tests/fixture.mjs';

test('论文摘要、页码检索与原文注释校验', () => {
  const abstract = abstractOf(PAGES);
  assert.equal(abstract.page, 1); assert.match(abstract.text, /^We propose/); assert.doesNotMatch(abstract.text, /Keywords/);
  assert.equal(contextFor(PAGES, 'limitations', 2)[0].page, 2);
  assert.equal(validateNotes([{ quote: QUOTE, explanation: '解读' }], PAGES, 1).length, 1);
  assert.throws(() => validateNotes([{ quote: 'fabricated quote', explanation: '错误' }], PAGES, 1), /未能对应/);
  assert.throws(() => validPages([{ number: 2, text: 'wrong' }]), /页码/);
  const checked = checkedCitations('真实 [p.1] 虚构 [p.99]', [{ page: 1, text: QUOTE }]);
  assert.match(checked.text, /未核验页码/); assert.deepEqual(checked.citations.map((c) => c.page), [1]);
});

test('模型地址、同意边界和错误不泄露密钥', async () => {
  for (const url of ['http://evil.example/v1', 'https://user:secret@model.example/v1', 'https://model.example/v1?key=secret']) assert.throws(() => endpointUrl(url));
  assert.equal(endpointUrl('http://127.0.0.1:1234/v1'), 'http://127.0.0.1:1234/v1/chat/completions');
  let called = false;
  await assert.rejects(completion({ consent: false }, [], { fetchImpl: () => { called = true; } }), /允许/);
  assert.equal(called, false);
  await assert.rejects(completion({ consent: true, model: 'test', apiKey: 'secret', baseUrl: 'https://model.example/v1' }, [], { fetchImpl: async () => new Response('secret', { status: 401 }) }), (error) => /401/.test(error.message) && !error.message.includes('secret'));
});

test('SSE 解析保留跨数据块中文与 CRLF 边界', async () => {
  const input = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"中文"}}]}\r\n\r\ndata: [DONE]\r\n\r\n');
  const stream = new ReadableStream({ start(controller) { for (const byte of input) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  const output = []; for await (const frame of sseData(stream)) output.push(frame);
  assert.equal(JSON.parse(output[0]).choices[0].delta.content, '中文'); assert.equal(output[1], '[DONE]');
});

test('模型流异常中断不会被当成完整回答', async () => {
  const config = { consent: true, baseUrl: 'https://model.example/v1', model: 'test' };
  await assert.rejects(completion(config, [], {
    onToken() {}, fetchImpl: async () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', { headers: { 'content-type': 'text/event-stream' } }),
  }), /未保存不完整/);
});

test('论文保存、并发笔记、阅读位置与重开恢复', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jx-paper-store-'));
  try {
    const store = await createStore(root); const paper = await store.importPdf(fixturePdf(), 'test.pdf');
    await store.setPages(paper.id, PAGES);
    await Promise.all(Array.from({ length: 5 }, (_, index) => store.addNote(paper.id, { page: 1, quote: QUOTE, body: `笔记${index}` })));
    await store.update(paper.id, (p) => { p.position = { page: 2, zoom: 1.25 }; });
    const reopened = await createStore(root); const restored = await reopened.read(paper.id);
    assert.equal(restored.notes.length, 5); assert.equal(restored.position.page, 2);
    assert.equal((await reopened.importPdf(fixturePdf(), 'another-name.pdf')).notes.length, 5);
    assert.deepEqual(await reopened.pdf(paper.id), fixturePdf());
    await assert.rejects(store.addNote(paper.id, { page: 1, quote: 'not in source' }), /原文/);
    assert.throws(() => store.directory('../escape'), /标识/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('阅读器 API：会话、导入、模型配置、流式翻译注释问答与导出', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jx-paper-api-'));
  const instance = await createReaderServer({ dataDir: root, session: 'test-reader', fetchImpl: mockFetch });
  const base = new URL(instance.url).origin;
  const first = await fetch(instance.url, { redirect: 'manual' });
  const cookie = first.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json' };
  const post = (path, input) => fetch(base + path, { method: 'POST', headers, body: JSON.stringify(input) });
  try {
    assert.equal((await fetch(base + '/api/library')).status, 403);
    assert.equal((await fetch(base + '/api/config', { method: 'POST', headers: { ...headers, origin: 'https://evil.example' }, body: '{}' })).status, 403);
    const imported = await (await fetch(base + '/api/import', { method: 'POST', headers: { cookie, 'x-filename': 'test.pdf' }, body: fixturePdf() })).json();
    const path = `/api/papers/${imported.id}`;
    assert.equal((await post(path + '/pages', { pages: PAGES })).status, 200);
    assert.equal((await post(path + '/ask', { question: '研究问题？' })).status, 400);
    const config = await (await post('/api/config', { baseUrl: 'https://model.example/v1', model: 'test', apiKey: 'never-return-key', consent: true })).text();
    assert.doesNotMatch(config, /never-return-key/); assert.match(config, /keyConfigured/);
    for (const action of ['translate', 'annotate', 'ask']) {
      const response = await post(path + '/' + action, { page: 1, question: '研究局限是什么？' });
      const frames = (await response.text()).trim().split('\n').map(JSON.parse);
      assert.equal(frames.at(-1).type, 'done', JSON.stringify(frames));
    }
    const paper = await (await fetch(base + path, { headers })).json();
    assert.ok(paper.translation); assert.equal(paper.notes.length, 1); assert.equal(paper.messages.length, 1);
    assert.deepEqual(paper.messages[0].citations.map((c) => c.page), [1, 2]);
    assert.equal((await post(path + '/position', { page: 99, zoom: 1 })).status, 400);
    const exported = await (await fetch(base + path + '/export', { headers })).text();
    assert.match(exported, /证据与解释/); assert.match(exported, /p\.2/);
    assert.doesNotMatch(await (await fetch(base + '/api/config', { headers })).text(), /never-return-key/);
    assert.match(await readFile(join(root, 'model.json'), 'utf8'), /never-return-key/);
    const changed = await (await post('/api/config', { baseUrl: 'https://another-model.example/v1', model: 'other', consent: true })).json();
    assert.equal(changed.keyConfigured, false, '换模型服务不得向新域名沿用旧密钥');
  } finally { await instance.close(); await rm(root, { recursive: true, force: true }); }
});
