#!/usr/bin/env node
/**
 * Public HTTP smoke checks for the SST domain cutover.
 * Read-only: no credentials, no login, no state-changing requests.
 * Node.js 18+. Override SST_BASE_URL / SST_OLD_BASE_URL to test staging.
 */
const currentBase = process.env.SST_BASE_URL || 'https://sst.nexuscore.app.br';
const legacyBase = process.env.SST_OLD_BASE_URL || 'https://nexuscore.app.br';

function safeBase(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('BASE_URL deve ser origem HTTPS sem caminho, credenciais, consulta ou fragmento.');
  }
  return url.origin;
}

const bases = [
  { label: 'Novo domínio SST', url: safeBase(currentBase) },
  { label: 'Domínio legado', url: safeBase(legacyBase) }
];
const pages = [
  { path: '/', check: /apps\/site-captacao\//i, name: 'Redirecionamento de raiz para SST' },
  { path: '/apps/site-captacao/', check: /<title>[^<]*Nexus SST/i, name: 'Site comercial SST' },
  { path: '/apps/sst-controle/login.html', check: /<title>[^<]*(?:SST Controle|Nexus SST)/i, name: 'Login SST' },
  { path: '/apps/portal-cliente/login.html', check: /<title>/i, name: 'Login Portal do Cliente' }
];

let failures = 0;
for (const base of bases) {
  console.log('\n' + base.label + ': ' + base.url);
  for (const page of pages) {
    const url = base.url + page.path;
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(12000), headers: { Accept: 'text/html' } });
      const text = await response.text();
      const ok = response.ok && page.check.test(text);
      console.log((ok ? 'PASS' : 'FAIL') + ' ' + page.name + ' (' + response.status + ')');
      if (!ok) failures++;
    } catch (error) {
      console.log('FAIL ' + page.name + ' (' + String(error?.message || error) + ')');
      failures++;
    }
  }
}
console.log('\n' + (failures ? 'Falhas HTTP: ' + failures : 'Todos os testes HTTP passaram.'));
console.log('IMPORTANTE: login real, recuperação, checkout e PWA ainda exigem homologação manual.');
if (failures) process.exitCode = 1;
