import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { completion, endpointUrl } from '../lib/model.js';
import { comparisonCitations, comparisonContext, validateOcr, validRect, imageBytes } from '../lib/advanced.js';
import { createReaderServer } from '../lib/server.js';
import { fixturePdf, PAGES } from './fixture.mjs';

test('OCR 校验保留置信度和定位并拒绝越界', () => {
  const input = { page: 1, text: 'Evidence reading', confidence: 88, language: 'eng', words: [{ text: 'Evidence', confidence: 90, x: .1, y: .2, width: .3, height: .1 }] };
  assert.equal(validateOcr(input, 2).words[0].text, 'Evidence');
  for (const patch of [{ page: 0 }, { confidence: 101 }, { language: 'unknown' }, { words: [{ text: 'x', x: 1, y: 0, width: .1, height: .1 }] }]) assert.throws(() => validateOcr({ ...input, ...patch }, 2));
  assert.throws(() => validRect({ x: -.1, y: 0, width: 1, height: 1 }));
  assert.throws(() => imageBytes('https://external.example/image.png'));
  assert.throws(() => imageBytes('data:image/png;base64,YWJj'));
});

test('多篇来源同时校验论文标识和页码，不混用同页号', () => {
  const papers = [{ id: 'a', name: 'A', pages: PAGES }, { id: 'b', name: 'B', pages: PAGES }];
  const contexts = comparisonContext(papers, 'method');
  assert.ok(contexts.some((c) => c.tag === 'D1') && contexts.some((c) => c.tag === 'D2'));
  const result = comparisonCitations('A [D1:p.1] B [D2:p.1] 假来源 [D3:p.1] 假页 [D1:p.99] 不明确 [p.1]', contexts);
  assert.equal(result.citations.length, 2); assert.equal(result.citations[1].paperId, 'b');
  assert.match(result.text, /未核验来源/); assert.match(result.text, /缺少论文标识/);
});

test('Ollama 只能使用回环，原生流与图像转换完整且遵守授权', async () => {
  assert.equal(endpointUrl('http://localhost:11434/api', 'ollama'), 'http://localhost:11434/api/chat');
  assert.throws(() => endpointUrl('https://external.example', 'ollama'), /回环/);
  let calls = 0;
  const config = { protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'test', consent: true };
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'Explain' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,YWJj' } }] }];
  await assert.rejects(completion(config, messages, { fetchImpl: () => { calls++; } }), /授权/);
  assert.equal(calls, 0);
  const output = [];
  const answer = await completion({ ...config, vision: true, imageConsent: true }, messages, { onToken: (t) => output.push(t), fetchImpl: async (_url, options) => {
    const payload = JSON.parse(options.body); assert.deepEqual(payload.messages[0].images, ['YWJj']); assert.equal(payload.messages[0].content, 'Explain');
    return new Response('{"message":{"content":"本机"},"done":false}\n{"message":{"content":"回答"},"done":true}\n', { headers: { 'content-type': 'application/x-ndjson' } });
  } });
  assert.equal(answer, '本机回答'); assert.equal(output.join(''), answer);
  await assert.rejects(completion(config, [{ role: 'user', content: 'x' }], { onToken() {}, fetchImpl: async () => new Response('{"message":{"content":"partial"}}\n') }), /不完整/);
});

test('OCR 持久化、重译失效、视觉授权及对照保存 API', async () => {
  const root = await mkdtemp(join(tmpdir(), 'paper-stage3-'));
  const instance = await createReaderServer({ dataDir: root, fetchImpl: async () => new Response('data: {"choices":[{"delta":{"content":"A [D1:p.1] B [D2:p.1]"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }) });
  const base = new URL(instance.url).origin;
  const first = await fetch(instance.url, { redirect: 'manual' }); const cookie = first.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json' };
  const post = (path, input) => fetch(base + path, { method: 'POST', headers, body: JSON.stringify(input) });
  try {
    const paper = await instance.store.importPdf(fixturePdf(), 'a.pdf'); await instance.store.setPages(paper.id, PAGES);
    await instance.store.update(paper.id, (p) => { p.translation = 'previous'; });
    const ocr = { page: 1, language: 'eng', confidence: 80, text: 'Abstract A corrected text with enough context for an evidence reading study. Keywords: study', words: [] };
    assert.equal((await post(`/api/papers/${paper.id}/ocr`, ocr)).status, 400);
    const saved = await (await post(`/api/papers/${paper.id}/ocr`, { ...ocr, overwrite: true })).json();
    assert.equal(saved.pages[0].ocr.confidence, 80); assert.equal(saved.translation, '');
    assert.equal((await post(`/api/papers/${paper.id}/visual`, { page: 1 })).status, 400);
    const second = await instance.store.importPdf(Buffer.concat([fixturePdf(), Buffer.from('\n%second')]), 'b.pdf'); await instance.store.setPages(second.id, PAGES);
    await post('/api/config', { baseUrl: 'https://test.example/v1', model: 'test', consent: true });
    const result = await post('/api/compare', { paperIds: [paper.id, second.id], question: '比较方法' });
    const events = (await result.text()).trim().split('\n').map(JSON.parse);
    assert.equal(events.at(-1).type, 'done'); assert.equal(events.at(-1).comparison.citations.length, 2);
    assert.equal((await (await fetch(base + '/api/comparisons', { headers })).json()).length, 1);
    assert.equal((await post('/api/compare', { paperIds: [paper.id, paper.id] })).status, 400);
  } finally { await instance.close(); await rm(root, { recursive: true, force: true }); }
});

test('本地模型列表实际经回环 HTTP 检测且不要求云端 Key', async () => {
  const mock = createServer((req, res) => { assert.equal(req.url, '/api/tags'); assert.equal(req.headers.authorization, undefined); res.setHeader('content-type', 'application/json'); res.end('{"models":[{"name":"local-test"}]}'); });
  await new Promise((done) => mock.listen(0, '127.0.0.1', done));
  const root = await mkdtemp(join(tmpdir(), 'paper-local-model-')); const instance = await createReaderServer({ dataDir: root });
  try {
    const base = new URL(instance.url).origin; const first = await fetch(instance.url, { redirect: 'manual' });
    const response = await fetch(base + '/api/models', { method: 'POST', headers: { cookie: first.headers.get('set-cookie').split(';')[0], 'content-type': 'application/json' }, body: JSON.stringify({ protocol: 'ollama', baseUrl: `http://127.0.0.1:${mock.address().port}` }) });
    assert.deepEqual((await response.json()).models, ['local-test']);
  } finally { await instance.close(); await new Promise((done) => mock.close(done)); await rm(root, { recursive: true, force: true }); }
});

test('图式解读必须单次确认，验证 PNG 并持久化区域和限定页码', async () => {
  const root = await mkdtemp(join(tmpdir(), 'paper-vision-')); let sent = 0;
  const instance = await createReaderServer({ dataDir: root, fetchImpl: async (_url, options) => {
    sent++; const payload = JSON.parse(options.body);
    assert.equal(payload.messages.at(-1).content[1].type, 'image_url');
    return new Response(JSON.stringify({ choices: [{ message: { content: '符号需结合假设理解 [p.1]，未知引用 [p.99]' } }] }), { headers: { 'content-type': 'application/json' } });
  } });
  try {
    const base = new URL(instance.url).origin; const first = await fetch(instance.url, { redirect: 'manual' });
    const cookie = first.headers.get('set-cookie').split(';')[0]; const headers = { cookie, 'content-type': 'application/json' };
    const post = (path, input) => fetch(base + path, { method: 'POST', headers, body: JSON.stringify(input) });
    const paper = await instance.store.importPdf(fixturePdf(), 'vision.pdf'); await instance.store.setPages(paper.id, PAGES);
    await post('/api/config', { baseUrl: 'https://test.example/v1', model: 'vision-test', consent: true, vision: true, imageConsent: true });
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    const input = { page: 1, kind: 'formula', rect: { x: .1, y: .1, width: .2, height: .2 }, image, question: '解释公式' };
    assert.equal((await post(`/api/papers/${paper.id}/visual`, input)).status, 400); assert.equal(sent, 0);
    const response = await post(`/api/papers/${paper.id}/visual`, { ...input, confirmImage: true });
    const last = (await response.text()).trim().split('\n').map(JSON.parse).at(-1);
    assert.equal(last.type, 'done'); assert.match(last.visual.answer, /未核验页码/); assert.equal(sent, 1);
    assert.equal((await instance.store.read(paper.id)).visuals.length, 1);
    const saved = await fetch(base + `/api/papers/${paper.id}/visual/${last.visual.id}.png`, { headers });
    assert.equal(saved.headers.get('content-type'), 'image/png'); assert.ok((await saved.arrayBuffer()).byteLength > 30);
  } finally { await instance.close(); await rm(root, { recursive: true, force: true }); }
});
