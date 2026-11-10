import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const home=read('index.html'),css=read('site.css'),crm=read('crm/index.html'),
  sst=read('apps/site-captacao/index.html'),sstRoute=read('sst-controle/index.html'),
  build=read('scripts/prepare-cloudflare.mjs'),sitemap=read('sitemap.xml'),
  redirect=read('crm/redirect.js');

test('Nexus Core stays institutional and links to approved CRM product domain',()=>{
  assert.match(home,/<title>Nexus Core Industrial Trust/);
  assert.match(home,/<link rel="canonical" href="https:\/\/nexuscore\.app\.br\/">/);
  assert.doesNotMatch(home,/<meta[^>]+http-equiv="refresh"/i);
  assert.match(home,/href="\/site\.css"/);
  assert.match(home,/\/apps\/sst-controle\/logo-nexus-core\.png/);
  assert.match(home,/href="https:\/\/crm\.nexuscore\.app\.br\/site-captacao"/);
  assert.match(home,/href="\/sst-controle\/"/);
  assert.match(home,/href="\/apps\/portal-cliente\/login\.html"/);
  assert.match(css,/\.solution\.crm/);
  assert.match(css,/\.solution\.sst/);
});

test('Old /crm/ ads shortcut forwards campaigns to approved Vercel CRM capture',()=>{
  assert.match(crm,/<link rel="canonical" href="https:\/\/crm\.nexuscore\.app\.br\/site-captacao"/);
  assert.match(crm,/name="robots" content="noindex,follow"/);
  assert.match(crm,/src="\/crm\/redirect\.js"/);
  assert.match(crm,/href="https:\/\/crm\.nexuscore\.app\.br\/site-captacao"/);
  assert.doesNotMatch(crm,/id="crmInterestForm"/);
  assert.doesNotMatch(crm,/action="\/api\/public\/crm-checkout"/);
  assert.match(redirect,/new URL\('https:\/\/crm\.nexuscore\.app\.br\/site-captacao'\)/);
  assert.match(redirect,/approved\.search = window\.location\.search/);
  assert.match(redirect,/approved\.hash = window\.location\.hash/);
  assert.match(redirect,/window\.location\.replace\(approved\.href\)/);
});

test('SST landing and checkout remain in original product application',()=>{
  assert.match(sstRoute,/url=\/apps\/site-captacao\//);
  assert.match(sstRoute,/name="robots" content="noindex,follow"/);
  assert.match(sst,/id="checkoutForm"/);
  assert.match(sst,/data-meta-pixel-id/);
  assert.match(sst,/href="\/crm\/"/);
  assert.match(sst,/href="\/"/);
});

test('Cloudflare assets and sitemap exclude redirect-only CRM alias',()=>{
  for(const path of ["'site.css'","'sst-controle'","'crm'","'apps/site-captacao'","'apps/portal-cliente'"])
    assert.ok(build.includes(path),'Cloudflare missing '+path);
  for(const url of ['https://nexuscore.app.br/','https://nexuscore.app.br/apps/site-captacao/'])
    assert.ok(sitemap.includes('<loc>'+url+'</loc>'),'Sitemap missing '+url);
  assert.doesNotMatch(sitemap,/<loc>https:\/\/nexuscore\.app\.br\/crm\/<\/loc>/);
});
