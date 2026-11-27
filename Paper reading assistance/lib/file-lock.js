import { mkdir, rmdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
export async function withFileLock(directory, task) {
  const path = resolve(directory); if (!path.endsWith('.lock')) throw new Error('无效的内部锁路径');
  const token = `${process.pid}:${randomUUID()}`; const owner = join(path, 'owner'); const end = Date.now() + 15000;
  for (;;) {
    try { await mkdir(path); break; } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= end) throw new Error('数据正被其他进程使用；若之前进程异常退出，请停止相关进程后清理数据目录内的 .lock 目录');
      await delay(60);
    }
  }
  try { await writeFile(owner, token, { flag: 'wx', mode: 0o600 }); return await task(); }
  finally {
    if ((await readFile(owner, 'utf8').catch(() => '')) === token) { await unlink(owner); await rmdir(path); }
  }
}
