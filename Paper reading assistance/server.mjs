#!/usr/bin/env node
import { createReaderServer } from './lib/server.js';
import { openBrowserWindow } from './lib/open-browser.js';
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';

try {
  const { values } = parseArgs({ options: { file: { type: 'string' }, 'no-open': { type: 'boolean' }, 'data-dir': { type: 'string' } } });
  if (Number(process.versions.node.split('.')[0]) < 22 || (Number(process.versions.node.split('.')[0]) === 22 && Number(process.versions.node.split('.')[1]) < 13)) throw new Error('论文阅读器需要 Node.js 22.13+ 或 24+');
  if (values.file && !isAbsolute(values.file)) throw new Error('--file 必须是本机 PDF 的绝对路径');
  if (values['data-dir'] && !isAbsolute(values['data-dir'])) throw new Error('--data-dir 必须是本机绝对路径');
  const instance = await createReaderServer({ dataDir: values['data-dir'] });
  if (values.file) {
    try { await instance.store.importPdf(await readFile(values.file), basename(values.file)); }
    catch (error) { await instance.close(); throw error; }
  }
  if (!values['no-open']) openBrowserWindow(instance.url);
  process.stdout.write(JSON.stringify({ ok: true, url: instance.url, message: '论文阅读器已启动；结束使用后在此终端按 Ctrl+C。' }, null, 2) + '\n');
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await instance.close(); process.exit(0); });
} catch (error) { process.stderr.write(`论文阅读器启动失败：${error.message}\n`); process.exitCode = 1; }
