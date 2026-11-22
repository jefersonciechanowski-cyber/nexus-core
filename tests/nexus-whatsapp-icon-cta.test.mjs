import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const script = readFileSync(new URL("../whatsapp-contact.js", import.meta.url), "utf8");

function render({ mobile = false, context = "nexus", consentOpen = false } = {}) {
  let link = null;
  let observerCallback = null;
  let resizeCallback = null;
  let notice = consentOpen ? { getBoundingClientRect: () => ({
    left: 10, right: 350, top: 570, bottom: 750,
  }) } : null;
  const viewportWidth = mobile ? 360 : 1366;
  const viewportHeight = 770;
  const normalBottom = mobile ? (context === "sst" ? 96 : 18) : 24;
  const size = mobile ? 52 : 56;
  const right = mobile ? 12 : 20;
  const document = {
    readyState: "complete",
    currentScript: { dataset: { context } },
    querySelector: selector => selector === ".nexus-whatsapp-contact" ? link : selector.includes(".nexus-consent") ? notice : null,
    createElement: type => {
      if (type === "style") return { textContent: "" };
      const anchor = {
        className: "", dataset: {}, attrs: {},
        style: { bottom: "", removeProperty(name) { if (name === "bottom") this.bottom = ""; } },
        setAttribute(name, value) { this.attrs[name] = value; },
        getBoundingClientRect() {
          const offset = parseInt(this.style.bottom, 10) || normalBottom;
          return { left: viewportWidth - right - size, right: viewportWidth - right,
            top: viewportHeight - offset - size, bottom: viewportHeight - offset };
        },
      };
      return anchor;
    },
    head: { appendChild() {} },
    body: { appendChild(element) { link = element; } },
  };
  const window = {
    innerHeight: viewportHeight,
    matchMedia: () => ({ matches: mobile }),
    addEventListener(name, callback) { if (name === "resize") resizeCallback = callback; },
  };
  class MutationObserver {
    constructor(cb) { observerCallback = cb; }
    observe() {}
  }
  vm.runInNewContext(script, { document, window, MutationObserver, encodeURIComponent }, { timeout: 2000 });
  return { get link() { return link; }, setNotice(value) {
    notice = value ? { getBoundingClientRect: () => ({ left: 10, right: 350, top: 570, bottom: 750 }) } : null;
    observerCallback?.();
  }, resize() { resizeCallback?.(); } };
}

test("floating WhatsApp CTA has no visible text, clear white glyph and proper accessible name", () => {
  const page = render();
  assert.ok(page.link);
  assert.match(page.link.innerHTML, /<svg class="nexus-whatsapp-contact-icon"/);
  assert.match(page.link.innerHTML, /fill="currentColor"/);
  assert.doesNotMatch(page.link.innerHTML, /<span>WhatsApp<\/span>/);
  assert.match(page.link.attrs["aria-label"], /WhatsApp/);
  assert.equal(page.link.title, "Falar no WhatsApp");
  assert.match(page.link.href, /^https:\/\/wa\.me\/55\d{10,11}\?text=/);
  assert.equal(page.link.target, "_blank");
  assert.equal(page.link.rel, "noopener noreferrer");
  assert.match(script, /width:56px;height:56px/);
  assert.match(script, /width:52px;height:52px/);
  assert.match(script, /right:20px;bottom:24px/);
  assert.match(script, /right:12px;bottom:18px/);
});

test("mobile WhatsApp CTA moves above the consent notice and returns after dismissing", () => {
  const page = render({ mobile: true, consentOpen: true });
  assert.ok(parseInt(page.link.style.bottom, 10) > 170);
  assert.match(script, /new MutationObserver\(avoidConsentOverlap\)/);
  page.setNotice(false);
  assert.equal(page.link.style.bottom, "");
  page.resize();
  assert.equal(page.link.style.bottom, "");
});

test("desktop CTA remains in the normal bottom-right corner while cookie notice is centered", () => {
  const page = render({ mobile: false, consentOpen: true });
  assert.equal(page.link.style.bottom, "");
});

test("same visible CTA behavior is available on SST marketing context", () => {
  const page = render({ mobile: true, context: "sst" });
  assert.equal(page.link.dataset.context, "sst");
  assert.match(page.link.attrs["aria-label"], /SST Controle/);
  assert.match(script, /\.nexus-whatsapp-contact\[data-context="sst"\]\{right:auto;left:20px;bottom:24px\}/);
  assert.match(script, /left:12px;bottom:96px/);
  assert.match(script, /\.nexus-cookie\.visible/);
});
