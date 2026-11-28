import { realpath } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
export async function canonical(path) {
  try { return await realpath(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return join(await canonical(dirname(path)), basename(path)); }
}
