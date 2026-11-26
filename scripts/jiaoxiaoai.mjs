#!/usr/bin/env node

import { createInterface } from 'node:readline';
import { access } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { createCanvasClient } from './lib/canvas.js';
import { createClassroomApi, formatTranscript, readTranscriptRange, searchTranscript, validateReadOptions } from './lib/classroom.js';
import { createBrowserSession } from './lib/browser.js';
import {
  defaultCanvasTokenPath,
  loadConfig,
  removeCanvasToken,
  removeLegacyConfig,
  saveCanvasToken,
} from './lib/config.js';
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
      'token-file': { type: 'string' },
      'confirm-token-file': { type: 'boolean' },
      video: { type: 'string' },
      videos: { type: 'string' },
      start: { type: 'string' },
      end: { type: 'string' },
      offset: { type: 'string' },
      'char-offset': { type: 'string' },
      limit: { type: 'string' },
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

async function setup(args = {}) {
  const token = String(await hiddenQuestion('Canvas Access Token（输入不可见）: ')).trim();
  if (!token) throw new Error('Canvas Token 不能为空');
  const canvas = createCanvasClient({ token });
  await canvas.checkConnection();
  const path = await saveCanvasToken(token, { tokenFile: args['token-file'] });
  print({
    connected: true,
    tokenPath: path,
    tokenSource: args['token-file'] ? 'explicit-token-file' : 'skill-token-file',
    message: 'Canvas 已验证并保存。Python 与 Node.js 命令会共用该 Token。',
  });
}

async function logout(args = {}) {
  const removedToken = await removeCanvasToken({
    tokenFile: args['token-file'],
    confirmTokenFile: args['confirm-token-file'] === true,
  });
  const removedLegacy = await removeLegacyConfig();
  const environmentTokenRemaining = ['SJTU_CANVAS_TOKEN', 'CANVAS_API_TOKEN', 'CANVAS_ACCESS_TOKEN']
    .filter((name) => Boolean(String(process.env[name] || '').trim()));
  print({
    localConfigCleared: true,
    tokenPath: removedToken.path,
    tokenFileRemoved: removedToken.existed,
    legacyConfigPath: removedLegacy.path,
    legacyConfigRemoved: removedLegacy.existed,
    environmentTokenRemaining,
    message: environmentTokenRemaining.length
      ? `本地 Token 文件已处理，但环境变量 ${environmentTokenRemaining.join(', ')} 中的 Token 仍有效，请自行清除。Canvas 云端 Token 需要在设置中单独撤销。`
      : '本地 Token 与兼容配置已清除，已下载文件未删除。Canvas 云端 Token 需要在设置中单独撤销。',
    revokeUrl: 'https://oc.sjtu.edu.cn/profile/settings',
  });
}

async function status(args) {
  const config = await loadConfig({ tokenFile: args['token-file'] });
  let dependencyReady = true;
  try {
    await import('playwright-core');
  } catch {
    dependencyReady = false;
  }
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const nodeMinor = Number(process.versions.node.split('.')[1]);
  const pdfReady = await access(resolve(SKILL_ROOT, 'node_modules/pdfjs-dist/build/pdf.mjs')).then(() => true, () => false);
  const nodeSupported = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 13);
  const result = {
    connected: config.configured,
    credentialSource: config.source,
    tokenPath: config.tokenPath,
    legacyConfigPath: config.configPath,
    legacyConfigPresent: config.legacyConfigPresent,
    legacyConfigError: config.legacyConfigError || null,
    dependencyReady,
    nodeVersion: process.versions.node,
    nodeSupported,
    paperReaderReady: pdfReady && nodeSupported,
    runtimeReady: dependencyReady && pdfReady && nodeSupported,
    chrome: config.chromePath ? 'custom' : 'system-chrome-with-chromium-fallback',
    skillDirectory: SKILL_ROOT,
    defaultTokenPath: defaultCanvasTokenPath(),
  };
  if (!dependencyReady || !pdfReady) {
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

async function canvasClient({ tokenFile = '' } = {}) {
  const config = await loadConfig({ tokenFile });
  if (!config.canvasToken) throw new Error(`尚未连接 Canvas。请由用户本人在终端运行：node ${resolve(SKILL_ROOT, 'scripts/jiaoxiaoai.mjs')} setup`);
  return createCanvasClient({ token: config.canvasToken });
}

async function canvasCommand(action, args) {
  const canvas = await canvasClient({ tokenFile: args['token-file'] });
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
    print({
      course,
      directory,
      results,
      missingFileIds: fileIds.filter((id) => !selected.some((file) => file.id === id)),
    });
    return;
  }
  throw new Error(`未知 Canvas 命令：${action}`);
}

async function withClassroom(args, run) {
  const config = await loadConfig({ tokenFile: args['token-file'] });
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
    await withClassroom(args, async (classroom) => {
      const query = String(args.query || '').toLocaleLowerCase();
      const courses = (await classroom.listCourses()).filter((course) =>
        !query || `${course.name} ${course.code}`.toLocaleLowerCase().includes(query));
      print({ courses });
    });
    return;
  }
  const courseId = ['read', 'search'].includes(action) ? null : positiveId(args.course, 'courseId');
  if (action === 'videos') {
    await withClassroom(args, async (classroom) => {
      const query = String(args.query || '').toLocaleLowerCase();
      const videos = (await classroom.listVideos(courseId)).filter((video) =>
        !query || `${video.start} ${video.end} ${video.room} ${video.period}`.toLocaleLowerCase().includes(query));
      print({ courseId, videos });
    });
    return;
  }
  if (action === 'read') {
    const videoId = positiveId(args.video, 'videoId');
    const readOptions = validateReadOptions({
      startSeconds: args.start, endSeconds: args.end, offset: args.offset,
      charOffset: args['char-offset'], maxChars: args['max-chars'],
    });
    await withClassroom(args, async (classroom) => {
      const transcript = await classroom.getTranscript(videoId);
      print(transcript
        ? { videoId, available: true, ...readTranscriptRange(transcript, readOptions) }
        : { videoId, available: false, message: '该录像暂无语音识别文稿，这不是网络或登录错误。' });
    });
    return;
  }
  if (action === 'search') {
    const videoId = positiveId(args.video, 'videoId');
    const emptyOptions = searchTranscript({ videoId, segments: [] }, {
      query: args.query,
      offset: args.offset,
      limit: args.limit,
    });
    await withClassroom(args, async (classroom) => {
      const transcript = await classroom.getTranscript(videoId);
      if (!transcript) {
        print({
          videoId,
          available: false,
          ...emptyOptions,
          message: '该录像暂无语音识别文稿，这不是网络或登录错误。',
        });
        return;
      }
      const result = searchTranscript(transcript, {
        query: args.query,
        offset: args.offset,
        limit: args.limit,
      });
      print({
        videoId,
        available: true,
        ...result,
        message: result.total === 0
          ? '当前识别文稿未命中该关键词；这不代表老师没有讲解相关内容。'
          : undefined,
      });
    });
    return;
  }
  if (action === 'download') {
    const directory = downloadDirectory(args.directory);
    const videoIds = ids(args.videos, 'videoId');
    if (!videoIds.length || videoIds.length > 50) throw new Error('--videos 必须包含 1–50 个录像 ID');
    await withClassroom(args, async (classroom) => {
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

const [domain, second, ...rest] = process.argv.slice(2);
try {
  const helpRequested = ['help', '--help', '-h'].includes(domain);
  const rootCommand = ['setup', 'logout', 'status'].includes(domain);
  const action = rootCommand ? null : second;
  const args = options(rootCommand ? [second, ...rest].filter(Boolean) : rest);
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (domain && nodeMajor < 22) {
    throw new Error(`此 Node.js 模块需要 Node.js 22 或更高版本，当前为 ${process.versions.node}`);
  }
  if (domain === 'setup') await setup(args);
  else if (domain === 'logout') await logout(args);
  else if (domain === 'status') await status(args);
  else if (domain === 'canvas') await canvasCommand(action, args);
  else if (domain === 'classroom') await classroomCommand(action, args);
  else {
    print({
      usage: [
        'node scripts/jiaoxiaoai.mjs setup [--token-file PATH]',
        'node scripts/jiaoxiaoai.mjs logout [--token-file PATH --confirm-token-file]',
        'node scripts/jiaoxiaoai.mjs status [--check] [--token-file PATH]',
        'node scripts/jiaoxiaoai.mjs canvas courses [--query 课名] [--history]',
        'node scripts/jiaoxiaoai.mjs canvas files --course 课程ID [--query 关键词] [--all]',
        'node scripts/jiaoxiaoai.mjs canvas download --course 课程ID (--files ID,ID | --all-ppt) --directory /绝对目录',
        'node scripts/jiaoxiaoai.mjs classroom courses [--query 课名]',
        'node scripts/jiaoxiaoai.mjs classroom videos --course 课程ID [--query 日期]',
        'node scripts/jiaoxiaoai.mjs classroom read --video 录像ID [--start 0] [--end 300] [--offset 0] [--char-offset 0] [--max-chars 6000]',
        'node scripts/jiaoxiaoai.mjs classroom search --video 录像ID --query 关键词 [--offset 0] [--limit 20]',
        'node scripts/jiaoxiaoai.mjs classroom download --course 课程ID --videos ID,ID --directory /绝对目录',
      ],
    });
    if (domain && !helpRequested) process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`错误：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
