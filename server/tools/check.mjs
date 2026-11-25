import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
let failed = false;
for (const folder of ['src', 'tests', 'tools']) {
  for (const file of readdirSync(join(root, folder)).filter(value => /\.(js|mjs)$/.test(value))) {
    const result = spawnSync(process.execPath, ['--check', join(root, folder, file)], { stdio: 'inherit' });
    if (result.status !== 0) failed = true;
  }
}
if (failed) process.exitCode = 1;
else console.log('Merchant server JavaScript syntax checks passed.');
