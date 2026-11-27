import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveCanvas, checkCanvas, canvasStatus } from '../lib/canvas-auth.js';

test('Canvas Token 在线验证后才保存，状态不返回凭据，所有校验请求均只读', async () => {
  const root = await mkdtemp(join(tmpdir(), 'paper-canvas-auth-')); const tokenFile = join(root, 'private', 'token');
  const fetchImpl = async (url, options) => { assert.equal(url, 'https://oc.sjtu.edu.cn/api/v1/users/self/profile'); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, 'Bearer test-canvas-secret'); return new Response('{"id":123,"name":"Test Student"}', { headers: { 'content-type': 'application/json' } }); };
  try {
    const result = await saveCanvas('test-canvas-secret', { tokenFile, fetchImpl });
    assert.equal(result.savedTokenIsActive, true); assert.doesNotMatch(JSON.stringify(result), /test-canvas-secret/);
    assert.equal(await readFile(tokenFile, 'utf8'), 'test-canvas-secret\n');
    const status = await canvasStatus({ tokenFile }); assert.equal(status.configured, true); assert.doesNotMatch(JSON.stringify(status), /test-canvas-secret/);
    assert.equal((await checkCanvas({ tokenFile, fetchImpl })).connected, true);
    await assert.rejects(saveCanvas('new-invalid-secret', { tokenFile, fetchImpl: async () => new Response('private error body', { status: 401 }) }), /401/);
    assert.equal(await readFile(tokenFile, 'utf8'), 'test-canvas-secret\n', '验证失败不得覆盖已有 Token');
  } finally { await rm(root, { recursive: true, force: true }); }
});
