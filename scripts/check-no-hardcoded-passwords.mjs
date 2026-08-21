import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const roots = ['apps', 'scripts', 'supabase/functions'];
const failures = [];
const literalPasswordPattern = /\bpassword\s*:\s*(['"])(?=.{8,}\1)[^'"\r\n]+\1/gi;

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

for (const root of roots) {
  const files = await collectFiles(join(projectRoot, ...root.split('/')));
  for (const file of files) {
    if (!['.js', '.mjs', '.ts', '.html'].includes(extname(file))) continue;
    const source = await readFile(file, 'utf8');
    literalPasswordPattern.lastIndex = 0;
    if (literalPasswordPattern.test(source)) {
      failures.push(`${relative(projectRoot, file)}: senha literal detectada no código.`);
    }
  }
}

if (failures.length) {
  console.error(failures.map(item => `- ${item}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('No hardcoded password literals found.');
}
