import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = name => readFileSync(new URL("../" + name, import.meta.url), "utf8");
const ga = read("crm/nexus-ga4.js");
const institutional = read("index.html");
const institutionalConsent = read("crm/nexus-consent.js");
const sst = read("apps/site-captacao/index.html");
const sstConsent = read("apps/site-captacao/marketing-consent.js");
const headers = read("_headers");
const privacy = read("apps/site-captacao/privacidade.html");

function browser({ allowed = false, gpc = false, id = "G-J9ZKV50HSX" } = {}) {
  const listeners = new Map(), loadedScripts = [], calls = [];
  let consent = allowed;
  const window = {
    addEventListener(event, listener) { listeners.set(event, listener); },
    dataLayer: undefined,
    NexusMarketing: { getPreference: () => consent ? "granted" : "denied" },
    location: { reload() { calls.push("reload"); } }
  };
  const document = {
    currentScript: { dataset: { ga4Id: id } },
    head: { appendChild(node) { loadedScripts.push(node); } },
    createElement(type) { return { type }; },
    cookie: ""
  };
  const context = {
    window, document, navigator: { globalPrivacyControl: gpc, doNotTrack: "0" },
    location: { protocol: "https:", hostname: "nexuscore.app.br" },
    encodeURIComponent, Date
  };
  vm.runInNewContext(ga, context, { timeout: 1500 });
  return {
    window, document, listeners, loadedScripts, calls,
    grant() { consent = true; listeners.get("nexus:consent-granted")?.(); },
    revoke() { consent = false; listeners.get("nexus:consent-revoked")?.(); }
  };
}

test("GA4 is configured for exactly the two public Cloudflare landing pages", () => {
  assert.match(institutional, /src="\/crm\/nexus-ga4\.js" data-ga4-id="G-J9ZKV50HSX"/);
  assert.match(sst, /src="\.\.\/\.\.\/crm\/nexus-ga4\.js" data-ga4-id="G-EDEZREY8FM"/);
  assert.doesNotMatch(read("apps/sst-controle/index.html"), /nexus-ga4\.js/);
  assert.doesNotMatch(read("apps/portal-cliente/login.html"), /nexus-ga4\.js/);
});

test("a visitor who has not opted in never contacts Google", () => {
  const x = browser();
  assert.equal(x.loadedScripts.length, 0);
  assert.equal(x.window.dataLayer, undefined);
  assert.equal(x.calls.length, 0);
  x.revoke();
  assert.equal(x.loadedScripts.length, 0);
});

test("explicit grant requests one GA4 script with the correct measurement ID and no advertising consent", () => {
  const x = browser();
  x.grant();
  x.grant();
  assert.equal(x.loadedScripts.length, 1);
  assert.equal(x.loadedScripts[0].src, "https://www.googletagmanager.com/gtag/js?id=G-J9ZKV50HSX");
  const commands = x.window.dataLayer;
  assert.equal(commands.length, 3);
  assert.equal(commands[0][0], "consent");
  assert.equal(commands[0][1], "default");
  assert.equal(commands[0][2].ad_storage, "denied");
  assert.equal(commands[0][2].analytics_storage, "granted");
  assert.equal(commands[2][0], "config");
  assert.equal(commands[2][1], "G-J9ZKV50HSX");
});

test("GPC prevents loading, and consent revocation unloads already fetched analytics", () => {
  const blocked = browser({ allowed: true, gpc: true });
  assert.equal(blocked.loadedScripts.length, 0);
  const x = browser({ allowed: true });
  assert.equal(x.loadedScripts.length, 1);
  x.revoke();
  assert.ok(x.calls.includes("reload"));
  assert.equal(x.window.dataLayer.at(-1)[0], "consent");
  assert.equal(x.window.dataLayer.at(-1)[2].analytics_storage, "denied");
});

test("only the confirmed lead event is passed, without names, phone numbers or form fields", () => {
  const x = browser({ allowed: true, id: "G-EDEZREY8FM" });
  assert.equal(x.window.NexusGA4.track("purchase"), false);
  assert.equal(x.window.NexusGA4.track("generate_lead"), true);
  const event = x.window.dataLayer.at(-1);
  assert.equal(event[0], "event");
  assert.equal(event[1], "generate_lead");
  assert.equal(event[2].form_type, "sst_demo");
  assert.match(sstConsent, /if \(eventName === 'Lead'\) window\.NexusGA4\?\.track\('generate_lead'\)/);
});

test("fresh consent version, accurate notices and Cloudflare's strict allowlist are retained", () => {
  assert.match(institutionalConsent, /analytics-consent:v2/);
  assert.match(sstConsent, /consentVersion = 'v2'/);
  assert.match(sstConsent, /cookies opcionais do Google Analytics/);
  assert.match(privacy, /Google Analytics 4 e o Pixel da Meta/);
  const policies = headers.split("\n").filter(line => line.includes("Content-Security-Policy:"));
  assert.ok(policies.length >= 2);
  assert.ok(policies.every(line => line.length <= 2000));
  assert.match(policies[0], /https:\/\/www\.googletagmanager\.com/);
  assert.match(policies[0], /https:\/\/\*\.google-analytics\.com/);
  assert.doesNotMatch(policies[1], /googletagmanager\.com/);
  assert.doesNotMatch(policies[0], /script-src[^;]*'unsafe-inline'/);
});
