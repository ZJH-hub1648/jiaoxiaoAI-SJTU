#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { createAgentTools } from './lib/agent-tools.js';

const { values } = parseArgs({ options: { 'data-dir': { type: 'string' } } });
const tools = await createAgentTools(values['data-dir']);
const server = new McpServer({ name: 'paper-reading-assistance', version: '1.7.0-rc.1' });
const paper = z.string().regex(/^[a-f0-9]{64}$/);
const rect = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) });
function register(action, description, inputSchema, readOnlyHint = false) {
  server.registerTool(`paper_${action}`, { description, inputSchema, annotations: { readOnlyHint, destructiveHint: false, openWorldHint: false } }, async (input) => {
    try {
      const result = await tools.execute(action, input); const content = [{ type: 'text', text: JSON.stringify(result) }];
      if (action === 'prepare' && result.imagePath) content.push({ type: 'image', data: (await readFile(result.imagePath)).toString('base64'), mimeType: 'image/png' });
      if (action === 'pending') for (const job of result.slice(0, 4)) for (const image of job.images || []) content.push({ type: 'image', data: (await readFile(image)).toString('base64'), mimeType: 'image/png' });
      return { content };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
}
register('status', 'Inspect standalone skill readiness. No browser or extra model API key required.', {}, true);
register('list', 'List local imported papers.', {}, true);
register('import', 'Import and extract a user-provided local PDF without a browser.', { file: z.string() });
register('read', 'Read a bounded page of paper text. OCR output is evidence requiring checking.', { paper, page: z.number().int().positive().optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(100).max(20000).optional() }, true);
register('search', 'Search a paper for a literal term with page citations.', { paper, query: z.string().min(1) }, true);
register('ocr', 'Locally OCR a scanned PDF page; overwriting native text requires user intent.', { paper, page: z.number().int().positive(), language: z.enum(['eng', 'eng+chi_sim']).optional(), overwrite: z.boolean().optional() });
register('crop', 'Render a specified page region to a user-requested absolute PNG output. Never overwrites files.', { paper, page: z.number().int().positive(), rect, output: z.string() });
register('prepare', 'Prepare bounded source evidence for the current host Agent model. Do not ask for an API key. For visual tasks an image is returned. Use paper_complete to save the host answer.', {
  task: z.enum(['translate', 'annotate', 'qa', 'compare', 'visual']), paper: paper.optional(), papers: z.array(paper).min(2).max(4).optional(), page: z.number().int().positive().optional(),
  question: z.string().max(4000).optional(), rect: rect.optional(), kind: z.enum(['formula', 'figure', 'table']).optional(),
});
register('complete', 'Validate and persist a host-generated result using its prepare job. Never invent or bypass source references.', {
  job: z.string().uuid(), result: z.object({ translation: z.string().max(60000).optional(), answer: z.string().max(60000).optional(),
    notes: z.array(z.object({ title: z.string(), quote: z.string(), explanation: z.string() })).max(4).optional() }),
});
register('pending', 'Receive queued reader questions or prepared jobs. Poll only while actively helping the user. A waiting UI question needs paper_respond.', { wait: z.number().min(0).max(20).optional() }, true);
register('respond', 'Answer a pending reader UI request using the current Agent model. No separate API key. The UI then validates and saves it.', { job: z.string().uuid(), answer: z.string().min(1).max(60000) });
register('export', 'Export notes and completed answers to a user-requested absolute Markdown file. Never overwrites.', { paper, output: z.string() });
await server.connect(new StdioServerTransport());
