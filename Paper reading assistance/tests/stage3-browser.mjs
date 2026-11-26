import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fixturePdf } from './fixture.mjs';
import { createReaderServer } from '../lib/server.js';

function imagePdf(jpeg, width, height) {
  const drawing = Buffer.from('q 612 0 0 396 0 0 cm /Im1 Do Q');
  const objects = [null,
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 396] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>'),
    Buffer.concat([Buffer.from(`<< /Length ${drawing.length} >>\nstream\n`), drawing, Buffer.from('\nendstream')]),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from('\nendstream')]),
  ];
  const pieces = [Buffer.from('%PDF-1.4\n')], offsets = [0]; let offset = pieces[0].length;
  for (let id = 1; id < objects.length; id++) { offsets.push(offset); const piece = Buffer.concat([Buffer.from(`${id} 0 obj\n`), objects[id], Buffer.from('\nendobj\n')]); pieces.push(piece); offset += piece.length; }
  pieces.push(Buffer.from(`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((n) => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
  return Buffer.concat(pieces);
}
const root = await mkdtemp(join(tmpdir(), 'stage3-browser-'));
const output = resolve('dist', 'reader-stage3-qa'); await mkdir(output, { recursive: true });
const modelRequests = [];
const modelServer = createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/api/tags') { res.end('{"models":[{"name":"local-reader-test"}]}'); return; }
  if (req.url !== '/api/chat') { res.statusCode = 404; res.end('{}'); return; }
  const parts = []; for await (const chunk of req) parts.push(chunk);
  const request = JSON.parse(Buffer.concat(parts).toString()); modelRequests.push(request);
  const prompt = request.messages.at(-1).content;
  let content;
  if (request.messages.some((message) => message.images?.length)) content = '这是框选区域的辅助解读：公式的符号和实验假设应结合原文核验，图表只能支持可见趋势，不能推断未显示数据 [p.1]。';
  else if (prompt.includes('论文目录：')) content = 'D1 与 D2 都讨论阅读中的证据核对，但数据与条件不同，不能直接比较数值结果 [D1:p.1] [D2:p.1]。';
  else if (prompt.includes('忠实翻译')) content = '我们研究本地阅读助手，在回答前核对证据。';
  else content = '本机接口回答：需要回到原文核验依据 [p.1]。';
  res.setHeader('content-type', 'application/x-ndjson');
  res.end(JSON.stringify({ message: { content }, done: true }) + '\n');
});
await new Promise((done) => modelServer.listen(0, '127.0.0.1', done));
const instance = await createReaderServer({ dataDir: root });
let browser; const errors = [];
try {
  try { browser = await chromium.launch({ channel: 'msedge', headless: true }); } catch { browser = await chromium.launch(); }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(20000);
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(instance.url); await page.uncheck('#auto-analyze');
  await page.click('#settings-button'); await page.click('#preset-ollama');
  await page.fill('#model-base', `http://127.0.0.1:${modelServer.address().port}`); await page.click('#detect-models');
  await page.waitForFunction(() => document.querySelector('#model-detection').textContent.includes('连接成功'));
  assert.equal(await page.inputValue('#model-name'), 'local-reader-test');
  await page.check('#model-consent'); await page.check('#model-vision'); await page.check('#image-consent');
  await page.click('#settings-form button[type=submit]'); await page.waitForSelector('#settings-dialog', { state: 'hidden' });

  await page.setInputFiles('#file-input', { name: 'Text evidence.pdf', mimeType: 'application/pdf', buffer: fixturePdf() });
  await page.waitForFunction(() => !document.querySelector('#ocr-page').disabled);
  assert.equal(modelRequests.length, 0, '未开启自动解读，不自动调用模型');
  const jpegUrl = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1600; c.height = 1000; const ctx = c.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, c.width, c.height); ctx.fillStyle = 'black'; ctx.font = '40px Arial';
    const lines = ['SCANNED READING STUDY', 'Abstract', 'We study a local reading assistant.', 'The method checks evidence before answering.', 'Keywords: reading, evidence', 'Results', 'Accuracy = 0.92 in a small pilot study.', 'Figure 1. Evidence improves with review.', '本地识别 阅读论文并核验证据'];
    lines.forEach((line, i) => ctx.fillText(line, 80, 110 + i * 90)); return c.toDataURL('image/jpeg', 1);
  });
  const scan = imagePdf(Buffer.from(jpegUrl.split(',')[1], 'base64'), 1600, 1000);
  await page.setInputFiles('#file-input', { name: 'Scanned evidence.pdf', mimeType: 'application/pdf', buffer: scan });
  await page.waitForFunction(() => document.querySelector('#paper-title').textContent === 'Scanned evidence.pdf' && !document.querySelector('#ocr-page').disabled);
  assert.equal(await page.locator('#text-layer span').count(), 0, '扫描 PDF 没有隐藏的原生文字');
  await page.selectOption('#ocr-language', 'eng+chi_sim'); await page.click('#ocr-page');
  await page.waitForSelector('#ocr-dialog', { state: 'visible', timeout: 120000 });
  const recognized = await page.inputValue('#ocr-text');
  assert.match(recognized, /reading assistant/i); assert.match(recognized, /evidence/i);
  assert.match(recognized.replace(/\s/g, ''), /本地识别/);
  assert.match(await page.locator('#ocr-confidence').textContent(), /置信度/);
  await page.click('#ocr-form button[type=submit]'); await page.waitForSelector('#ocr-dialog', { state: 'hidden' });
  await page.waitForSelector('.ocr-text-layer span'); assert.ok(await page.locator('.ocr-text-layer span').count() > 20);
  const savedLibrary = await instance.store.list(); const scanRecord = savedLibrary.find((p) => p.name === 'Scanned evidence.pdf');
  const savedScan = await instance.store.read(scanRecord.id); assert.ok(savedScan.pages[0].ocr.confidence > 50); assert.ok(savedScan.abstract.detected);
  await page.click('#translate-button'); await page.waitForFunction(() => document.querySelector('#translation-output').textContent.includes('回答前核对证据'));
  await page.waitForSelector('#generation-status', { state: 'hidden' });
  await page.evaluate(() => {
    const span = document.querySelector('.ocr-text-layer span'); const range = document.createRange(); range.selectNodeContents(span);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range); document.querySelector('#pdf-page').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.click('#add-note'); await page.fill('#note-body', 'OCR 原文定位测试'); await page.click('#note-form button[type=submit]');
  await page.waitForSelector('#note-dialog', { state: 'hidden' }); await page.waitForSelector('.quote-highlight');
  await page.click('#region-tool'); const rect = await page.locator('#region-selector').boundingBox();
  await page.mouse.move(rect.x + rect.width * .05, rect.y + rect.height * .2); await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * .9, rect.y + rect.height * .72, { steps: 8 }); await page.mouse.up();
  await page.waitForSelector('#region-dialog', { state: 'visible' });
  const beforeSend = modelRequests.length; assert.ok((await page.locator('#region-preview').getAttribute('src')).startsWith('data:image/png;base64,'));
  assert.equal(modelRequests.length, beforeSend, '预览图像不自动发送');
  await page.selectOption('#region-kind', 'figure'); await page.check('#region-consent'); await page.click('#region-form button[type=submit]');
  await page.waitForSelector('.visual-card'); await page.waitForSelector('#generation-status', { state: 'hidden' });
  assert.ok(modelRequests.some((request) => request.messages.some((m) => m.images?.length === 1)));
  await page.screenshot({ path: join(output, 'ocr-and-visual.png'), fullPage: true });
  await page.click('#compare-papers'); await page.waitForSelector('#compare-dialog', { state: 'visible' });
  for (const option of await page.locator('#compare-options input').all()) await option.check();
  await page.click('#compare-submit'); await page.waitForSelector('#compare-sources button');
  assert.equal(await page.locator('#compare-sources button').count(), 2);
  assert.match(await page.locator('#compare-output').textContent(), /不能直接比较/);
  await page.screenshot({ path: join(output, 'comparison.png'), fullPage: true });
  await page.locator('#compare-sources button').filter({ hasText: 'Text evidence.pdf' }).click();
  await page.waitForFunction(() => document.querySelector('#paper-title').textContent === 'Text evidence.pdf');
  await page.reload(); await page.waitForFunction(() => !document.querySelector('#compare-papers').disabled);
  await page.click('#compare-papers'); await page.locator('#compare-dialog details summary').click(); await page.waitForSelector('#comparison-history button');
  await page.locator('#comparison-history button').first().click(); assert.equal(await page.locator('#compare-sources button').count(), 2);
  await page.locator('#compare-dialog [data-close]').click();
  await page.getByRole('button', { name: /Scanned evidence\.pdf.*1 页/ }).click();
  await page.waitForFunction(() => document.querySelector('#paper-title').textContent === 'Scanned evidence.pdf' && !document.querySelector('#ocr-page').disabled);
  await page.click('#ocr-page'); await page.click('#cancel-generation'); await page.waitForSelector('#generation-status', { state: 'hidden' });
  assert.equal((await instance.store.read(scanRecord.id)).pages[0].ocr.text, savedScan.pages[0].ocr.text, '取消重新识别不覆盖已保存结果');
  assert.deepEqual(errors, [], '无未处理浏览器异常');
  console.log('Stage 3 browser checks passed: real local OCR + selectable positions + abstract, native local transport, image crop/consent, multi-paper citations + navigation + restored comparison.');
  console.log(`QA screenshots: ${output}`);
} catch (err) {
  const page = browser?.contexts()[0]?.pages()[0]; if (page) { await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }); console.error('Visible error:', await page.locator('#error').textContent()); console.error('Browser errors:', errors); }
  throw err;
} finally { await browser?.close(); await instance.close(); await new Promise((done) => modelServer.close(done)); await rm(root, { recursive: true, force: true }); }
