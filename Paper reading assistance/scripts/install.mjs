#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { installSkill } from '../lib/deploy.js';
try {
  const { values } = parseArgs({ options: { agent: { type: 'string' }, target: { type: 'string' } } });
  console.log(JSON.stringify({ ok: true, ...await installSkill({ agent: values.agent || 'custom', target: values.target }) }, null, 2));
} catch (err) { console.log(JSON.stringify({ ok: false, error: err.message })); process.exitCode = 1; }
