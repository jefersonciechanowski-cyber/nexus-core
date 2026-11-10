import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const home=read('index.html'),css=read('site.css'),crm=read('crm/index.html'),
  sst=read('apps/site-captacao/index.html'),sstRoute=read('sst-controle/index.html'),
  build=read('scripts/prepare-cloudflare.mjs'),sitemap=read('sitemap.xml');

test('Nexus Core Industrial Trust replaces SST home redirect without changing product URL',()=>{
  assert.match(home,/<title>Nexus Core Industrial Trust/);
  assert.match(home,/<link rel="canonical" href="https:\/\/nexuscore\.app\.br\/">/);
  assert.doesNotMatch(home,/<meta[^>]+http-equiv="refresh"/i);
  assert.match(home,/href="\/site\.css"/);
  assert.match(home,/\/apps\/sst-controle\/logo-nexus-core\.png/);
  assert.match(home,/href="\/crm\/"/);
  assert.match(home,/href="\/sst-controle\/"/);
  assert.match(home,/href="\/apps\/portal-cliente\/login\.html"/);
  assert.match(css,/\.solution\.crm/);
  assert.match(css,/\.solution\.sst/);
});

test('CRM ads link lands directly on CRM page and preserves qualified UTM capture',()=>{
  assert.match(crm,/<link rel="canonical" href="https:\/\/nexuscore\.app\.br\/crm\/"/);
  assert.match(crm,/id="crmInterestForm"/);
  assert.match(crm,/functions\/v1\/nexus-public-crm-interest/);
  for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']){
    assert.ok(crm.includes("params.get('"+key+"')"),'CRM tracking missing '+key);
  }
  assert.match(crm,/href="\/"/);
  assert.match(crm,/logo-nexus-core\.png/);
  assert.match(crm,/acceptedContact/);
  assert.match(crm,/id="interestWebsite"/);
  assert.match(crm,/result\?\.received!==true/);
});

test('SST landing checkout remains in its original place with a stable product alias',()=>{
  assert.match(sstRoute,/url=\/apps\/site-captacao\//);
  assert.match(sstRoute,/name="robots" content="noindex,follow"/);
  assert.match(sst,/id="checkoutForm"/);
  assert.match(sst,/data-meta-pixel-id/);
  assert.match(sst,/href="\/crm\/"/);
  assert.match(sst,/href="\/"/);
});

test('Cloudflare and sitemap ship all new public assets while preserving existing apps',()=>{
  for(const path of ["'site.css'","'sst-controle'","'crm'","'apps/site-captacao'","'apps/portal-cliente'"])
    assert.ok(build.includes(path),'Cloudflare missing '+path);
  for(const url of ['https://nexuscore.app.br/','https://nexuscore.app.br/crm/','https://nexuscore.app.br/apps/site-captacao/'])
    assert.ok(sitemap.includes('<loc>'+url+'</loc>'),'Sitemap missing '+url);
});
