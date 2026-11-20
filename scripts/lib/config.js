import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function configPath() {
  return process.env.JIAOXIAOAI_CONFIG || join(homedir(), '.jiaoxiaoai', 'config.json');
}

export async function loadConfig() {
  let stored = {};
  try {
    const parsed = JSON.parse(await readFile(configPath(), 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error(`交小AI配置不可读：${configPath()}。可重新运行 setup。`);
  }
  return {
    canvasToken: String(process.env.CANVAS_ACCESS_TOKEN || stored.canvasToken || '').trim(),
    chromePath: String(process.env.CHROME_PATH || stored.chromePath || '').trim(),
    configured: Boolean(process.env.CANVAS_ACCESS_TOKEN || stored.canvasToken),
    source: process.env.CANVAS_ACCESS_TOKEN ? 'environment' : stored.canvasToken ? 'local-config' : 'missing',
  };
}

export async function removeConfig() {
  const path = configPath();
  await rm(path, { force: true });
  return path;
}

export async function saveConfig({ canvasToken, chromePath = '' }) {
  const token = String(canvasToken || '').trim();
  if (!token) throw new Error('Canvas Token 不能为空');
  const path = configPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ version: 1, canvasToken: token, chromePath }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  await rename(temporary, path);
  return path;
}
