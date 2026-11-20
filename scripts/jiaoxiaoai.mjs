#!/usr/bin/env node

import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { createCanvasClient } from './lib/canvas.js';
import { createClassroomApi, formatTranscript, readTranscriptRange } from './lib/classroom.js';
import { createBrowserSession } from './lib/browser.js';
import { configPath, loadConfig, removeConfig, saveConfig } from './lib/config.js';
import { courseDirectory, downloadDirectory, positiveId, safeFileName, saveText } from './lib/files.js';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function ids(value, label) {
  return [...new Set(String(value || '').split(',').filter(Boolean).map((item) => positiveId(item, label)))];
}

function options(args) {
  const { values } = parseArgs({
    args,
    options: {
      query: { type: 'string' },
      history: { type: 'boolean' },
      all: { type: 'boolean' },
      course: { type: 'string' },
      files: { type: 'string' },
      'all-ppt': { type: 'boolean' },
      directory: { type: 'string' },
      video: { type: 'string' },
      videos: { type: 'string' },
      start: { type: 'string' },
      end: { type: 'string' },
      offset: { type: 'string' },
      'max-chars': { type: 'string' },
      check: { type: 'boolean' },
    },
  });
  return values;
}

async function hiddenQuestion(prompt) {
  if (!process.stdin.isTTY) throw new Error('setup 需要交互式终端。请由用户本人在终端运行该命令，不要把 Token 发到聊天中。');
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const reader = createInterface({ input: process.stdin, output, terminal: true });
  process.stdout.write(prompt);
  muted = true;
  try {
    return await new Promise((resolve) => reader.question('', resolve));
  } finally {
    muted = false;
    process.stdout.write('\n');
    reader.close();
  }
}

async function setup() {
  const token = String(await hiddenQuestion('Canvas Access Token（输入不可见）: ')).trim();
  if (!token) throw new Error('Canvas Token 不能为空');
  const canvas = createCanvasClient({ token });
  await canvas.checkConnection();
  const path = await saveConfig({ canvasToken: token });
  print({ connected: true, configPath: path, message: 'Canvas 已验证并保存。之后可直接使用课程资料命令。' });
}

async function logout() {
  const path = await removeConfig();
  const environmentTokenRemaining = Boolean(String(process.env.CANVAS_ACCESS_TOKEN || '').trim());
  print({
    localConfigCleared: true,
    configPath: path,
    environmentTokenRemaining,
    message: environmentTokenRemaining
      ? '本地配置已清除，但环境变量中的 Token 仍有效，请自行清除。Canvas 云端 Token 需要在设置中单独撤销。'
      : '本地配置已清除，已下载文件未删除。Canvas 云端 Token 需要在设置中单独撤销。',
    revokeUrl: 'https://oc.sjtu.edu.cn/profile/settings',
  });
}

async function status(args) {
  const config = await loadConfig();
  let dependencyReady = true;
  try {
    await import('playwright-core');
  } catch {
    dependencyReady = false;
  }
  const result = {
    connected: config.configured,
    dependencyReady,
    credentialSource: config.source,
    configPath: configPath(),
    chrome: config.chromePath ? 'custom' : 'system-chrome-with-chromium-fallback',
    skillDirectory: SKILL_ROOT,
  };
  if (!dependencyReady) {
    result.install = `cd ${JSON.stringify(SKILL_ROOT)} && npm ci`;
  }
  if (!config.configured) {
    result.next = `node ${JSON.stringify(resolve(SKILL_ROOT, 'scripts/jiaoxiaoai.mjs'))} setup`;
  } else if (args.check) {
    await createCanvasClient({ token: config.canvasToken }).checkConnection();
    result.online = true;
  }
  print(result);
}

async function canvasClient() {
  const config = await loadConfig();
  if (!config.canvasToken) throw new Error(`尚未连接 Canvas。请由用户本人在终端运行：node ${resolve(SKILL_ROOT, 'scripts/jiaoxiaoai.mjs')} setup`);
  return createCanvasClient({ token: config.canvasToken });
}

async function canvasCommand(action, args) {
  const canvas = await canvasClient();
  if (action === 'courses') {
    const query = String(args.query || '').toLocaleLowerCase();
    const courses = (await canvas.listCourses({ includeHistory: args.history === true })).filter((course) =>
      !query || `${course.name} ${course.code}`.toLocaleLowerCase().includes(query));
    print({ courses });
    return;
  }
  const courseId = positiveId(args.course, 'courseId');
  if (action === 'files') {
    const query = String(args.query || '').toLocaleLowerCase();
    const files = (await canvas.listFiles(courseId)).filter((file) =>
      (args.all === true || file.presentation) && (!query || file.name.toLocaleLowerCase().includes(query)));
    print({ courseId, files });
    return;
  }
  if (action === 'download') {
    const directory = downloadDirectory(args.directory);
    const fileIds = ids(args.files, 'fileId');
    if (fileIds.length > 50) throw new Error('单次最多下载 50 个文件');
    if (Boolean(args['all-ppt']) === fileIds.length > 0) throw new Error('--files 与 --all-ppt 必须且只能选择一种');
    const [courses, files] = await Promise.all([
      canvas.listCourses({ includeHistory: true }),
      canvas.listFiles(courseId),
    ]);
    const course = courses.find((item) => item.id === courseId);
    if (!course) throw new Error(`课程 ${courseId} 不在当前账号的课程列表中`);
    const selected = args['all-ppt'] === true ? files.filter((file) => file.presentation) : files.filter((file) => fileIds.includes(file.id));
    const results = [];
    for (const file of selected) {
      try {
        const saved = await canvas.downloadFile(file.id, course, directory);
        results.push({ status: 'saved', id: file.id, name: file.name, path: saved.path, size: saved.size });
      } catch (error) {
        results.push({ status: 'failed', id: file.id, name: file.name, error: error.message });
      }
    }
    print({ course, directory, results });
    return;
  }
  throw new Error(`未知 Canvas 命令：${action}`);
}

async function withClassroom(run) {
  const config = await loadConfig();
  if (!config.canvasToken) throw new Error(`尚未连接 Canvas。请先运行 setup，再使用课堂文稿功能。`);
  const canvas = createCanvasClient({ token: config.canvasToken });
  const browser = createBrowserSession({ canvas, chromePath: config.chromePath });
  const classroom = createClassroomApi({ requestJson: browser.requestJson });
  try {
    return await run(classroom);
  } finally {
    await browser.close();
  }
}

async function classroomCommand(action, args) {
  if (action === 'courses') {
    await withClassroom(async (classroom) => {
      const query = String(args.query || '').toLocaleLowerCase();
      const courses = (await classroom.listCourses()).filter((course) =>
        !query || `${course.name} ${course.code}`.toLocaleLowerCase().includes(query));
      print({ courses });
    });
    return;
  }
  const courseId = action === 'read' ? null : positiveId(args.course, 'courseId');
  if (action === 'videos') {
    await withClassroom(async (classroom) => {
      const query = String(args.query || '').toLocaleLowerCase();
      const videos = (await classroom.listVideos(courseId)).filter((video) =>
        !query || `${video.start} ${video.end} ${video.room} ${video.period}`.toLocaleLowerCase().includes(query));
      print({ courseId, videos });
    });
    return;
  }
  if (action === 'read') {
    const videoId = positiveId(args.video, 'videoId');
    await withClassroom(async (classroom) => {
      const transcript = await classroom.getTranscript(videoId);
      print(transcript
        ? { videoId, available: true, ...readTranscriptRange(transcript, {
            startSeconds: args.start,
            endSeconds: args.end,
            offset: args.offset,
            maxChars: args['max-chars'],
          }) }
        : { videoId, available: false, message: '该录像暂无语音识别文稿，这不是网络或登录错误。' });
    });
    return;
  }
  if (action === 'download') {
    const directory = downloadDirectory(args.directory);
    const videoIds = ids(args.videos, 'videoId');
    if (!videoIds.length || videoIds.length > 50) throw new Error('--videos 必须包含 1–50 个录像 ID');
    await withClassroom(async (classroom) => {
      const [courses, videos] = await Promise.all([classroom.listCourses(), classroom.listVideos(courseId)]);
      const course = courses.find((item) => item.id === courseId) || { id: courseId, name: `课程 ${courseId}` };
      const selected = videos.filter((video) => videoIds.includes(video.id));
      const target = courseDirectory(directory, course);
      const results = [];
      for (const video of selected) {
        try {
          const transcript = await classroom.getTranscript(video.id);
          if (!transcript) {
            results.push({ status: 'unavailable', id: video.id, start: video.start });
            continue;
          }
          const title = `${course.name}｜${video.start}${video.room ? `｜${video.room}` : ''}`;
          const name = safeFileName(`${video.start.replace(/[: ]/g, '-')} [${video.id}].txt`);
          const path = await saveText({ directory: target, name, text: formatTranscript(transcript, title) });
          results.push({ status: 'saved', id: video.id, start: video.start, path });
        } catch (error) {
          results.push({ status: 'failed', id: video.id, start: video.start, error: error.message });
        }
      }
      print({ course, directory: target, results, missingVideoIds: videoIds.filter((id) => !selected.some((video) => video.id === id)) });
    });
    return;
  }
  throw new Error(`未知课堂命令：${action}`);
}

const [domain, action, ...rest] = process.argv.slice(2);
try {
  if (domain === 'setup') await setup();
  else if (domain === 'logout') await logout();
  else if (domain === 'status') await status(options(rest));
  else if (domain === 'canvas') await canvasCommand(action, options(rest));
  else if (domain === 'classroom') await classroomCommand(action, options(rest));
  else {
    print({
      usage: [
        'node scripts/jiaoxiaoai.mjs setup',
        'node scripts/jiaoxiaoai.mjs logout',
        'node scripts/jiaoxiaoai.mjs status [--check]',
        'node scripts/jiaoxiaoai.mjs canvas courses [--query 课名] [--history]',
        'node scripts/jiaoxiaoai.mjs canvas files --course 课程ID [--query 关键词] [--all]',
        'node scripts/jiaoxiaoai.mjs canvas download --course 课程ID (--files ID,ID | --all-ppt) --directory /绝对目录',
        'node scripts/jiaoxiaoai.mjs classroom courses [--query 课名]',
        'node scripts/jiaoxiaoai.mjs classroom videos --course 课程ID [--query 日期]',
        'node scripts/jiaoxiaoai.mjs classroom read --video 录像ID [--start 0] [--end 300] [--offset 0]',
        'node scripts/jiaoxiaoai.mjs classroom download --course 课程ID --videos ID,ID --directory /绝对目录',
      ],
    });
    if (domain) process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`错误：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
