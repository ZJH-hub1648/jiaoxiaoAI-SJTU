import { createRequire } from 'node:module';
import { InterviewApp } from './assessment.mjs';
export function createTools(dataDir) {
  const app = new InterviewApp(dataDir);
  return async function execute(action, input = {}) {
    switch (action) {
      case 'status': { let mcpReady = false; try { createRequire(import.meta.url).resolve('@modelcontextprotocol/sdk/server/mcp.js'); mcpReady = true; } catch {} return { version: '0.6.0-rc.1', node: process.version, platform: process.platform, arch: process.arch, dataDir: app.root, mcpReady, model: 'current-host-agent', extraModelKeyRequired: false }; }
      case 'index': return app.index(input);
      case 'inspect': return app.inspect(input.snapshot, input.query, input.limit);
      case 'evidence': return app.evidence(input.snapshot, input.evidence);
      case 'start': return app.start(input);
      case 'prepare': return app.prepare(input.session, { query: input.query, evidenceIds: input.evidenceIds });
      case 'question': return app.question(input.session, input.job, input.result);
      case 'answer': return app.answer(input.session, input.answer);
      case 'show': return app.show(input.session);
      case 'pause': case 'resume': case 'end': return app.transition(input.session, action);
      case 'prepare_hint': return app.prepareHint(input.session, input.level);
      case 'hint': return app.hint(input.session, input.job, input.result);
      case 'prepare_review': return app.prepareReview(input.session, input.round);
      case 'review': return app.review(input.session, input.job, input.result);
      case 'report': return app.report(input.session);
      case 'export': return app.exportReport(input.session, input.output);
      case 'list': return app.sessions();
      default: throw new Error('未知工具操作');
    }
  };
}
