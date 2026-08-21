import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const publicRoots = [
  'index.html',
  '404.html',
  'apps/site-captacao',
  'apps/sst-controle',
  'apps/nexus-admin',
  'apps/portal-cliente',
];
const failures = [];
const inlineHashes = new Set();

async function collectPublicFiles(relativePath) {
  const absolutePath = join(projectRoot, relativePath);
  const entry = await stat(absolutePath);
  if (entry.isFile()) return ['.html', '.js'].includes(extname(absolutePath)) ? [absolutePath] : [];

  const files = [];
  for (const child of await readdir(absolutePath, { withFileTypes: true })) {
    const childPath = join(relativePath, child.name);
    if (child.isDirectory()) files.push(...await collectPublicFiles(childPath));
    else if (child.isFile() && ['.html', '.js'].includes(extname(child.name))) files.push(join(projectRoot, childPath));
  }
  return files;
}

for (const root of publicRoots) {
  for (const file of await collectPublicFiles(root)) {
    const source = await readFile(file, 'utf8');
    if (/<[^>]*\son[a-z]+\s*=/i.test(source)) {
      failures.push(`${file}: manipulador JavaScript inline detectado.`);
    }

    if (extname(file) !== '.html') continue;
    for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=/i.test(match[1])) continue;
      const digest = createHash('sha256').update(match[2], 'utf8').digest('base64');
      inlineHashes.add(`'sha256-${digest}'`);
    }
  }
}

const headers = await readFile(join(projectRoot, '_headers'), 'utf8');
const policies = headers
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line.startsWith('Content-Security-Policy:'));

if (!policies.length) failures.push('_headers: nenhuma Content-Security-Policy encontrada.');

for (const policy of policies) {
  const scriptDirective = policy.match(/(?:^|;)\s*script-src\s+([^;]+)/)?.[1] || '';
  if (!scriptDirective) failures.push('_headers: diretiva script-src ausente.');
  if (scriptDirective.includes("'unsafe-inline'")) failures.push('_headers: script-src ainda permite unsafe-inline.');
  for (const hash of inlineHashes) {
    if (!scriptDirective.includes(hash)) failures.push(`_headers: hash CSP ausente: ${hash}`);
  }
}

if (failures.length) {
  console.error(failures.map(item => `- ${item}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`CSP checks passed (${inlineHashes.size} inline script hashes).`);
}
