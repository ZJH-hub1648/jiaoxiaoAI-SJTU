import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

test('Token 表单回车提交使用实际表单且不会重复提交', async () => {
  const handlers = {};
  const calls = [];
  const wizard = { addEventListener: (name, handler) => { handlers[name] = handler; } };
  const element = { querySelectorAll: () => [] };
  const form = { matches: (selector) => selector === 'form[data-form="token"]' };
  const data = {
    version: 'test', credential: { configured: false }, platforms: [],
    environment: { python: { supported: true }, node: { supported: true }, npm: {} },
  };
  runInNewContext(await readFile(new URL('../installer/ui/app.js', import.meta.url), 'utf8'), {
    document: { querySelector: (selector) => selector === '#wizard' ? wizard : element },
    FormData: class {
      constructor(target) { assert.equal(target, form); }
      get(name) { assert.equal(name, 'token'); return 'test-token'; }
    },
    fetch: async (path, options) => {
      calls.push({ path, options });
      return { ok: true, json: async () => path === '/api/state' ? data : { ok: true } };
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  let prevented = false;
  const event = { target: form, currentTarget: wizard, preventDefault: () => { prevented = true; } };
  const first = handlers.submit(event);
  const duplicate = handlers.submit(event);
  await Promise.all([first, duplicate]);
  assert.equal(prevented, true);
  const submissions = calls.filter((call) => call.path === '/api/token');
  assert.equal(submissions.length, 1);
  assert.deepEqual(JSON.parse(submissions[0].options.body), { token: 'test-token' });
});
