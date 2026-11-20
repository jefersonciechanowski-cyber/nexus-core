"use strict";

// Temporary production smoke. Test traffic only; no real leads, payments or WhatsApp messages.
// Synthetic session and campaign are removed from Supabase after verification.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");
const siteId = "15dd3a2e-422f-440b-b074-c4b7c8f2a489";
const testSession = "fbf9f93f-3819-468a-8f13-e3d65d9125fd";
const campaign = "nexus_e2e_smoke_20261120";
const base = "https://nexuscore.app.br/";
const visit = base + "?utm_source=nexus_homologacao&utm_medium=e2e&utm_campaign=" + campaign;
const endpoint = "https://crm.nexuscore.app.br/api/public/site-events";

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: "pt-BR" });
    await context.addInitScript(({ key, id }) => {
      try { sessionStorage.setItem(key, id); } catch {}
    }, { key: "nexus:site:" + siteId + ":session", id: testSession });

    const page = await context.newPage();
    const outbound = [];
    const failed = [];
    page.on("response", async response => {
      if (!response.url().startsWith(endpoint)) return;
      const req = response.request();
      if (req.method() !== "POST") return;
      let payload = null;
      try { payload = req.postDataJSON(); } catch {}
      outbound.push({ type: payload?.event_type, target: payload?.target_key, status: response.status() });
    });
    page.on("requestfailed", req => {
      if (req.url().startsWith(endpoint)) failed.push(req.failure()?.errorText ?? "requestfailed");
    });
    const matchEvent = type => response =>
      response.url().startsWith(endpoint) &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.event_type === type;

    const doc = await page.goto(visit, { waitUntil: "domcontentloaded", timeout: 30000 });
    assert.equal(doc?.status(), 200, "institutional homepage must serve 200");
    await page.locator(".nexus-consent-allow").waitFor({ timeout: 20000 });
    await page.waitForTimeout(400);
    assert.equal(outbound.length, 0, "fresh visitor must not be tracked before consent");
    assert.equal(await page.evaluate(() => window.NexusTracking?.getSessionId?.()), null,
      "fresh visitor must have no active tracking session");
    console.log("PASS: homepage visible, no events before permission");

    const viewResponse = page.waitForResponse(matchEvent("page_view"), { timeout: 25000 });
    await page.locator(".nexus-consent-allow").click();
    const view = await viewResponse;
    if (view.status() !== 202) {
      const payload = view.request().postDataJSON();
      console.error("PAGE_VIEW_RESPONSE_DEBUG", JSON.stringify({
        status: view.status(),
        message: await view.text(),
        payload: {
          event_type: payload?.event_type,
          site_id: payload?.site_id,
          session_id: payload?.session_id,
          event_id: payload?.event_id,
          page_path: payload?.page_path,
          device_type: payload?.device_type,
          utm_source: payload?.utm_source,
          utm_campaign: payload?.utm_campaign,
          metric_name: payload?.metric_name,
        },
        contentType: view.headers()?.["content-type"],
      }));
    }
    assert.equal(view.status(), 202, "page view must reach CRM API after consent");
    assert.equal(await page.evaluate(() => window.NexusTracking?.getSessionId?.()), testSession);
    console.log("PASS: opt-in creates recorded Nexus page_view (HTTP 202)");

    await page.evaluate(() => {
      document.addEventListener("click", event => {
        if (event.target instanceof Element && event.target.closest("a")) event.preventDefault();
      });
    });

    const ctaResponse = page.waitForResponse(matchEvent("cta_click"), { timeout: 25000 });
    await page.locator('a[data-nexus-action="nexus_crm_public_site"]').first().dispatchEvent("click");
    const cta = await ctaResponse;
    if (cta.status() !== 202) {
      console.error("CTA_RESPONSE_DEBUG", JSON.stringify({
        status: cta.status(),
        message: await cta.text(),
        event: cta.request().postDataJSON()?.event_type,
        site: cta.request().postDataJSON()?.site_id,
        session: cta.request().postDataJSON()?.session_id,
        eventId: cta.request().postDataJSON()?.event_id,
      }));
    }
    assert.equal(cta.status(), 202);
    const ctaPayload = cta.request().postDataJSON();
    assert.equal(ctaPayload.target_key, "nexus_crm_public_site");
    assert.equal(ctaPayload.utm_campaign, campaign);
    console.log("PASS: product CTA identified and recorded (HTTP 202)");

    // Repeat three times to catch intermittent API rejection during live production load.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const nextClick = page.waitForResponse(matchEvent("cta_click"), { timeout: 25000 });
      await page.locator('a[data-nexus-action="nexus_crm_public_site"]').first().dispatchEvent("click");
      const response = await nextClick;
      if (response.status() !== 202) {
        console.error("REPEATED_CTA_FAILURE", JSON.stringify({
          attempt,
          status: response.status(),
          message: await response.text(),
          event: response.request().postDataJSON()?.event_type,
        }));
      }
      assert.equal(response.status(), 202, "repeated CTA should be reliably accepted");
    }
    console.log("PASS: four successive product CTA events accepted by production");

    const whatsappButton = page.locator("a.nexus-whatsapp-contact");
    await whatsappButton.waitFor({ timeout: 18000 });
    const whatsappResponse = page.waitForResponse(matchEvent("whatsapp_click"), { timeout: 25000 });
    await whatsappButton.dispatchEvent("click");
    const whats = await whatsappResponse;
    assert.equal(whats.status(), 202);
    assert.match(whats.request().postDataJSON().target_key, /whatsapp_click/);
    console.log("PASS: floating WhatsApp interest recorded without opening a chat (HTTP 202)");

    const consentControl = page.locator("#nexus-metrics-preferences");
    await consentControl.click();
    await page.locator(".nexus-consent-reject").click();
    assert.equal(await page.evaluate(() => window.NexusTracking?.getSessionId?.()), null,
      "consent revocation must stop the tracker");
    const savedCount = outbound.length;
    await page.locator('a[data-nexus-action="nexus_crm_public_site"]').first().dispatchEvent("click");
    await page.waitForTimeout(700);
    assert.equal(outbound.length, savedCount, "no new events permitted after withdrawal");
    console.log("PASS: revocation stops tracking");

    const deniedContext = await browser.newContext({ viewport: { width: 390, height: 780 }, locale: "pt-BR" });
    const deniedPage = await deniedContext.newPage();
    let deniedEvents = 0;
    deniedPage.on("request", req => {
      if (req.url().startsWith(endpoint) && req.method() === "POST") deniedEvents++;
    });
    const deniedDoc = await deniedPage.goto(visit, { waitUntil: "domcontentloaded", timeout: 30000 });
    assert.equal(deniedDoc?.status(), 200);
    await deniedPage.locator(".nexus-consent-reject").click();
    await deniedPage.locator('a[data-nexus-action="nexus_crm_public_site"]').first().dispatchEvent("click");
    await deniedPage.waitForTimeout(800);
    assert.equal(deniedEvents, 0, "refusing consent must never send events");
    console.log("PASS: visitor refusing consent sends zero events");

    assert.deepEqual(failed, [], "browser must make no failed events requests");
    assert.ok(outbound.some(x => x.type === "page_view" && x.status === 202));
    assert.ok(outbound.some(x => x.type === "cta_click" && x.status === 202));
    assert.ok(outbound.some(x => x.type === "whatsapp_click" && x.status === 202));
    console.log("NEXUS_LIVE_E2E_SUCCESS " + JSON.stringify({
      site: "nexuscore.app.br",
      synthetic_session: testSession,
      campaign,
      events: outbound,
      no_real_leads: true,
    }));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error("NEXUS_LIVE_E2E_FAILED", error?.stack ?? error);
  process.exitCode = 1;
});
