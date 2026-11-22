import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../apps/nexus-admin/index.html', import.meta.url), 'utf8');
const accounts = readFileSync(new URL('../apps/nexus-admin/accounts.html', import.meta.url), 'utf8');
const ai = readFileSync(new URL('../apps/nexus-admin/nexus-ai-preview.js', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../apps/nexus-admin/central-nexus-v2.css', import.meta.url), 'utf8');

test('navegação da Central mantém recursos e oculta somente CRM Comercial legado', () => {
  assert.doesNotMatch(html, /href="leads.html"/);
  assert.doesNotMatch(accounts, /href="leads.html"/);
  assert.match(html, /href="crm-access.html"/);
  assert.match(html, /nexus-admin-crm-access/);
  assert.match(html, /data-view="payments"/);
  assert.match(html, /data-view="clients"/);
  assert.match(html, /data-view="products"/);
  assert.match(html, /logo-nexus-core.png/);
});

test('abas da Central incluem Nexus AI sem modal separado', () => {
  assert.match(html, /data-view="ai" hidden/);
  assert.match(html, /id="view-ai" hidden/);
  assert.match(html, /id="nexus-ai-workspace"/);
  assert.match(html, /nexus:central:view/);
  assert.match(ai, /host\.replaceChildren\(dialog\)/);
  assert.match(ai, /dialog\.show\(\)/);
  assert.doesNotMatch(ai, /dialog\.showModal\(\)/);
  assert.match(theme, /\.nav button\[hidden\]\{display:none!important\}/);
  assert.match(theme, /\.nexus-ai-embedded:not\(\[open\]\)/);
});

test('voz, autorização MFA, integrações e backend da IA permanecem preservados', () => {
  assert.match(ai, /session\?\.role !== 'nexus_admin'/);
  assert.match(ai, /currentLevel === 'aal2'/);
  assert.match(ai, /if \(!await sessionAllowed\(\)\)/);
  assert.match(ai, /functions\.invoke\('nexus-ai-core'/);
  assert.match(ai, /body:\{question,capability\}/);
  assert.match(ai, /voiceOrb\.addEventListener\('click',toggleVoice\)/);
});

test('novo tema compartilha visual Nexus entre páginas administrativas', () => {
  assert.match(html, /central-nexus-v2\.css/);
  assert.match(accounts, /central-nexus-v2\.css/);
  assert.match(html, /centralOverviewCards/);
  assert.match(html, /centralWorkQueue/);
  assert.match(theme, /#f5f7f8/);
});
