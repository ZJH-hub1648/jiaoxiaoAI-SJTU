#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createAgentTools } from '../lib/agent-tools.js';
try {
  const [action = 'help', ...args] = process.argv.slice(2);
  if (['help', '--help', '-h'].includes(action)) {
    console.log(JSON.stringify({ usage: 'node scripts/paper.mjs ACTION [--data-dir ABSOLUTE] [options]', actions: {
      status: '', list: '', import: '--file ABSOLUTE_PDF', read: '--paper ID [--page 1 --offset 0 --limit 12000]', search: '--paper ID --query TEXT',
      ocr: '--paper ID --page 1 [--language eng+chi_sim --overwrite]', crop: '--paper ID --page 1 --rect x,y,width,height --output ABSOLUTE_PNG',
      prepare: '--task translate|annotate|qa|compare|visual --paper ID [--papers ID,ID --question TEXT --page 1 --rect x,y,w,h]',
      complete: '--job UUID --result-file ABSOLUTE_JSON', pending: '[--wait 10]', respond: '--job UUID --result-file ABSOLUTE_JSON_WITH_ANSWER', export: '--paper ID --output ABSOLUTE_MD',
    } }, null, 2));
  } else {
    const { values } = parseArgs({ args, options: Object.fromEntries([
      'data-dir', 'file', 'paper', 'papers', 'page', 'offset', 'limit', 'query', 'language', 'rect', 'output', 'task', 'question', 'kind', 'job', 'result-file', 'wait',
    ].map((name) => [name, { type: 'string' }]).concat([['overwrite', { type: 'boolean' }]])) });
    if (values['data-dir'] && !isAbsolute(values['data-dir'])) throw new Error('data-dir 必须是绝对路径');
    const input = { ...values };
    if (values.papers) input.papers = values.papers.split(',');
    if (values.rect) { const rect = values.rect.split(',').map(Number); if (rect.length !== 4) throw new Error('rect 需要 x,y,width,height'); [input.rect] = [{ x: rect[0], y: rect[1], width: rect[2], height: rect[3] }]; }
    if (values['result-file']) {
      if (!isAbsolute(values['result-file'])) throw new Error('result-file 必须是绝对路径');
      const bytes = await readFile(values['result-file']); if (bytes.length > 250000) throw new Error('结果文件过大');
      input.result = JSON.parse(bytes.toString('utf8')); if (action === 'respond') input.answer = input.result.answer;
    }
    const tools = await createAgentTools(values['data-dir']);
    console.log(JSON.stringify({ ok: true, result: await tools.execute(action, input) }, null, 2));
  }
} catch (error) { console.log(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; }
