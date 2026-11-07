import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const js = readFileSync(new URL('../apps/nexus-admin/login.js', import.meta.url),'utf8');
const html = readFileSync(new URL('../apps/nexus-admin/login.html', import.meta.url),'utf8');
const dashboard = readFileSync(new URL('../apps/nexus-admin/index.html', import.meta.url),'utf8');
const pix = readFileSync(new URL('../apps/nexus-admin/crm-live-pix-pilot.js', import.meta.url),'utf8');
const crmAccess = readFileSync(new URL('../apps/nexus-admin/crm-access.html', import.meta.url),'utf8');

function render({role='nexus_admin',aal='aal2',search='?next=crm-live-pix-pilot.html',hasSession=true}={}){
 const ids=new Map(),listeners={},storage=new Map(),redirects=[];
 const element=id=>{
  if(!ids.has(id))ids.set(id,{
   hidden:id==='mfaStep',disabled:false,textContent:'',value:'',
   focus(){},addEventListener(){},
  });
  return ids.get(id);
 };
 let logouts=0, challenges=0;
 const user = hasSession ? {userId:'safe-user',role,email:'admin@example.test'} : null;
 const now=Math.floor(Date.now()/1000);
 const client={auth:{mfa:{
  async getAuthenticatorAssuranceLevel(){return {data:{currentLevel:aal,
    currentAuthenticationMethods:aal==='aal2'?[{method:'totp',timestamp:now}]:[]},error:null};},
  async listFactors(){return {data:{totp:[{id:'factor-test',status:'verified'}]},error:null};},
  async challengeAndVerify(){challenges++;return {error:null};},
 },},};
 const browser = {
  location:{search,replace(x){redirects.push(x)}},
  sessionStorage:{getItem(k){return storage.get(k)??null},setItem(k,v){storage.set(k,v)},removeItem(k){storage.delete(k)}},
  document:{getElementById:element,addEventListener(name,cb){listeners['document:'+name]=cb}},
  window:{
   NEXUS_SUPABASE_CONFIG:{},NexusTurnstile:{},
   NexusAuth:{
    getClient(){return client;},
    async restoreSession(){return user;},
    async logout(){logouts++;},
   },
   addEventListener(name,cb){listeners['window:'+name]=cb},
  },
  console:{error(){},warn(){},log(){}},Date,
  setTimeout(fn){fn()},
  URLSearchParams,
 };
 runInNewContext(js,browser,{timeout:2000});
 return {ids,storage,redirects,get logouts(){return logouts},get challenges(){return challenges},
  async start(){await listeners['window:DOMContentLoaded']();},
 };
}

test('valid authenticated admin opens new tab without repeated password or sign out',async()=>{
 const ctx=render();
 await ctx.start();
 assert.deepEqual(ctx.redirects,['crm-live-pix-pilot.html']);
 assert.equal(ctx.logouts,0);
 assert.equal(ctx.challenges,0);
 const marker=JSON.parse(ctx.storage.get('nexus_admin_mfa_session'));
 assert.equal(marker.userId,'safe-user');
});

test('valid session with AAL1 remains signed in and requires second factor',async()=>{
 const ctx=render({aal:'aal1',search:'?next=crm-access.html'});
 await ctx.start();
 assert.equal(ctx.logouts,0);
 assert.equal(ctx.redirects.length,0);
 assert.equal(ctx.ids.get('mfaStep').hidden,false);
 assert.equal(ctx.ids.get('passwordStep').hidden,true);
 assert.equal(ctx.ids.get('mfaTitle').textContent,'Verificação em duas etapas');
});

test('non-admin session never silently signs out another project session',async()=>{
 const ctx=render({role:'org_admin'});
 await ctx.start();
 assert.equal(ctx.logouts,0);
 assert.equal(ctx.redirects.length,0);
 assert.match(ctx.ids.get('error').textContent,/outra conta/);
});

test('no session leaves regular login available without accidental sign out',async()=>{
 const ctx=render({hasSession:false});
 await ctx.start();
 assert.equal(ctx.logouts,0);
 assert.equal(ctx.redirects.length,0);
 assert.equal(ctx.ids.get('login').disabled,false);
});

test('next target is strict allowlist, cannot redirect to an outside domain',async()=>{
 for(const search of [
  '?next=https%3A%2F%2Fevil.example%2F',
  '?next=%2F%2Fevil.example',
  '?next=%2Fapps%2Fportal-cliente%2Flogin.html',
  '?next=..%2F..%2Fsecret',
 ]){
  const ctx=render({search});await ctx.start();
  assert.deepEqual(ctx.redirects,['index.html']);
 }
});

test('CSP-safe external script and local login redirect, financial pilot remains blocked',()=>{
 assert.match(html,/<script src="login\.js" defer><\/script>/);
 assert.doesNotMatch(html,/<script>\s*const ADMIN_MFA/);
 assert.match(js,/markAdminSession\(\);\s*location\.replace\(loginTarget\(\)\);/);
 assert.doesNotMatch(js,/await window\.NexusAuth\.logout\(\);sessionStorage\.removeItem/);
 assert.match(pix,/login\.html\?next=crm-live-pix-pilot\.html/);
 assert.match(crmAccess,/location\.replace\('login\.html'\)/);
 assert.match(pix,/financeEnabled=false/);
});

test('Central sidebar links directly to private Pix diagnostic after login, with no payment change',()=>{
 assert.match(dashboard, /href="crm-live-pix-pilot\.html"/);
 assert.match(dashboard, /Teste Pix R\$ 10/);
 assert.match(pix, /financeEnabled=false/);
});
