import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = [...readdirSync('src').filter(name => name.endsWith('.js')).map(name => `src/${name}`),
  ...readdirSync('tools').filter(name => name.endsWith('.mjs')).map(name => `tools/${name}`)];
for (const file of files) {
  const result = spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked ${files.length} JavaScript modules.`);
