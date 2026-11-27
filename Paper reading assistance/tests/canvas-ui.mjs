import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReaderServer } from '../lib/server.js';
const root = await mkdtemp(join(tmpdir(), 'paper-canvas-ui-'));
const previous = process.env.SJTU_CANVAS_TOKEN_FILE; process.env.SJTU_CANVAS_TOKEN_FILE = join(root, 'private-token');
let browser; const calls = [];
const instance = await createReaderServer({ dataDir: root, fetchImpl: async (url, options) => {
  calls.push({ url: String(url), method: options.method });
  return options.headers.authorization === 'Bearer fake-valid-token'
    ? new Response('{"id":123,"name":"Test Student"}', { headers: { 'content-type': 'application/json' } })
    : new Response('Do not expose this private server body', { status: 401 });
} });
try {
  try { browser = await chromium.launch({ channel: 'msedge', headless: true }); } catch { browser = await chromium.launch(); }
  const page = await browser.newPage(); await page.goto(instance.url); await page.click('#settings-button');
  await page.locator('.canvas-setup summary').click();
  await page.waitForFunction(() => document.querySelector('#canvas-state').textContent.includes('未配置'));
  assert.equal(calls.length, 0, '打开设置不自动使用 Canvas 凭据请求学校');
  await page.fill('#canvas-token', 'fake-valid-token'); await page.click('#canvas-save');
  await page.waitForFunction(() => document.querySelector('#canvas-result').textContent.includes('连接成功'));
  assert.equal(await page.inputValue('#canvas-token'), ''); assert.equal(await readFile(process.env.SJTU_CANVAS_TOKEN_FILE, 'utf8'), 'fake-valid-token\n');
  await page.fill('#canvas-token', 'fake-invalid-token'); await page.click('#canvas-save');
  await page.waitForFunction(() => document.querySelector('#canvas-result').textContent.includes('401'));
  assert.equal(await readFile(process.env.SJTU_CANVAS_TOKEN_FILE, 'utf8'), 'fake-valid-token\n');
  assert.ok(calls.every((call) => call.method === 'GET' && call.url === 'https://oc.sjtu.edu.cn/api/v1/users/self/profile'));
  assert.doesNotMatch(await page.locator('#canvas-result').textContent(), /private server body/);
  console.log('Canvas UI checks passed: optional setup, no auto-request, successful verification/save, cleared password, safe failure with old Token preserved. No real Canvas account used.');
} finally {
  await browser?.close(); await instance.close(); if (previous === undefined) delete process.env.SJTU_CANVAS_TOKEN_FILE; else process.env.SJTU_CANVAS_TOKEN_FILE = previous;
  await rm(root, { recursive: true, force: true });
}
