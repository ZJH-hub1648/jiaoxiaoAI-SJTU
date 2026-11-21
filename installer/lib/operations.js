import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
} from 'node:path';
import { promisify } from 'node:util';

import { collectReleaseFiles } from '../../scripts/lib/release.js';

const execFileAsync = promisify(execFile);

export const PLATFORM_DEFINITIONS = [
  {
    id: 'codex',
    name: 'Codex',
    description: '安装到当前用户的 Codex 技能目录',
    suffix: join('.agents', 'skills', 'sjtu-canvas'),
  },
  {
    id: 'dsh',
    name: 'DeepSeek Harness',
    description: '安装到 DSH 用户技能目录',
    suffix: join('.dsh', 'skills', 'sjtu-canvas'),
  },
  {
    id: 'workbuddy',
    name: 'WorkBuddy',
    description: '安装到 WorkBuddy 用户技能目录',
    suffix: join('.workbuddy', 'skills', 'sjtu-canvas'),
  },
];

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function commandVersion(command, args) {
  if (!command) return { available: false, version: null };
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 5000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    const output = `${stdout || ''}\n${stderr || ''}`.trim();
    return { available: true, version: output.split(/\r?\n/)[0] || 'available' };
  } catch {
    return { available: false, version: null };
  }
}

export function preferredPythonCommand(platform = process.platform) {
  return platform === 'win32' ? 'python' : 'python3';
}

export async function detectEnvironment() {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const pythonCommand = preferredPythonCommand();
  const npmPromise = process.platform === 'win32'
    ? commandVersion(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm', '--version'])
    : commandVersion('npm', ['--version']);
  const [python, npm] = await Promise.all([
    commandVersion(pythonCommand, ['--version']),
    npmPromise,
  ]);
  return {
    node: {
      available: true,
      version: process.versions.node,
      supported: nodeMajor >= 22,
    },
    python,
    npm,
  };
}

export async function detectPlatforms(home = homedir()) {
  return Promise.all(PLATFORM_DEFINITIONS.map(async (definition) => {
    const path = join(home, definition.suffix);
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      path,
      installed: await exists(join(path, 'SKILL.md')),
    };
  }));
}

export function resolveInstallTarget({ platformId, customPath } = {}, home = homedir()) {
  let target;
  if (platformId === 'custom') {
    const value = String(customPath || '').trim();
    if (!value || !isAbsolute(value)) throw new Error('请选择本机的绝对安装目录');
    target = resolve(value);
  } else {
    const definition = PLATFORM_DEFINITIONS.find((item) => item.id === platformId);
    if (!definition) throw new Error('请选择要安装到的智能体平台');
    target = join(home, definition.suffix);
  }
  if (target === parse(target).root) throw new Error('不能直接安装到磁盘根目录');
  if (!basename(target)) throw new Error('安装目录无效');
  return target;
}

export async function isManagedInstall(target) {
  try {
    const skill = await readFile(join(target, 'SKILL.md'), 'utf8');
    if (!/^---[\s\S]*?name:\s*sjtu-canvas[\s\S]*?---/m.test(skill)) return false;
    const packageData = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
    return packageData?.name === '@local/jiaoxiao-campus-skill';
  } catch {
    return false;
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
}

function isInside(parent, child) {
  const relation = relative(parent, child);
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

export async function installSkill({ sourceRoot, target }) {
  const source = resolve(sourceRoot);
  const destination = resolve(target);
  if (source === destination) {
    return {
      path: destination,
      changed: false,
      backupPath: null,
      message: '当前目录已经是目标技能目录，无需重复复制。',
    };
  }
  if (isInside(source, destination)) {
    throw new Error('安装目录不能位于当前技能源码目录内部');
  }

  const destinationExists = await exists(destination);
  if (destinationExists && !(await isManagedInstall(destination))) {
    throw new Error('目标目录已存在其他内容。为避免覆盖文件，请选择空目录或其他平台。');
  }

  const files = await collectReleaseFiles(source);
  const parent = dirname(destination);
  const staging = join(parent, `.${basename(destination)}.staging-${process.pid}-${Date.now()}`);
  const backupPath = destinationExists
    ? join(parent, `${basename(destination)}.backup-${timestamp()}`)
    : null;
  await mkdir(parent, { recursive: true });
  await rm(staging, { recursive: true, force: true });

  try {
    await mkdir(staging, { recursive: true });
    for (const file of files) {
      const output = join(staging, file.path);
      await mkdir(dirname(output), { recursive: true });
      await copyFile(file.source, output);
    }
    const packageData = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
    await writeManagedMarker(staging, packageData.version);
    if (destinationExists) await rename(destination, backupPath);
    try {
      await rename(staging, destination);
    } catch (error) {
      if (backupPath && await exists(backupPath) && !await exists(destination)) {
        await rename(backupPath, destination);
      }
      throw error;
    }
    return {
      path: destination,
      changed: true,
      backupPath,
      message: destinationExists ? '技能已更新，旧版本已备份。' : '技能安装完成。',
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function writeManagedMarker(directory, version) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(
    join(directory, '.jiaoxiaoai-managed.json'),
    `${JSON.stringify({ managed: true, version, installedAt: new Date().toISOString() }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
}

export async function dependencyReady(target) {
  return exists(join(target, 'node_modules', 'playwright', 'package.json'))
    || exists(join(target, 'node_modules', 'playwright-core', 'package.json'));
}

export async function targetSummary(target) {
  if (!target) return null;
  const info = await stat(join(target, 'SKILL.md')).catch(() => null);
  return {
    path: target,
    installed: Boolean(info?.isFile()),
    managed: await isManagedInstall(target),
    dependenciesReady: await dependencyReady(target),
  };
}
