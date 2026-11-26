import { constants, createWriteStream } from 'node:fs';
import { copyFile, link, lstat, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extname, isAbsolute, join, resolve } from 'node:path';

export function clampInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${label} 必须是正整数`);
  return id;
}

export function safeFileName(value) {
  const name = String(value ?? '')
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120);
  return name || '未命名';
}

export function downloadDirectory(value) {
  const directory = String(value ?? '').trim();
  if (!directory || !isAbsolute(directory) || directory.includes('\0')) {
    throw new Error('directory 必须是用户明确指定的本机绝对路径');
  }
  return resolve(directory);
}

export async function availablePath(directory, name) {
  const safeName = safeFileName(name);
  const extension = extname(safeName);
  const stem = safeName.slice(0, safeName.length - extension.length);
  for (let index = 1; ; index += 1) {
    const candidate = join(directory, index === 1 ? safeName : `${stem} (${index})${extension}`);
    try {
      await lstat(candidate);
    } catch (error) {
      if (error?.code === 'ENOENT') return candidate;
      throw error;
    }
  }
}

export function courseDirectory(directory, course) {
  return join(directory, safeFileName(`${course.name || `课程 ${course.id}`} [${course.id}]`));
}

async function commitWithoutOverwrite(temporary, destination) {
  try {
    await link(temporary, destination);
    await rm(temporary);
  } catch (error) {
    if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].includes(error?.code)) throw error;
    await copyFile(temporary, destination, constants.COPYFILE_EXCL);
    await rm(temporary);
  }
}

async function commitAvailable(temporary, directory, name) {
  for (;;) {
    const destination = await availablePath(directory, name);
    try {
      await commitWithoutOverwrite(temporary, destination);
      return destination;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
}

export async function saveWebStream({ body, directory, name, expectedSize = 0, signal }) {
  if (!body) throw new Error('下载响应没有内容');
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${randomUUID()}.part`);
  try {
    await pipeline(Readable.fromWeb(body), createWriteStream(temporary, { flags: 'wx' }), { signal });
    const size = (await stat(temporary)).size;
    if (expectedSize > 0 && size !== expectedSize) {
      throw new Error(`文件下载不完整：应为 ${expectedSize} 字节，实际 ${size} 字节`);
    }
    const destination = await commitAvailable(temporary, directory, name);
    return { path: destination, size };
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function saveText({ directory, name, text }) {
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${randomUUID()}.part`);
  try {
    await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return await commitAvailable(temporary, directory, name);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '大小未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
