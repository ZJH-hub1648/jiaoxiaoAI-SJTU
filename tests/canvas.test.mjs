import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { canvasNextPage, createCanvasClient, isPresentation } from '../scripts/lib/canvas.js';
import { stubFetch } from './helpers/fetch.mjs';

function json(value, headers = {}) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json', ...headers } });
}

const signal = new AbortController().signal;

test('Canvas 分页只接受本机 API 地址', () => {
  const next = canvasNextPage('<https://oc.sjtu.edu.cn/api/v1/courses?page=2>; rel="next"');
  assert.equal(next, 'https://oc.sjtu.edu.cn/api/v1/courses?page=2');
  assert.equal(canvasNextPage(null), null);
  assert.throws(() => canvasNextPage('<https://evil.example/api/v1/courses?page=2>; rel="next"'), /地址无效/);
});

test('PPT 识别只匹配 .ppt 与 .pptx 扩展名', () => {
  assert.equal(isPresentation({ display_name: '课件.PPTX' }), true);
  assert.equal(isPresentation({ display_name: '课件.ppt' }), true);
  assert.equal(isPresentation({ display_name: '课件.pdf' }), false);
  assert.equal(isPresentation({ display_name: '课件.pptx.pdf' }), false);
});

test('课程列表跟随 Link 分页并携带 Bearer Token', async () => {
  const calls = [];
  const restore = stubFetch(async (url, init) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, init });
    if (parsed.searchParams.get('page') === '2') {
      return json([{ id: 2, name: '线性代数', course_code: 'MA200', term: { name: '2026 Fall' } }]);
    }
    return json([{ id: 1, name: '机器学习', course_code: 'CS3308', term: { name: '2026 Fall' } }], {
      link: '<https://oc.sjtu.edu.cn/api/v1/courses?page=2>; rel="next"',
    });
  });
  try {
    const client = createCanvasClient({ token: 'secret-token' });
    const courses = await client.listCourses({}, signal);
    assert.equal(courses.length, 2);
    assert.equal(courses[0].term, '2026 Fall');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].init.headers.authorization, 'Bearer secret-token');
    assert.equal(calls[0].url.searchParams.get('enrollment_state'), 'active');
  } finally {
    restore();
  }
});

test('文件列表保留真实 ID、类型与 PPT 标记', async () => {
  const restore = stubFetch(async () => json([
    { id: 11, display_name: '第一章.pptx', 'content-type': 'application/vnd.ms-powerpoint', size: 123, updated_at: '2026-11-01' },
    { id: 12, display_name: '说明.pdf', size: 20 },
  ]));
  try {
    const client = createCanvasClient({ token: 'secret-token' });
    const files = await client.listFiles(7, signal);
    assert.deepEqual(files.map((file) => file.id), [11, 12]);
    assert.equal(files[0].presentation, true);
    assert.equal(files[1].presentation, false);
  } finally {
    restore();
  }
});

test('文件下载跟随校内存储重定向但不转发 Token', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jx-canvas-'));
  const calls = [];
  const restore = stubFetch(async (url, init) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, init });
    if (parsed.pathname === '/api/v1/files/11') {
      return json({ id: 11, display_name: '第一章.pptx', size: 4, url: 'https://oc.sjtu.edu.cn/files/11/download' });
    }
    if (parsed.pathname === '/files/11/download') {
      return new Response(null, { status: 302, headers: { location: 'https://s3.jcloud.sjtu.edu.cn/signed-file' } });
    }
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
  });
  try {
    const client = createCanvasClient({ token: 'secret-token' });
    const saved = await client.downloadFile(11, { id: 7, name: '机器学习' }, directory, signal);
    assert.equal(await readFile(saved.path).then((buffer) => buffer.length), 4);
    assert.match(saved.path, /机器学习 \[7\]/);
    assert.equal(calls[1].init.headers.authorization, 'Bearer secret-token');
    assert.equal(calls[2].init.headers, undefined);
  } finally {
    restore();
    await rm(directory, { recursive: true, force: true });
  }
});

test('文件下载拒绝跳转到未信任域名且外部域名收不到请求', async () => {
  const calls = [];
  const restore = stubFetch(async (url, init) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, init });
    if (parsed.pathname === '/api/v1/files/11') {
      return json({ id: 11, display_name: '第一章.pptx', url: 'https://oc.sjtu.edu.cn/files/11/download' });
    }
    return new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } });
  });
  try {
    const client = createCanvasClient({ token: 'secret-token' });
    await assert.rejects(client.downloadFile(11, { id: 7, name: '机器学习' }, tmpdir(), signal), /不受信任/);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.url.hostname === 'oc.sjtu.edu.cn'));
    assert.ok(calls.every((call) => !String(call.init.headers?.authorization).includes('evil')));
  } finally {
    restore();
  }
});

test('文件元数据中的外部下载地址在请求前被拒绝', async () => {
  const calls = [];
  const restore = stubFetch(async (url, init) => {
    calls.push({ url: new URL(url), init });
    return json({ id: 11, display_name: '第一章.pptx', url: 'https://evil.example/steal' });
  });
  try {
    const client = createCanvasClient({ token: 'secret-token' });
    await assert.rejects(client.downloadFile(11, { id: 7, name: '机器学习' }, tmpdir(), signal), /地址无效/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.hostname, 'oc.sjtu.edu.cn');
  } finally {
    restore();
  }
});

test('Canvas 异常与无效响应不回显服务器敏感正文', async () => {
  const responses = [
    new Response('server-secret-token', { status: 401 }),
    new Response('private-course-content', { status: 200 }),
  ];
  const restore = stubFetch(async () => responses.shift());
  try {
    const client = createCanvasClient({ token: 'secret-token' });
    await assert.rejects(client.checkConnection(signal), (error) => {
      assert.doesNotMatch(error.message, /server-secret-token|private-course-content|secret-token/);
      return /HTTP 401/.test(error.message);
    });
    await assert.rejects(client.checkConnection(signal), (error) => {
      assert.doesNotMatch(error.message, /server-secret-token|private-course-content|secret-token/);
      return /非 JSON/.test(error.message);
    });
  } finally {
    restore();
  }
});

test('未配置 Token 时不发请求并返回安全指引', async () => {
  const client = createCanvasClient();
  await assert.rejects(client.listCourses({}, signal), /CANVAS_ACCESS_TOKEN/);
  await assert.rejects(client.listCourses({}, signal), /不要把 Token 发到聊天中/);
});
