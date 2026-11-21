import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBrowserSession } from '../scripts/lib/browser.js';
import {
  createClassroomApi,
  formatSegments,
  parseTranscript,
  readTranscriptRange,
  searchTranscript,
  timestamp,
} from '../scripts/lib/classroom.js';

const signal = new AbortController().signal;

const transcript = parseTranscript({
  afterAssemblyList: [
    { bg: 1000, ed: 2500, res: ' 第一段 ' },
    { bg: 3000, ed: 4000, res: '第二段' },
    { bg: 301000, ed: 302000, res: '后续段' },
  ],
}, 42);

test('文稿解析会清理文本、排序并保留毫秒时间', () => {
  assert.equal(transcript.videoId, 42);
  assert.equal(transcript.segments[0].text, '第一段');
  assert.equal(timestamp(302000), '00:05:02.000');
  assert.match(formatSegments(transcript.segments), /\[00:00:01\.000–00:00:02\.500\] 第一段/);
  assert.equal(parseTranscript(null, 42), null);
  assert.throws(() => parseTranscript({ afterAssemblyList: [{ bg: -1, ed: 2, res: '坏数据' }] }, 42), /格式已变化/);
});

test('按时间读取返回重叠完整段落并支持续读', () => {
  const result = readTranscriptRange(transcript, { startSeconds: 0, endSeconds: 5, maxChars: 200 });
  assert.equal(result.matched, 2);
  assert.match(result.text, /第一段/);
  assert.match(result.text, /第二段/);
  assert.equal(result.nextOffset, null);
  assert.equal(result.nextStartSeconds, 4);

  const later = readTranscriptRange(transcript, { startSeconds: 300, endSeconds: 305 });
  assert.match(later.text, /后续段/);
  assert.equal(later.nextStartSeconds, null);
});

test('文稿字符分页使用 nextOffset 保持原区间', () => {
  const first = readTranscriptRange(transcript, { startSeconds: 0, endSeconds: 5, maxChars: 200 });
  assert.ok(first);
  const paged = readTranscriptRange(transcript, { startSeconds: 0, endSeconds: 5, maxChars: 200 });
  assert.equal(paged.offset, 0);
  const longTranscript = {
    videoId: 42,
    segments: Array.from({ length: 4 }, (_, index) => ({ startMs: index * 1000, endMs: index * 1000 + 900, text: '长'.repeat(180) })),
  };
  const page = readTranscriptRange(longTranscript, { startSeconds: 0, endSeconds: 5, maxChars: 200 });
  assert.equal(page.returned, 1);
  assert.equal(page.nextOffset, 1);
  const rest = readTranscriptRange(longTranscript, { startSeconds: 0, endSeconds: 5, maxChars: 200, offset: page.nextOffset });
  assert.equal(rest.offset, 1);
  assert.equal(rest.returned, 1);
});

test('单次读取拒绝超过 15 分钟', () => {
  assert.throws(() => readTranscriptRange(transcript, { startSeconds: 0, endSeconds: 901 }), /不超过 15 分钟/);
});

test('单录像搜索忽略大小写并只返回分页命中的完整段落', () => {
  const searchable = {
    videoId: 42,
    segments: [
      { startMs: 1000, endMs: 2500, text: 'Gradient 消失的原因' },
      { startMs: 5000, endMs: 6500, text: '这里讨论激活函数' },
      { startMs: 9000, endMs: 10500, text: '再次说明 gradient 问题' },
    ],
  };
  const first = searchTranscript(searchable, { query: '  GRADIENT  ', limit: 1 });
  assert.equal(first.query, 'GRADIENT');
  assert.equal(first.total, 2);
  assert.equal(first.offset, 0);
  assert.equal(first.limit, 1);
  assert.equal(first.nextOffset, 1);
  assert.equal(first.results.length, 1);
  assert.equal(first.results[0].startMs, 1000);
  assert.equal(first.results[0].startTime, '00:00:01.000');
  assert.match(first.results[0].text, /Gradient/);
  assert.doesNotMatch(JSON.stringify(first), /激活函数/);

  const second = searchTranscript(searchable, { query: 'gradient', offset: first.nextOffset, limit: 1 });
  assert.equal(second.nextOffset, null);
  assert.equal(second.results[0].startMs, 9000);
});

test('单录像搜索区分零匹配并校验查询和分页参数', () => {
  const noMatch = searchTranscript(transcript, { query: '不存在的关键词' });
  assert.equal(noMatch.total, 0);
  assert.deepEqual(noMatch.results, []);
  assert.equal(noMatch.nextOffset, null);

  assert.throws(() => searchTranscript(transcript, { query: '   ' }), /不能为空/);
  assert.throws(() => searchTranscript(transcript, { query: '第一', limit: 51 }), /limit/);
  assert.throws(() => searchTranscript(transcript, { query: '第一', offset: -1 }), /offset/);
});

test('课堂课程合并当前学期两个来源并按 ID 去重', async () => {
  const urls = [];
  const api = createClassroomApi({
    async requestJson(url) {
      const parsed = new URL(url);
      urls.push(parsed.href);
      if (parsed.pathname.endsWith('/list/termYear')) return { code: 0, result: [{ id: 9, currentTerm: true }] };
      if (parsed.pathname.endsWith('/myself/curriculum')) {
        return { ok: true, data: { records: [{ teclId: 100, acteId: 9, subjCode: 'CS1', subjName: '机器学习' }], pageCount: 1 } };
      }
      return { ok: true, data: { records: [
        { teclId: 100, acteId: 9, subjCode: 'CS1', subjName: '机器学习' },
        { teclId: 101, acteId: 9, subjCode: 'MA1', subjName: '线性代数' },
        { teclId: 102, acteId: 8, subjCode: 'OLD', subjName: '旧课程' },
      ], pageCount: 1 } };
    },
  });
  const courses = await api.listCourses(signal);
  assert.deepEqual(courses.map((course) => course.id), [100, 101]);
  assert.equal(urls.length, 3);
});

test('录像与文稿使用真实 ID 请求对应端点', async () => {
  const urls = [];
  const api = createClassroomApi({
    async requestJson(url) {
      const parsed = new URL(url);
      urls.push(parsed.href);
      if (parsed.pathname.endsWith('/subject_vod_list_new')) {
        return { ok: true, data: { records: [{ id: 55, courBeginTime: '2026-11-01 10:00', courEndTime: '2026-11-01 11:30', clroName: '东中院', letiNumber: 3 }], pageCount: 1 } };
      }
      return { code: 0, result: { afterAssemblyList: [{ bg: 0, ed: 1000, res: '正文' }] } };
    },
  });
  const videos = await api.listVideos(100, signal);
  assert.equal(videos[0].id, 55);
  assert.equal(videos[0].period, '3');
  const result = await api.getTranscript(55, signal);
  assert.equal(result.segments[0].text, '正文');
  assert.match(urls[0], /teclIds=100/);
  assert.match(urls[1], /course\/ai\/translate\/55\?useOriginal=true/);
});

test('空文稿响应映射为 unavailable 而不是报错', async () => {
  const api = createClassroomApi({
    async requestJson() {
      return { code: null, status: 200, ok: true, data: null };
    },
  });
  assert.equal(await api.getTranscript(55, signal), null);
});

test('课堂请求拒绝外部域名且不会启动登录或发送会话', async () => {
  let loginAttempts = 0;
  const browser = createBrowserSession({
    canvas: {
      async classroomLoginUrl() {
        loginAttempts += 1;
        return 'https://oc.sjtu.edu.cn/login/session_token';
      },
    },
  });
  try {
    await assert.rejects(browser.requestJson('https://evil.example/steal?cookie=secret', signal), /地址无效/);
    assert.equal(loginAttempts, 0);
  } finally {
    await browser.close();
  }
});

test('课堂异常响应不回显文稿或会话秘密', async () => {
  const api = createClassroomApi({
    async requestJson() {
      return { status: 500, detail: 'private-transcript-and-cookie' };
    },
  });
  await assert.rejects(api.getTranscript(55, signal), (error) => {
    assert.doesNotMatch(error.message, /private-transcript-and-cookie/);
    return /请求失败/.test(error.message);
  });
});
