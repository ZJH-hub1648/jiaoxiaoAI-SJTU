import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_TOKEN_FILE_BYTES = 4096;
const ENVIRONMENT_TOKEN_NAMES = [
  'SJTU_CANVAS_TOKEN',
  'CANVAS_API_TOKEN',
  'CANVAS_ACCESS_TOKEN',
];

function expandHome(value) {
  if (value === '~') return homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

function normalizedToken(value, source) {
  const token = String(value ?? '').trim();
  if (!token) return '';
  if (/\s/.test(token)) throw new Error(`${source} 中的 Canvas Token 格式无效，不能包含空白字符`);
  return token;
}

export function defaultCanvasTokenPath() {
  return join(homedir(), '.config', 'sjtu-canvas', 'token');
}

export function resolveTokenFilePath(explicitTokenFile = '') {
  const configured = String(explicitTokenFile || process.env.SJTU_CANVAS_TOKEN_FILE || '').trim();
  return resolve(expandHome(configured || defaultCanvasTokenPath()));
}

export function configPath() {
  return process.env.JIAOXIAOAI_CONFIG || join(homedir(), '.jiaoxiaoai', 'config.json');
}

async function readLegacyConfig() {
  try {
    const parsed = JSON.parse(await readFile(configPath(), 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { present: true, value: parsed, error: '' };
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return { present: false, value: {}, error: '' };
    return {
      present: true,
      value: {},
      error: `兼容配置格式异常：${configPath()}。新配置仍可使用，运行 logout 可清除该兼容文件。`,
    };
  }
  return {
    present: true,
    value: {},
    error: `兼容配置格式异常：${configPath()}。新配置仍可使用，运行 logout 可清除该兼容文件。`,
  };
}

async function readTokenFile(path, { required }) {
  try {
    const info = await stat(path);
    if (info.size > MAX_TOKEN_FILE_BYTES) {
      throw new Error('Canvas Token 文件过大，请只保存 Token 本身');
    }
    const text = await readFile(path, 'utf8');
    const token = text
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || '';
    return normalizedToken(token, 'Canvas Token 文件');
  } catch (error) {
    if (error?.code === 'ENOENT' && !required) return '';
    if (error?.code === 'ENOENT') throw new Error(`Canvas Token 文件不存在：${path}`);
    if (error?.message?.includes('Canvas Token')) throw error;
    throw new Error(`Canvas Token 文件不可读：${path}`);
  }
}

function environmentToken() {
  for (const name of ENVIRONMENT_TOKEN_NAMES) {
    const token = normalizedToken(process.env[name], name);
    if (token) return { token, source: `environment:${name}` };
  }
  return { token: '', source: 'missing' };
}

export async function loadConfig({ tokenFile = '' } = {}) {
  const legacy = await readLegacyConfig();
  let canvasToken = '';
  let source = 'missing';
  let selectedTokenPath = null;

  if (String(tokenFile || '').trim()) {
    selectedTokenPath = resolve(expandHome(String(tokenFile).trim()));
    canvasToken = await readTokenFile(selectedTokenPath, { required: true });
    source = 'explicit-token-file';
  } else if (String(process.env.SJTU_CANVAS_TOKEN_FILE || '').trim()) {
    selectedTokenPath = resolveTokenFilePath();
    canvasToken = await readTokenFile(selectedTokenPath, { required: true });
    source = 'environment:SJTU_CANVAS_TOKEN_FILE';
  } else {
    const environment = environmentToken();
    if (environment.token) {
      canvasToken = environment.token;
      source = environment.source;
    } else {
      selectedTokenPath = defaultCanvasTokenPath();
      canvasToken = await readTokenFile(selectedTokenPath, { required: false });
      if (canvasToken) {
        source = 'default-token-file';
      } else {
        const legacyToken = normalizedToken(legacy.value.canvasToken, '兼容配置');
        if (legacyToken) {
          canvasToken = legacyToken;
          source = 'legacy-config';
        }
      }
    }
  }

  return {
    canvasToken,
    chromePath: String(process.env.CHROME_PATH || legacy.value.chromePath || '').trim(),
    configured: Boolean(canvasToken),
    source,
    tokenPath: selectedTokenPath,
    configPath: configPath(),
    legacyConfigPresent: legacy.present,
    legacyConfigError: legacy.error,
  };
}

export async function saveCanvasToken(canvasToken, { tokenFile = '' } = {}) {
  const token = normalizedToken(canvasToken, 'Canvas Token');
  if (!token) throw new Error('Canvas Token 不能为空');
  const path = resolveTokenFilePath(tokenFile);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${token}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  try {
    try {
      await rename(temporary, path);
    } catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
      await rm(path, { force: true });
      await rename(temporary, path);
    }
    await chmod(path, 0o600).catch(() => {});
    return path;
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function removeCanvasToken({ tokenFile = '', confirmTokenFile = false } = {}) {
  const customPath = Boolean(
    String(tokenFile || '').trim() || String(process.env.SJTU_CANVAS_TOKEN_FILE || '').trim(),
  );
  if (customPath && !confirmTokenFile) {
    throw new Error('指定的 Token 文件可能与其他工具共用。确认只删除该技能配置后，请加 --confirm-token-file。');
  }
  const path = resolveTokenFilePath(tokenFile);
  let existed = true;
  try {
    await stat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') existed = false;
    else throw new Error(`无法检查 Canvas Token 文件：${path}`);
  }
  if (existed) await rm(path, { force: true });
  return { path, existed };
}

export async function removeLegacyConfig() {
  const path = configPath();
  let existed = true;
  try {
    await stat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') existed = false;
    else throw new Error(`无法检查兼容配置：${path}`);
  }
  if (existed) await rm(path, { force: true });
  return { path, existed };
}
