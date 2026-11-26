import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createReaderServer } from '../lib/server.js';
import { fixturePdf, mockFetch, QUOTE } from './fixture.mjs';

const temp = await mkdtemp(join(tmpdir(), 'jx-reader-browser-'));
const screenshots = resolve('dist', 'reader-qa');
await mkdir(screenshots, { recursive: true });
const instance = await createReaderServer({ dataDir: temp, fetchImpl: async (url, options) => {
  if (JSON.parse(options.body).messages.at(-1).content.includes('测试取消生成')) {
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"正在生成的未完成回答"}}]}\n\n'));
      options.signal.addEventListener('abort', () => controller.error(new Error('cancelled')), { once: true });
    } }), { headers: { 'content-type': 'text/event-stream' } });
  }
  return mockFetch(url, options);
} });
let browser;
const errors = [];
try {
  try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
  catch { browser = await chromium.launch({ headless: true }); }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(instance.url);
  await page.waitForSelector('#choose-pdf');
  await page.screenshot({ path: join(screenshots, 'empty.png'), fullPage: true });
  await page.click('#settings-button');
  await page.fill('#model-base', 'https://mock-model.example/v1');
  await page.fill('#model-name', 'test-model');
  await page.fill('#model-key', 'test-secret-not-real');
  await page.check('#model-consent');
  await page.click('#settings-form button[type=submit]');
  await page.waitForSelector('#settings-dialog', { state: 'hidden' });
  const pdfPath = join(temp, 'evidence-paper.pdf'); await writeFile(pdfPath, fixturePdf());
  await page.setInputFiles('#file-input', pdfPath);
  await page.waitForFunction(() => document.querySelector('#translation-output').textContent.includes('将解释与原文页码关联'));
  await page.waitForSelector('.note-card');
  await page.waitForSelector('#generation-status', { state: 'hidden' });
  assert.equal(await page.locator('#pdf-page canvas').count(), 1);
  assert.ok(await page.locator('.textLayer span').count() > 5, '可选择的 PDF 文字层存在');
  assert.ok(await page.locator('.quote-highlight').count() > 0, 'AI 注释对应原文高亮');

  // Exercise an actual DOM Range selection spanning PDF text, not a fake input.
  await page.evaluate((quote) => {
    const span = [...document.querySelectorAll('.textLayer span')].find((s) => s.textContent.includes(quote));
    if (!span) throw new Error('fixture quote not rendered');
    const start = span.textContent.indexOf(quote); const range = document.createRange();
    range.setStart(span.firstChild, start); range.setEnd(span.firstChild, start + quote.length);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    document.querySelector('#pdf-page').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, QUOTE);
  await page.waitForSelector('#selection-box', { state: 'visible' });
  await page.click('#add-note');
  await page.fill('#note-title', '原文核验'); await page.fill('#note-body', '这段强调引用应能够回到原文，便于独立核对。');
  await page.click('#note-form button[type=submit]');
  await page.waitForSelector('#note-dialog', { state: 'hidden' });
  assert.equal(await page.locator('.note-card').count(), 2);
  await page.click('#explain-selection');
  await page.waitForSelector('.source-links button');
  await page.waitForSelector('#generation-status', { state: 'hidden' });
  assert.ok((await page.locator('.message.answer').innerText()).includes('相关原文片段'));
  const sourcePage2 = page.getByRole('button', { name: 'PDF 第 2 页', exact: true });
  await sourcePage2.click();
  await page.waitForFunction(() => document.querySelector('#page-input').value === '2');
  await page.waitForTimeout(350);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#page-input').value === '2' && !document.querySelector('#ask-button').disabled);
  await page.click('#tab-chat'); assert.equal(await page.locator('.message.answer').count(), 1);
  await page.click('#tab-notes'); assert.equal(await page.locator('.note-card').count(), 2);
  await page.getByText('原文核验', { exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#page-input').value === '1');
  await page.waitForSelector('.quote-highlight.focus');
  await page.screenshot({ path: join(screenshots, 'reading-notes.png'), fullPage: true });

  await page.click('#tab-chat'); await page.fill('#question', '测试取消生成'); await page.click('#ask-button');
  await page.waitForFunction(() => document.querySelector('#messages').textContent.includes('正在生成的未完成回答'));
  await page.click('#cancel-generation'); await page.waitForSelector('#generation-status', { state: 'hidden' });
  assert.equal(await page.locator('.message.answer').count(), 1, '取消后没有保存部分问答');
  const downloadPromise = page.waitForEvent('download'); await page.click('#export-button');
  const download = await downloadPromise; const exportPath = join(temp, 'notes.md'); await download.saveAs(exportPath);
  assert.match(await readFile(exportPath, 'utf8'), /原文核验/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '手机布局没有横向溢出');
  await page.screenshot({ path: join(screenshots, 'mobile.png'), fullPage: true });
  assert.deepEqual(errors, [], '浏览器无未处理脚本异常');
  console.log('Reader browser checks passed: import, PDF canvas/text, translation, AI/user notes, highlights, selection Q&A, citations, restore, cancellation, export, mobile.');
  console.log(`QA screenshots: ${screenshots}`);
} catch (error) {
  if (browser) { const pages = browser.contexts().flatMap((context) => context.pages()); if (pages[0]) { await pages[0].screenshot({ path: join(screenshots, 'failure.png'), fullPage: true }); console.error('Visible error:', await pages[0].locator('#error').textContent()); } }
  throw error;
} finally { await browser?.close(); await instance.close(); await rm(temp, { recursive: true, force: true }); }
