import { lstat, readdir, readFile, mkdir, copyFile, rename, rmdir, rm } from 'node:fs/promises';
import { dirname, resolve, relative, join, isAbsolute, basename } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonical } from './paths.mjs';

export const SKILL_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const INCLUDE = ['.gitattributes','SKILL.md','README.md','DEPLOYMENT.md','PRIVACY.md','package.json','package-lock.json','mcp.mjs','build-package.mjs','lib','scripts','references','agents','tests'];
const EXCLUDE = new Set(['node_modules','release','dist','.git','.env','.config','snapshots','sessions','jobs','locks']);
export async function skillFiles(root = SKILL_ROOT) {
  const files = [];
  async function visit(path) {
    const stat = await lstat(path); if (stat.isSymbolicLink()) throw new Error('技能发布文件不能为符号链接');
    if (stat.isDirectory()) { for (const name of (await readdir(path)).sort()) if (!EXCLUDE.has(name)) await visit(join(path, name)); }
    else if (stat.isFile()) files.push({ source: path, path: relative(root, path).split('\\').join('/') });
  }
  for (const name of INCLUDE) { try { await visit(join(root, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  for (const name of ['SKILL.md','package.json','package-lock.json','mcp.mjs','scripts/interview.mjs','lib/core.mjs']) if (!files.some(file => file.path === name)) throw new Error(`缺少发布文件：${name}`);
  return files.sort((a,b) => a.path.localeCompare(b.path));
}
export async function installSkill({ agent = 'custom', target, home = homedir(), sourceRoot = SKILL_ROOT } = {}) {
  const presets = { codex: ['.agents','skills'], claude: ['.claude','skills'], dsh: ['.dsh','skills'], workbuddy: ['.workbuddy','skills'] };
  if (agent !== 'custom' && !presets[agent]) throw new Error('未知 Agent；用 --target 指定实际技能目录');
  const requested = target || (presets[agent] ? join(home, ...presets[agent], 'project-interview') : '');
  if (!isAbsolute(requested)) throw new Error('目标必须为绝对路径');
  const source = await canonical(resolve(sourceRoot)), output = await canonical(resolve(requested));
  const within = (a,b) => { const r = relative(a,b); return r === '' || !r.startsWith('..') && !isAbsolute(r); };
  if (within(source,output) || within(output,source)) throw new Error('安装目标与源码不能重叠');
  try { if (!(await lstat(output)).isDirectory() || (await readdir(output)).length) throw new Error('目标非空或不是目录，拒绝覆盖；请保留旧版并选空目录'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const files = await skillFiles(source), stage = join(dirname(output), `.${basename(output)}.install-${randomUUID()}`);
  try {
    await mkdir(stage, { recursive: true });
    for (const file of files) { const path = join(stage, file.path); await mkdir(dirname(path), { recursive: true }); await copyFile(file.source,path); }
    try { await rmdir(output); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(stage,output);
  } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
  return { path: output, files: files.length, next: ['让 Agent 重新发现 SKILL.md；CLI 不需安装依赖', 'MCP：在安装目录执行 npm ci --omit=dev'], mcp: { command: process.execPath, args: [join(output,'mcp.mjs')] }, note: '目录预设可被 Agent 产品版本/用户设置覆盖；不自动修改 Agent 配置，不复制依赖或私有记录。' };
}
