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
const pilot = file('pilot.js');
const nav = page => page.match(/<nav class="nav"[\s\S]*?<\/nav>/)?.[0];

test('same primary navigation in all shell pages; commercial CRM is not reintroduced', () => {
  const coreLabels = ['Visão Geral', 'Contas e Consultorias', 'Clientes e Acessos', 'Produtos e Planos', 'Pagamentos'];
  const indexLabels = ['Nexus AI', ...coreLabels, 'Cortesias CRM'];
  for (const page of [index, accounts, legacyLeads]) {
    const mainNav = nav(page);
    assert.ok(mainNav);
    assert.doesNotMatch(mainNav, /CRM Comercial|href="leads\.html"/);
    let previous = -1;
    for (const label of (page === index ? indexLabels : [...coreLabels, 'Nexus AI'])) {
      const next = mainNav.indexOf(label);
      assert.ok(next > previous, 'Out of order: ' + label);
      previous = next;
    }
    assert.match(page, /href="central-nexus-v2\.css"/);
    assert.match(page, /class="central-nexus-v2"/);
    assert.match(page, /logo-nexus-core\.png/);
    assert.match(page, /class="sidebar-tools"/);
    assert.match(page, /class="central-tools-menu"/);
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
  assert.match(index, /id="nexus-ai-preview-trigger" data-view="ai">Nexus AI<\/button>/);
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

test('view switching renders all sections after the initial shared data request', () => {
  assert.match(index, /function renderAll\(\)\{renderSummary\(\);renderOverview\(\);renderClients\(\);renderProducts\(\);renderPayments\(\);\}/);
  assert.match(index, /const changed=view!==activeView/);
  assert.match(index, /if\(changed&&window\.scrollY>0\)window\.scrollTo\(\{top:0,behavior:'auto'\}\)/);
  assert.doesNotMatch(index.match(/function setView\(view\)\{[\s\S]*?\n/)?.[0] || '', /loadData\(|renderAll\(/);
});

test('navigation does not change button width or reintroduce a CRM Comercial entry', () => {
  const mainNav = index.match(/<nav class="nav"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(mainNav);
  assert.doesNotMatch(mainNav, /CRM Comercial|href="leads\.html"/);
  assert.match(theme, /\.nav \[data-nexus-leads-link\]\{display:none!important\}/);
  assert.match(theme, /font-variant-numeric:tabular-nums/);
  assert.match(theme, /font-weight:530;\s*\}\s*\.central-nexus-v2 \.nav a:focus-visible/);
});

test('AI uses full available desktop viewport and leaves other tabs unchanged', () => {
  assert.match(ai, /classList\.toggle\('central-ai-active',event\.detail\?\.view==='ai'\)/);
  assert.match(ai, /classList\.remove\('central-ai-active'\)/);
  assert.match(theme, /body\.central-nexus-v2\.central-ai-active\{height:100dvh;overflow:hidden\}/);
  assert.match(theme, /\.central-nexus-v2\.central-ai-active #view-ai \.central-ai-workspace\s*\{/);
  assert.match(theme, /flex:1 1 0;min-height:0;height:auto;max-height:none/);
  assert.match(theme, /nexus-v5-chat-log[\s\S]*?overflow-y:auto!important/);
  assert.match(theme, /@media \(min-width:901px\)/);
});

test('SST pilot scroll is immediate and minimizes movement', () => {
  assert.match(pilot, /scrollIntoView\(\{behavior:'auto',block:'nearest'\}\)/);
  assert.doesNotMatch(pilot, /scrollIntoView\(\{behavior:'smooth'/);
});

test('Contas e Cortesias are inside one persistent shell and not external navigation links', () => {
  const tabs = file('central-tabs.js');
  const embed = file('central-embed.js');
  const css = file('central-embedded.css');
  assert.match(index, /data-view="accounts" aria-label="Contas e Consultorias"[^>]*>Contas<\/button>/);
  assert.match(index, /data-view="courtesy" aria-label="Cortesias CRM"[^>]*>Cortesias<\/button>/);
  assert.match(index, /id="view-accounts" hidden/);
  assert.match(index, /id="view-courtesy" hidden/);
  assert.equal((index.match(/data-central-embedded title=/g) || []).length, 2);
  assert.match(index, /src="central-tabs.js"/);
  assert.match(index, /data-central-open="courtesy"/);
  assert.match(tabs, /const paths = \{accounts:'accounts\.html\?embedded=1',courtesy:'crm-access\.html\?embedded=1'\}/);
  assert.match(tabs, /loaded\.add\(view\)/);
  assert.match(tabs, /window\.addEventListener\('nexus:central:view'/);
  assert.match(embed, /window\.parent\.location\.origin !== location\.origin/);
  assert.match(accounts, /src="central-embed.js"/);
  assert.match(crmAccess, /src="central-embed.js"/);
  assert.match(css, /html\.nexus-embedded/);
});

test('only the two administrative resources and their canonical aliases allow same-origin embedding', () => {
  const headers = readFileSync(new URL('../_headers', import.meta.url), 'utf8');
  assert.match(headers, /X-Frame-Options: DENY/);
  assert.match(headers, /frame-ancestors 'none'/);
  for (const path of ['accounts.html', 'accounts', 'crm-access.html', 'crm-access']) {
    const block = headers.split(/\n\n/).find(s => s.startsWith('/apps/nexus-admin/' + path + '\n')) || '';
    assert.ok(block, 'Missing path-specific headers for ' + path);
    assert.match(block, /! X-Frame-Options/);
    assert.match(block, /X-Frame-Options: SAMEORIGIN/);
    assert.match(block, /! Content-Security-Policy/);
    assert.match(block, /frame-ancestors 'self'/);
  }
  assert.equal((headers.match(/X-Frame-Options: SAMEORIGIN/g) || []).length, 4);
  assert.equal((headers.match(/frame-ancestors 'self'/g) || []).length, 4);
  assert.doesNotMatch(headers, /script-src 'unsafe-inline'/);
});

test('seven compact tabs fit the main header without a horizontal scrollbar', () => {
  const tabs = file('central-tabs.js');
  assert.match(index, /data-view="accounts" aria-label="Contas e Consultorias"[^>]*>Contas<\/button>/);
  assert.match(index, /data-view="clients" aria-label="Clientes e Acessos"[^>]*>Clientes<\/button>/);
  assert.match(index, /data-view="products" aria-label="Produtos e Planos"[^>]*>Planos<\/button>/);
  assert.match(index, /data-view="courtesy" aria-label="Cortesias CRM"[^>]*>Cortesias<\/button>/);
  assert.match(theme, /grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
  assert.match(theme, /overflow:visible;scrollbar-width:none/);
  assert.match(theme, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(tabs, /nav\.replaceChildren\(\.\.\.selected\)/);
  assert.match(tabs, /button\.setAttribute\('aria-label',label\)/);
});

test('canonical same-origin routes are recognized after Cloudflare omits .html', () => {
  const tabs = file('central-tabs.js');
  assert.match(tabs, /canonicalPath\.endsWith\('\/' \+ target\)/);
  assert.match(tabs, /canonicalPath\.endsWith\('\/' \+ target \+ '\.html'\)/);
  assert.match(tabs, /doc\?\.getElementById\(requiredForm\)/);
  assert.match(tabs, /view === 'accounts' \? 'accountForm' : 'courtesyForm'/);
});

test('AI tab stays present from the start and remains protected by MFA', () => {
  assert.match(index, /data-view="ai">Nexus AI/);
  assert.doesNotMatch(index, /id="nexus-ai-preview-trigger" data-view="ai" hidden/);
  assert.match(ai, /if \(!await sessionAllowed\(\)\) return/);
  assert.match(ai, /window\.dispatchEvent\(new CustomEvent\('nexus:central:view',\{detail:\{view:'ai'\}\}\)\)/);
  assert.match(ai, /if\(dialog\.open\)\{\s*stopVoice\(\);\s*svg\.pauseAnimations\?\.\(\)/);
});
