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

test('support tab appears in Central while legacy admin screens remain usable', () => {
  const labels = ['Nexus AI','Visão Geral','Contas e Consultorias','Clientes e Acessos','Produtos e Planos','Pagamentos','Cortesias CRM'];
  for (const page of [index, accounts, legacyLeads]) {
    const mainNav = nav(page);
    assert.ok(mainNav);
    assert.doesNotMatch(mainNav,/CRM Comercial|href="leads\.html"/);
    let previous = -1;
    for (const label of labels) {
      const next = mainNav.indexOf(label);
      assert.ok(next > previous, 'Missing or out-of-order nav: ' + label);
      previous = next;
    }
    assert.equal((mainNav.match(/data-view="/g) || []).length, page === index ? 8 : 7);
    assert.doesNotMatch(page, /<summary>Ferramentas<\/summary>/);
    assert.doesNotMatch(page, /Teste Pix R\$ 10/);
    assert.match(page, /href="central-nexus-v2\.css"/);
    assert.match(page, /class="central-nexus-v2"/);
    assert.match(page, /logo-nexus-core\.png/);
  }
  assert.doesNotMatch(crmAccess, /Pix real R\$ 10/);
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
  assert.match(index, /id="nexus-ai-preview-trigger" data-view="ai"[^>]*>Nexus AI<\/button>/);
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
  assert.match(index, /data-view="accounts"[^>]*aria-label="Contas e Consultorias"[^>]*>Contas<\/button>/);
  assert.match(index, /data-view="courtesy"[^>]*aria-label="Cortesias CRM e SST"[^>]*>Cortesias<\/button>/);
  assert.match(index, /id="view-accounts" hidden/);
  assert.match(index, /id="view-courtesy" hidden/);
  assert.equal((index.match(/data-central-embedded title=/g) || []).length, 2);
  assert.match(index, /src="central-tabs.js"/);
  assert.match(index, /data-central-open="courtesy"/);
  assert.match(tabs, /const paths = \{accounts:'accounts\?embedded=1',courtesy:'crm-access\?embedded=1'\}/);
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
    const lines = headers.split('\n');
    const start = lines.findIndex(line => line.trim() === '/apps/nexus-admin/' + path);
    assert.ok(start >= 0, 'Missing path-specific headers for ' + path);
    const nextBlank = lines.findIndex((line, i) => i > start && line.trim() === '');
    const block = lines.slice(start, nextBlank > start ? nextBlank : undefined).join('\n');
    assert.match(block, /! X-Frame-Options/);
    assert.match(block, /X-Frame-Options: SAMEORIGIN/);
    assert.match(block, /! Content-Security-Policy/);
    assert.match(block, /frame-ancestors 'self'/);
  }
  assert.equal((headers.match(/X-Frame-Options: SAMEORIGIN/g) || []).length, 4);
  assert.equal((headers.match(/frame-ancestors 'self'/g) || []).length, 4);
  assert.doesNotMatch(headers, /script-src 'unsafe-inline'/);
});

test('eight accessible tabs occupy exactly one header row without Ferramentas', () => {
  const tabs = file('central-tabs.js');
  for (const view of ['ai','overview','accounts','clients','products','payments','courtesy','support']) {
    assert.match(nav(index),new RegExp('data-view="' + view + '"[^>]*data-short="'));
  }
  assert.match(theme,/grid-template-columns:repeat\(8,minmax\(0,1fr\)\)!important/);
  assert.match(theme,/grid-template-rows:42px!important;grid-auto-rows:0!important/);
  assert.match(theme,/overflow:hidden!important/);
  assert.match(theme,/body\.central-nexus-v2 \.side \.sidebar-tools\{display:none!important\}/);
  assert.match(tabs,/new MutationObserver\(normalizeNavigation\)/);
  assert.match(tabs,/nav\.replaceChildren\(\.\.\.selected\)/);
  assert.match(tabs,/current\.some\(\(node,i\) => node !== selected\[i\]\)/);
  assert.doesNotMatch(index,/href="crm-live-pix-pilot\.html"/);
  assert.doesNotMatch(index,/<details class="sidebar-tools"/);
});

test('canonical iframe routes are checked against origin and existing forms', () => {
  const tabs = file('central-tabs.js');
  assert.match(tabs,/const paths = \{accounts:'accounts\?embedded=1',courtesy:'crm-access\?embedded=1'\}/);
  assert.match(tabs,/inner\.location\.origin === location\.origin/);
  assert.match(tabs,/canonical\.endsWith\('\/' \+ target\)/);
  assert.match(tabs,/canonical\.endsWith\('\/' \+ target \+ '\.html'\)/);
  assert.match(tabs,/doc\?\.getElementById\(view === 'accounts' \? 'accountForm' : 'courtesyForm'\)/);
  assert.match(tabs,/new ResizeObserver/);
  assert.match(tabs,/data-central-retry/);
  assert.match(index,/data-central-retry="accounts"/);
  assert.match(index,/data-central-retry="courtesy"/);
});

test('AI tab stays present from the start and remains protected by MFA', () => {
  assert.match(index, /data-view="ai"[^>]*>Nexus AI/);
  assert.doesNotMatch(index, /id="nexus-ai-preview-trigger" data-view="ai" hidden/);
  assert.match(ai, /if \(!await sessionAllowed\(\)\) return/);
  assert.match(ai, /window\.dispatchEvent\(new CustomEvent\('nexus:central:view',\{detail:\{view:'ai'\}\}\)\)/);
  assert.match(ai, /if\(dialog\.open\)\{\s*stopVoice\(\);\s*svg\.pauseAnimations\?\.\(\)/);
});

test('AI controls use lightweight labeled tabs without changing handlers', () => {
  assert.doesNotThrow(() => new Function(ai), 'Nexus AI script should parse');
  const sourceLines = ai.split('\n');
  const encoded = name => {
    const line = sourceLines.find(line => line.startsWith('  const ' + name + '='));
    assert.ok(line, 'Missing Nexus AI ' + name);
    return JSON.parse(line.slice(line.indexOf('=') + 1).replace(/;\s*$/, ''));
  };
  const markup = encoded('MARKUP');
  const style = encoded('STYLE');
  for (const [key,label,icon] of [
    ['network','Conversa','◎'],['agents','Agentes','✧'],['integrations','Integrações','⬡']
  ]) {
    const expected = 'data-tab="' + key + '" aria-label="' + label +
      '" data-tooltip="' + label + '"><span class="nexus-v3-icon" aria-hidden="true">' +
      icon + '</span><span class="nexus-v18-tab-label" aria-hidden="true">' + label + '</span></button>';
    assert.ok(markup.includes(expected), 'Accessible lightweight tab required for ' + label);
  }
  assert.match(style, /content:attr\(data-tooltip\)/);
  assert.match(style, /nexus-v3-tab\[data-tooltip\]:is\(:hover,:focus-visible\)::after/);
  assert.match(style, /nexus-v3-tab\[data-tooltip\] \.nexus-v3-icon\{/);
  assert.doesNotMatch(style, /html:has\(dialog\.nexus-v3-dialog\[open\]\),body:has\(dialog\.nexus-v3-dialog\[open\]\)\{overflow:hidden!important\}/);
  assert.match(ai, /voiceOrb\.addEventListener\('click',toggleVoice\)/);
});

test('ambient Nexus background is persistent across Central tabs and administrative pages', () => {
  const ambient = file('central-nexus-ambient.css');
  for (const html of [index,accounts,legacyLeads,crmAccess,pix]) {
    assert.match(html, /href="central-nexus-ambient\.css"/);
  }
  assert.match(ambient, /body\.central-nexus-v2::before/);
  assert.match(ambient, /body\.central-nexus-tools-v3::after/);
  assert.match(ambient, /@keyframes nexus-ambient-orbit/);
  assert.match(ambient, /@keyframes nexus-ambient-grid-breathe/);
  assert.match(ambient, /prefers-reduced-motion:reduce/);
  assert.match(ambient, /html\.nexus-embedded body\.central-nexus-v2::before/);
  assert.match(ambient, /pointer-events:none/);
  assert.match(ambient, /position:fixed/);
  assert.doesNotMatch(ambient, /unsafe-inline/);
});

test('Nexus AI full-bleed mode removes double headers and isolated cards without changing business functions', () => {
  const immersive = file('central-ai-immersive.css');
  const tabs = file('central-tabs.js');
  const ambient = file('central-nexus-ambient.css');
  const lines = ai.split('\n');
  const decoded = name => JSON.parse(
    lines.find(line => line.startsWith('  const ' + name + '='))
      .split('=').slice(1).join('=').replace(/;\s*$/, '')
  );
  const style = decoded('STYLE');
  const markup = decoded('MARKUP');
  assert.match(index, /href="central-ai-immersive\.css"/);
  assert.match(tabs, /classList\.toggle\('central-ai-active',location\.hash === '#ai'\)/);
  assert.match(immersive, /central-ai-active \.main > \.top/);
  assert.match(immersive, /central-ai-active #view-ai \.central-ai-workspace/);
  assert.match(immersive, /background:transparent!important/);
  assert.match(style, /Nexus AI v18: open immersion/);
  assert.match(style, /\.nexus-v7-header-identity,/);
  assert.match(style, /\.nexus-v3-top-right\{display:none!important\}/);
  assert.match(style, /\.nexus-v3-details,/);
  assert.match(style, /\.nexus-v3-map-bottom \{display:none!important\}/);
  assert.match(style, /\.nexus-v3-hub \.nexus-v12-voice-core\{display:none!important\}/);
  assert.match(style, /nexus-v18-tab-label/);
  assert.match(markup, /class="nexus-v12-microphone"/);
  assert.match(ai, /voiceOrb\.addEventListener\('click',toggleVoice\)/);
  assert.match(ai, /functions\.invoke\('nexus-ai-core'/);
  assert.match(ambient, /central-nexus-wave\.svg/);
  const wave = file('central-nexus-wave.svg');
  assert.match(wave, /<svg[^>]+viewBox="0 0 1440 290"/);
  assert.match(wave, /<polyline/);
  assert.doesNotMatch(wave, /<script|<foreignObject|xlink:href/);
});

test('full-bleed is exclusive to Nexus AI and other tabs retain administrative header', () => {
  const immersive = file('central-ai-immersive.css');
  assert.match(immersive, /body\.central-nexus-v2\.central-ai-active/);
  assert.doesNotMatch(immersive, /body\.central-nexus-v2\s+\.main\s*>\s*\.top/);
  assert.match(index, /id="logout"/);
  assert.match(index, /id="view-accounts"/);
  assert.match(index, /id="view-courtesy"/);
});
test('support has MFA gate, safe status update and no automatic AI execution', () => {
  const support = file('central-support.js');
  const intake = readFileSync(new URL('../apps/sst-controle/nexus-support.js', import.meta.url), 'utf8');
  const publicPage = readFileSync(new URL('../apps/site-captacao/suporte.html', import.meta.url), 'utf8');
  assert.match(index, /id="view-support" hidden/);
  assert.match(index, /src="central-support.js"/);
  assert.match(support, /aal\?\.currentLevel !== 'aal2'/);
  assert.match(support, /from\('support_requests'\)/);
  assert.match(support, /\.eq\('id',ticket\.id\)\.eq\('status',ticket\.status\)/);
  assert.doesNotMatch(support, /service_role|eval\(|innerHTML/);
  assert.match(intake, /const protocol = String\(data\.protocol/);
  assert.match(intake, /whatsapp\.hidden = true/);
  assert.match(intake, /whatsapp\.hidden = false/);
  assert.match(intake, /5546999089058/);
  assert.match(intake, /product === 'crm'/);
  assert.match(publicPage, /supabase-config\.js/);
  assert.match(publicPage, /noindex,nofollow,noarchive/);
  assert.doesNotMatch(publicPage, /<script>\s*[^<]/);
});

test('support notifications use admin MFA and an explicit browser opt-in', () => {
  const alerts = file('central-support-alerts.js');
  const support = file('central-support.js');
  const style = file('central-support.css');
  assert.match(index,/id="supportEnableBrowserAlerts"/);
  assert.match(index,/id="supportAlertSummary"/);
  assert.match(index,/src="central-support-alerts.js"/);
  assert.match(alerts,/\.eq\('status','open'\)/);
  assert.match(alerts,/\.select\('id,protocol,created_at',\{count:'exact'\}\)/);
  assert.match(alerts,/aal\?\.currentLevel !== 'aal2'/);
  assert.match(alerts,/Notification\.requestPermission\(\)/);
  assert.match(alerts,/const POLL_INTERVAL_MS = 60_000/);
  assert.doesNotMatch(alerts,/service_role|requester_email|\.innerHTML|\.insert\(/);
  assert.match(support,/nexus:support:changed/);
  assert.match(style,/data-support-alert-count/);
});

test('iPhone web app and push lifecycle remain restricted to Central support', () => {
  const pwa = file('central-push.js');
  const sw = file('sw.js');
  const manifest = JSON.parse(file('manifest.webmanifest'));
  const support = file('central-support.css');
  const receiver = readFileSync(new URL('../supabase/functions/nexus-support-push/index.ts', import.meta.url),'utf8');
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.scope,'/apps/nexus-admin/');
  assert.equal(manifest.start_url,'/apps/nexus-admin/#support');
  assert.match(index,/rel="manifest" href="manifest.webmanifest"/);
  assert.match(index,/id="supportEnablePush"/);
  assert.match(index,/id="supportTestPush"/);
  assert.match(index,/id="supportDisablePush"/);
  assert.match(index,/src="central-push.js"/);
  assert.match(pwa,/Notification\.requestPermission\(\)/);
  assert.match(pwa,/applicationServerKey:base64ToBytes\(PUBLIC_VAPID_KEY\)/);
  assert.match(pwa,/async function credential\(\)/);
  assert.match(receiver,/is_nexus_admin_aal2/);
  assert.match(receiver,/action === 'dispatch'/);
  assert.match(receiver,/action === 'test'/);
  assert.match(receiver,/getVapid\(admin\)/);
  assert.match(sw,/self\.addEventListener\('push'/);
  assert.match(sw,/self\.addEventListener\('notificationclick'/);
  assert.doesNotMatch(sw,/addEventListener\('fetch'/);
  assert.doesNotMatch(receiver,/GP12o9r24|gp12o9r24CIR/);
  assert.match(support,/#supportEnablePush/);
});
