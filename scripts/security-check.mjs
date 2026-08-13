import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const failures = [];

function fail(message) {
  failures.push(message);
}

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const appFiles = await collectFiles(join(projectRoot, 'apps'));
const functionFiles = await collectFiles(join(projectRoot, 'supabase', 'functions'));

for (const file of appFiles) {
  const extension = extname(file);
  if (!['.html', '.js'].includes(extension)) continue;
  const source = await readFile(file, 'utf8');
  const displayPath = relative(projectRoot, file);

  if (source.includes('cdn.jsdelivr.net/npm/@supabase/supabase-js@2</script>')) {
    fail(`${displayPath}: Supabase JS sem versão fixa.`);
  }

  if (source.includes('cdn.sheetjs.com/')
    && (!source.includes('XLSX_INTEGRITY') || !source.includes("crossOrigin = 'anonymous'") && !source.includes("crossOrigin='anonymous'"))) {
    fail(`${displayPath}: SheetJS externo sem SRI/crossorigin.`);
  }

  if (extension === '.html') {
    const externalScripts = source.match(/<script\b[^>]*\bsrc="https:\/\/[^">]+"[^>]*><\/script>/g) || [];
    for (const tag of externalScripts) {
      if (!tag.includes(' integrity="sha384-') || !tag.includes(' crossorigin="anonymous"')) {
        fail(`${displayPath}: script externo sem SRI/crossorigin: ${tag.slice(0, 140)}`);
      }
    }
  }
}

for (const file of functionFiles) {
  if (extname(file) !== '.ts') continue;
  const source = await readFile(file, 'utf8');
  const displayPath = relative(projectRoot, file);
  if (/npm:@supabase\/supabase-js@2(?:['"])/.test(source)) {
    fail(`${displayPath}: dependência Supabase da Edge Function sem versão exata.`);
  }
  if (/\.payment_method_types\s*=/.test(source) || /(?:^|[{,]\s*)payment_method_types\s*:/m.test(source)) {
    fail(`${displayPath}: payment_method_types deve ser substituído por configuração dinâmica da Stripe.`);
  }
}

for (const paymentFunction of ['nexus-public-sales', 'stripe-create-checkout', 'stripe-webhook']) {
  const source = await readFile(join(projectRoot, 'supabase', 'functions', paymentFunction, 'index.ts'), 'utf8');
  if (!source.includes('NEXUS_PAYMENT_LIVE_ENABLED')) {
    fail(`supabase/functions/${paymentFunction}/index.ts: interruptor explícito de pagamentos live ausente.`);
  }
}

const authSource = await readFile(join(projectRoot, 'apps', 'sst-controle', 'supabase-auth.js'), 'utf8');
if (authSource.includes('select.innerHTML') || authSource.includes('panel.innerHTML')) {
  fail('apps/sst-controle/supabase-auth.js: dados de organização ainda entram por innerHTML.');
}

const headers = await readFile(join(projectRoot, '_headers'), 'utf8');
for (const requiredHeader of ['Content-Security-Policy:', 'Strict-Transport-Security:', 'X-Content-Type-Options:']) {
  if (!headers.includes(requiredHeader)) fail(`_headers: cabeçalho ausente: ${requiredHeader}`);
}

const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
const supabaseVersion = packageJson.dependencies?.['@supabase/supabase-js'];
if (!/^\d+\.\d+\.\d+$/.test(supabaseVersion || '')) {
  fail('package.json: @supabase/supabase-js precisa usar versão exata.');
}

if (failures.length) {
  console.error(failures.map(item => `- ${item}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Security checks passed.');
}
