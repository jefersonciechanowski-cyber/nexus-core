import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = name => readFileSync(new URL('../apps/nexus-admin/' + name, import.meta.url), 'utf8');
const index = file('index.html');
const accounts = file('accounts.html');
const legacyLeads = file('leads.html');
const crmAccess = file('crm-access.html');
const pix = file('crm-live-pix-pilot.html');
const theme = file('central-nexus-v2.css');
const toolsTheme = file('central-nexus-tools-v3.css');
const ai = file('nexus-ai-preview.js');
const nav = page => page.match(/<nav class="nav"[\s\S]*?<\/nav>/)?.[0];

test('same primary navigation in all shell pages; commercial CRM is not reintroduced', () => {
  const labels = ['Visão Geral', 'Contas e Consultorias', 'Clientes e Acessos', 'Produtos e Planos', 'Pagamentos', 'Nexus AI'];
  for (const page of [index, accounts, legacyLeads]) {
    const mainNav = nav(page);
    assert.ok(mainNav);
    assert.doesNotMatch(mainNav, /CRM Comercial|href="leads\.html"/);
    let previous = -1;
    for (const label of labels) {
      const next = mainNav.indexOf(label);
      assert.ok(next > previous, 'Out of order: ' + label);
      previous = next;
    }
    assert.match(page, /href="central-nexus-v2\.css"/);
    assert.match(page, /class="central-nexus-v2"/);
    assert.match(page, /logo-nexus-core\.png/);
  }
});

test('contracts, payments and old direct-link workflows retain their elements', () => {
  assert.match(index, /nexus-admin-crm-access/);
  assert.match(index, /href="crm-access\.html"/);
  assert.match(index, /id="planForm"/);
  assert.match(index, /id="paymentRows"/);
  assert.match(accounts, /id="accountForm"/);
  assert.match(legacyLeads, /id="newLeadForm"/);
  assert.match(legacyLeads, /CRM Comercial/);
  assert.match(crmAccess, /id="courtesyForm"/);
  assert.match(pix, /id="asaasCheck"/);
});

test('all supplementary admin screens reuse the same dark-green palette', () => {
  for (const page of [crmAccess, pix]) {
    assert.match(page, /class="central-nexus-tools-v3"/);
    assert.match(page, /href="central-nexus-tools-v3\.css"/);
  }
  assert.match(toolsTheme, /--surface:rgba\(23,72,64,\.58\)/);
  assert.match(toolsTheme, /backdrop-filter:blur\(13px\)/);
});

test('Nexus AI remains authenticated, embedded and voice-enabled', () => {
  assert.match(index, /data-view="ai" hidden/);
  assert.match(index, /id="view-ai" hidden/);
  assert.match(ai, /host\.replaceChildren\(dialog\)/);
  assert.match(ai, /dialog\.show\(\)/);
  assert.doesNotMatch(ai, /dialog\.showModal\(\)/);
  assert.match(ai, /session\?\.role !== 'nexus_admin'/);
  assert.match(ai, /currentLevel === 'aal2'/);
  assert.match(ai, /if \(!await sessionAllowed\(\)\)/);
  assert.match(ai, /functions\.invoke\('nexus-ai-core'/);
  assert.match(ai, /voiceOrb\.addEventListener\('click',toggleVoice\)/);
});

test('theme has one stable base instead of conflicting screen-dependent layout overrides', () => {
  assert.match(theme, /--bg:#061c1c/);
  assert.match(theme, /background-attachment:fixed/);
  assert.match(theme, /scrollbar-gutter:stable/);
  assert.match(theme, /\.side\s*\{/);
  assert.match(theme, /\.card\s*\{/);
  assert.match(theme, /\.table-wrap\s*\{/);
  assert.doesNotMatch(theme, /:has\(/);
  assert.doesNotMatch(theme, /translateY\(/);
  assert.doesNotMatch(theme, /scroll-behavior:smooth/);
});

test('translucent panels remain readable and respect reduced motion and keyboard', () => {
  assert.match(theme, /background:linear-gradient\(145deg,rgba\(35,89,80,\.48\)/);
  assert.match(theme, /backdrop-filter:blur\(13px\)/);
  assert.match(theme, /focus-visible/);
  assert.match(theme, /prefers-reduced-motion:reduce/);
  assert.match(theme, /\.badge\.good/);
  assert.match(theme, /\.badge\.bad/);
});

test('AI viewport and chat scroll stay within their container without clipping', () => {
  assert.match(theme, /height:max\(570px,calc\(100dvh - 222px\)\)/);
  assert.match(theme, /#view-ai \.nexus-v3-dialog\.nexus-ai-embedded/);
  assert.match(theme, /\.nexus-v6-chat-column\s*\{/);
  assert.match(theme, /\.nexus-v5-chat-log\s*\{/);
  assert.match(theme, /overflow-y:auto!important/);
  assert.match(theme, /@media\(max-width:900px\)/);
});
