#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { installSkill } from '../lib/deploy.mjs';
try {
  const { values } = parseArgs({ options: { agent: { type: 'string' }, target: { type: 'string' } } });
  console.log(JSON.stringify({ ok: true, ...await installSkill(values) }, null, 2));
} catch (error) { console.log(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; }
