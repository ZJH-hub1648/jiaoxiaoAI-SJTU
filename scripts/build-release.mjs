#!/usr/bin/env node

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { createReleaseArchive } from './lib/release.js';

const { values } = parseArgs({
  options: {
    output: { type: 'string' },
  },
});

const root = resolve('.');
const outputDirectory = values.output ? resolve(values.output) : resolve(root, 'dist', 'releases');
try {
  const result = await createReleaseArchive({ root, outputDirectory });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`错误：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
