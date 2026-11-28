#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { parseArgs } from 'node:util';
import { createTools } from './lib/actions.mjs';

const { values } = parseArgs({ options: { 'data-dir': { type: 'string' } } });
const execute = createTools(values['data-dir']);
const server = new McpServer({ name: 'project-interview', version: '0.6.0-rc.1' });
const uuid = z.string().uuid(), session = { session: uuid }, task = { ...session, job: uuid };
const citation = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/), quote: z.string().min(12).max(6000) });
const evidence = z.array(citation).min(1).max(6);
const dimension = z.object({ score: z.number().int().min(0).max(4).nullable(), reason: z.string().min(1).max(2000), answerQuote: z.string().max(2000).nullable().optional() });
const review = z.object({ dimensions: z.object({ accuracy: dimension, codeUnderstanding: dimension, tradeoffs: dimension, failureReasoning: dimension }), explanation: z.string().min(1).max(8000), strengths: z.array(z.string().min(1).max(1200)).max(6), gaps: z.array(z.string().min(1).max(1200)).max(6), exercises: z.array(z.object({ task: z.string().min(1).max(1200), successCriteria: z.string().min(1).max(1200) })).max(6), evidence });
function register(action, description, inputSchema, readOnlyHint = false) {
  server.registerTool(`interview_${action}`, { description, inputSchema, annotations: { readOnlyHint, destructiveHint: false, openWorldHint: false } }, async input => {
    try { return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ...await execute(action, input) }) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, error: error.message }) }] }; }
  });
}
register('status', 'Inspect local runtime, data directory and current-host-model readiness. No additional model key.', {}, true);
register('list', 'Discover up to 100 saved interview sessions.', {}, true);
register('index', 'Read a user-provided local project and optional UTF-8 text resume. Never executes project code.', { project: z.string(), resume: z.string().optional() });
register('inspect', 'Retrieve bounded project snapshot evidence and unverified resume matches.', { snapshot: uuid, query: z.string().max(4000).optional(), limit: z.number().int().min(1).max(12).optional() }, true);
register('evidence', 'Read exact indexed source lines, validating current file hash.', { snapshot: uuid, evidence: z.string().regex(/^[a-f0-9]{24}$/) }, true);
register('start', 'Start a project interview using the current host Agent model.', { snapshot: uuid, mode: z.enum(['simulation','learning']).optional(), role: z.string().min(1).max(200).optional(), difficulty: z.enum(['beginner','intermediate','advanced']).optional(), rounds: z.number().int().min(1).max(30).optional() });
register('show', 'Recover interview state and actual transcript.', session, true);
register('prepare', 'Prepare code evidence and answer history for the host to generate one question. Submit via interview_question.', { ...session, query: z.string().max(4000).optional(), evidenceIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).max(8).optional() });
register('question', 'Validate and save one host-generated question. Present accepted question, then wait for the user.', { ...task, result: z.object({ question: z.string().min(1).max(4000), kind: z.enum(['architecture','implementation','tradeoff','failure','testing']), evidence, answerQuote: z.string().max(2000).optional(), rationale: z.string().max(2000).optional() }) });
register('answer', 'Record the real user answer; never invent it. Then prepare a followup or review.', { ...session, answer: z.string().min(1).max(20000) });
for (const action of ['pause','resume','end']) register(action, `${action} the current session at user request.`, session);
register('prepare_hint', 'Learning mode only: prepare progressively requested level 1–3 hint. Host generates hint.', { ...session, level: z.number().int().min(1).max(3).optional() });
register('hint', 'Save a source-validated host hint and mark this turn as assisted before presenting it.', { ...task, result: z.object({ hint: z.string().min(1).max(4000), evidence }) });
register('prepare_review', 'Prepare one answered turn and rubric for host-model assessment. Simulation must end first.', { ...session, round: z.number().int().min(1).max(30) });
register('review', 'Validate and save host assessment with actual answer quotes. Untested dimensions must be null.', { ...task, result: review });
register('report', 'Generate deterministic final review and score aggregation, distinguishing assisted from independent answers.', session, true);
register('export', 'Export final review to user-requested absolute .md/.json outside project/skill. Does not overwrite.', { ...session, output: z.string() });
await server.connect(new StdioServerTransport());
