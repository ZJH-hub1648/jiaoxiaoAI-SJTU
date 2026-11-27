#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { canvasStatus, checkCanvas, saveCanvas, CANVAS_SETTINGS } from '../lib/canvas-auth.js';
async function hiddenToken() {
  if (!process.stdin.isTTY) throw new Error('setup 需由用户本人在交互式终端运行，或使用阅读器中的密码输入框。不要在聊天、命令参数或源码中提供 Token。');
  process.stdout.write(`Canvas 课程功能需要个人访问令牌。\n1. 登录 ${CANVAS_SETTINGS}\n2. 在账户设置创建专用访问令牌，选择合适权限与有效期。\n3. 粘贴到下面的隐藏输入。仅验证成功后才保存。\nCanvas Token（输入不可见）: `);
  const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const reader = createInterface({ input: process.stdin, output, terminal: true });
  try { return await new Promise((resolve, reject) => { reader.once('SIGINT', () => reject(new Error('已取消，不保存令牌'))); reader.question('', resolve); }); }
  finally { reader.close(); process.stdout.write('\n'); }
}
try {
  const [action = 'status', ...args] = process.argv.slice(2); const { values } = parseArgs({ args, options: { 'token-file': { type: 'string' } } });
  const options = { tokenFile: values['token-file'] || '' };
  const result = action === 'setup' ? await saveCanvas(await hiddenToken(), options) : action === 'check' ? await checkCanvas(options) : action === 'status' ? await canvasStatus(options) : (() => { throw new Error('仅支持 status、setup、check'); })();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (err) { console.log(JSON.stringify({ ok: false, error: err.message })); process.exitCode = 1; }
