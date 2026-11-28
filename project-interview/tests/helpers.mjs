import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InterviewApp, DIMENSIONS } from '../lib/assessment.mjs';

export async function fixture(t) {
  const temp = await realpath(await mkdtemp(join(tmpdir(),'interview-review-test-')));
  if (t) t.after(() => rm(temp,{ recursive: true, force: true }));
  const project = join(temp,'project'), data = join(temp,'private'); await mkdir(project);
  await writeFile(join(project,'server.mjs'),'const cache = new Map();\nexport const lookup = key => cache.get(key);\nexport const store = (key, value) => cache.set(key, value);\n');
  const app = new InterviewApp(data), snapshot = await app.index({ project });
  return { temp, project, data, app, snapshot };
}
export function question(prepared) { const source = prepared.evidence[0]; return { question: '为什么选择进程内缓存，遇到持续写入会怎样？', kind: 'tradeoff', evidence: [{ id: source.id, quote: source.text }] }; }
export function evaluation(prepared, score = 3) {
  const source = prepared.evidence[0];
  return { dimensions: Object.fromEntries(DIMENSIONS.map(key => [key, { score, reason: '回答识别了缓存容量风险，但没有给出完整观测方案。', answerQuote: prepared.turn.answer }])), explanation: '代码使用无容量上限的 Map；持续写入可能增加内存占用，这是静态推理，未执行项目。', strengths: ['能指出容量边界'], gaps: ['补充观测与验证手段'], exercises: [{ task: '加入容量限制并编写边界测试', successCriteria: '验证达到上限后按预期淘汰；记录实际测试命令与输出' }], evidence: [{ id: source.id, quote: source.text }] };
}
