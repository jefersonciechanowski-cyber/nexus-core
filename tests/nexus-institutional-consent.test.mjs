import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const home = readFileSync(new URL("../index.html", import.meta.url),"utf8");
const consent = readFileSync(new URL("../crm/nexus-consent.js", import.meta.url),"utf8");
const tracker = readFileSync(new URL("../crm/nexus-tracker.js", import.meta.url),"utf8");
const headers = readFileSync(new URL("../_headers", import.meta.url),"utf8");
const privacy = readFileSync(new URL("../privacidade.html", import.meta.url),"utf8");
const build = readFileSync(new URL("../scripts/prepare-cloudflare.mjs", import.meta.url),"utf8");

function browser(initialConsent = null, gpc = false) {
  const storage = new Map(initialConsent === null ? [] : [["nexus:institutional:analytics-consent:v1",initialConsent]]);
  const calls = [];
  const elements = [];
  const preferences = {
    handlers: {}, addEventListener(name,fn) { this.handlers[name]=fn; },
    setAttribute() {},
  };
  const doc = {
    readyState:"complete",
    getElementById: id => id === "nexus-metrics-preferences" ? preferences : null,
    createElement: tag => {
      const children = new Map();
      const element = {
        tag, innerHTML:"", removed:false,
        setAttribute() {},
        remove(){this.removed=true;},
        querySelector(sel) {
          if (!children.has(sel)) children.set(sel,{
            addEventListener(name, fn){ this[name+"Handler"]=fn; },
            click(){this.clickHandler?.();},
          });
          return children.get(sel);
        },
      };
      elements.push(element);
      return element;
    },
    body:{appendChild(){}},
  };
  const win = {
    NexusTracking:{start:()=>calls.push("start"),stop:()=>calls.push("stop")},
    dispatchEvent:e=>calls.push(e.type),
  };
  vm.runInNewContext(consent,{
    window:win,document:doc,
    navigator:{globalPrivacyControl:gpc,doNotTrack:"0"},
    localStorage:{
      getItem:key=>storage.get(key)??null,
      setItem:(key,val)=>storage.set(key,val),
    },
    Event:class {constructor(type){this.type=type;}},
  },{timeout:2000});
  return {win,storage,calls,elements,preferences};
}

test("institutional page loads first-party tracker with registered site and no automatic consent",()=>{
  assert.match(home,/data-nexus-site="15dd3a2e-422f-440b-b074-c4b7c8f2a489"/);
  assert.match(home,/src="\/crm\/nexus-consent\.js"/);
  assert.match(home,/src="\/crm\/nexus-tracker\.js"/);
  assert.match(home,/data-nexus-api="https:\/\/crm\.nexuscore\.app\.br"/);
  assert.doesNotMatch(home,/<script[^>]+src="https:\/\/crm\.nexuscore\.app\.br\/nexus-tracker\.js"/);
  assert.match(tracker,/script\.getAttribute\("data-nexus-api"\) \|\| script\.src/);
  assert.match(tracker,/if \(window\.nexusTrackingConsent === true/);
});

test("standard cookie banner is concise, opt-in and has clear buttons",()=>{
  assert.match(consent, /<strong>Cookies e privacidade<\/strong>/);
  assert.match(consent, /class="nexus-consent-allow">Aceitar cookies<\/button>/);
  assert.match(consent, /class="nexus-consent-reject">Recusar<\/button>/);
  assert.match(consent, /A medição só começa com sua autorização/);
  assert.match(home, /id="nexus-metrics-preferences"[^>]*>Preferências de cookies/);
  const layout = readFileSync(new URL("../site.css", import.meta.url), "utf8");
  assert.match(layout, /max-width:700px/);
  assert.match(layout, /transform:translateX\(-50%\)/);
});

test("consent defaults to OFF, and refusals never start analytics",()=>{
  const x=browser();
  assert.equal(x.win.nexusTrackingConsent,undefined);
  assert.deepEqual(x.calls,[]);
  assert.equal(x.elements.length,1);
  x.elements[0].querySelector(".nexus-consent-reject").clickHandler();
  assert.equal(x.storage.get("nexus:institutional:analytics-consent:v1"),"deny");
  assert.equal(x.calls.includes("start"),false);
  assert.equal(x.win.nexusTrackingConsent,false);
});

test("explicit grant enables analytics, and visitor can reopen options and revoke",()=>{
  const x=browser();
  x.elements[0].querySelector(".nexus-consent-allow").clickHandler();
  assert.equal(x.storage.get("nexus:institutional:analytics-consent:v1"),"allow");
  assert.equal(x.win.nexusTrackingConsent,true);
  assert.ok(x.calls.includes("start"));
  x.preferences.handlers.click();
  assert.equal(x.elements.length,2);
  x.elements[1].querySelector(".nexus-consent-reject").clickHandler();
  assert.equal(x.win.nexusTrackingConsent,false);
  assert.equal(x.storage.get("nexus:institutional:analytics-consent:v1"),"deny");
  assert.ok(x.calls.includes("stop"));
});

test("prior denial stays off and Global Privacy Control suppresses stored auto-consent",()=>{
  const no=browser("deny");
  assert.equal(no.elements.length,0);
  assert.equal(no.win.nexusTrackingConsent,undefined);
  const privacySignal=browser("allow",true);
  assert.equal(privacySignal.win.nexusTrackingConsent,undefined);
  assert.equal(privacySignal.elements.length,1);
});

test("CSP permits ONLY HTTPS event origin while retaining strict script restrictions",()=>{
  const globalCsp=headers.split("\n").find(line=>line.startsWith("  Content-Security-Policy:"));
  assert.ok(globalCsp);
  assert.ok(globalCsp.length<=2000);
  assert.match(globalCsp,/script-src 'self' /);
  assert.match(globalCsp,/connect-src 'self' https:\/\/crm\.nexuscore\.app\.br /);
  assert.doesNotMatch(globalCsp,/script-src[^;]*https:\/\/crm\.nexuscore\.app\.br/);
  assert.doesNotMatch(globalCsp,/script-src[^;]*'unsafe-inline'/);
  assert.match(privacy,/revogar a autorização/);
  assert.match(build,/copyOptionalFile\('privacidade\.html'\)/);
});

test("the institutional tag tracks public-product CTA only, not private product routes",()=>{
  assert.match(home,/data-nexus-action="nexus_crm_public_site"/);
  assert.match(home,/data-nexus-action="sst_controle_public_site"/);
  assert.doesNotMatch(readFileSync(new URL("../apps/portal-cliente/login.html",import.meta.url),"utf8"),/nexus-consent\.js/);
});
