#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Interview } from '../lib/core.mjs';

const usage = `project-interview stages 1–3 (JSON CLI)
index --project ABSOLUTE_DIR [--resume ABSOLUTE_TXT_OR_MD]
inspect --snapshot UUID [--query TEXT] [--limit 8]
evidence --snapshot UUID --evidence ID
start --snapshot UUID [--mode simulation|learning] [--role TEXT] [--difficulty beginner|intermediate|advanced] [--rounds 8]
prepare --session UUID [--query TEXT] [--evidence IDS_COMMA_SEPARATED]
question --session UUID --job UUID --result-file ABSOLUTE_JSON
answer --session UUID --answer-file ABSOLUTE_UTF8_TEXT
show|pause|resume|end --session UUID
Every command accepts --data-dir ABSOLUTE_PRIVATE_DIR. No project code is executed.`;
try {
  const [command = 'help', ...args] = process.argv.slice(2), options = {};
  const allowed = { index:['project','resume'], inspect:['snapshot','query','limit'], evidence:['snapshot','evidence'], start:['snapshot','mode','role','difficulty','rounds'], prepare:['session','query','evidence'], question:['session','job','result-file'], answer:['session','answer-file'], show:['session'], pause:['session'], resume:['session'], end:['session'], help:[] };
  if (!(command in allowed)) throw new Error('未知命令；使用 help 查看用法');
  for (let i = 0; i < args.length; i += 2) { const key = args[i].replace(/^--/, ''); if (!args[i].startsWith('--') || ![...allowed[command], 'data-dir'].includes(key) || options[key] !== undefined || !args[i+1] || args[i+1].startsWith('--')) throw new Error(`无效或重复选项：${args[i]}`); options[key] = args[i+1]; }
  const tool = new Interview(options['data-dir']); let result;
  const input = async (key, max) => { const path = options[key]; if (!path || !isAbsolute(path)) throw new Error(`${key} 需要绝对文件路径`); const { stat } = await import('node:fs/promises'); if ((await stat(path)).size > max) throw new Error('输入文件过大'); return readFile(path, 'utf8'); };
  switch (command) {
    case 'help': result = { usage }; break;
    case 'index': result = await tool.index(options); break;
    case 'inspect': result = await tool.inspect(options.snapshot, options.query, options.limit === undefined ? 8 : Number(options.limit)); break;
    case 'evidence': result = await tool.evidence(options.snapshot, options.evidence); break;
    case 'start': result = await tool.start({ ...options, rounds: options.rounds === undefined ? 8 : Number(options.rounds) }); break;
    case 'prepare': result = await tool.prepare(options.session, { query: options.query, evidenceIds: options.evidence ? options.evidence.split(',') : [] }); break;
    case 'question': result = await tool.question(options.session, options.job, JSON.parse(await input('result-file', 64 * 1024))); break;
    case 'answer': result = await tool.answer(options.session, await input('answer-file', 80 * 1024)); break;
    case 'show': result = await tool.show(options.session); break;
    default: result = await tool.transition(options.session, command);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
} catch (error) { process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`); process.exitCode = 1; }
