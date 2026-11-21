"""Real-browser smoke of the public CRM mobile form, with ALL writes and WhatsApp intercepted.

No customer lead, payment, WhatsApp message, e-mail, or provider API call is created.
The production HTML/JS actually loads; only the POST response is simulated.
"""
import re
import sys
from playwright.sync_api import sync_playwright, expect, TimeoutError as PlaywrightTimeoutError

URL = "https://crm.nexuscore.app.br/site-captacao"
EXPECTED_WHATSAPP_SUFFIX = "/5546991105028"


def scenario(browser, *, mobile):
    context = browser.new_context(
        viewport={"width": 390 if mobile else 1366, "height": 844 if mobile else 900},
        is_mobile=mobile,
        has_touch=mobile,
        device_scale_factor=2 if mobile else 1,
        locale="pt-BR",
    )
    intercepted = {"crm_posts": [], "whatsapp": [], "unexpected_writes": [], "accept": False}

    def intercept(route):
        req = route.request
        url = req.url
        if url.startswith("https://wa.me/"):
            intercepted["whatsapp"].append(url)
            route.fulfill(status=200, content_type="text/html", body="<html><body>WhatsApp intercepted — no message delivered.</body></html>")
        elif url.split("?")[0].endswith("/api/public/crm-interest") and req.method == "POST":
            intercepted["crm_posts"].append(req.post_data_json)
            if intercepted["accept"]:
                route.fulfill(status=200, content_type="application/json", body='{"ok":true}')
            else:
                route.fulfill(status=503, content_type="application/json", body='{"ok":false,"error":"Falha simulada de registro"}')
        elif req.method not in ("GET", "HEAD", "OPTIONS"):
            intercepted["unexpected_writes"].append({"method": req.method, "path": url.split("?")[0]})
            route.abort()
        else:
            route.continue_()

    context.route("**/*", intercept)
    page = context.new_page()
    try:
        response = page.goto(URL, wait_until="domcontentloaded", timeout=45000)
        assert response and response.status == 200, f"landing page unexpected HTTP: {response.status if response else 'none'}"
        form = page.locator('form:has(input[name="companyName"])')
        form.wait_for(state="visible", timeout=30000)
        try:
            page.wait_for_load_state("networkidle", timeout=20000)
        except PlaywrightTimeoutError:
            page.wait_for_timeout(900)  # fallback if third-party resources never become idle

        assert form.locator('input[name="email"]').get_attribute("inputmode") == "email"
        assert form.locator('input[name="phone"]').get_attribute("type") == "tel"
        assert form.locator('input[name="phone"]').get_attribute("autocomplete") == "tel"

        form.locator('input[name="companyName"]').fill("Nexus QA - somente simulação de navegador")
        form.locator('input[name="responsibleName"]').fill("Teste Browser")
        form.locator('input[name="email"]').fill("nexus-qa@example.invalid")
        form.locator('input[name="phone"]').fill("(46) 99999-0000")

        # Failure path: the site must stay put and never open WhatsApp when CRM rejects.
        form.locator('button[type="submit"]').click()
        expect(form.locator('[role="status"]')).to_contain_text("Falha simulada de registro", timeout=15000)
        assert len(intercepted["crm_posts"]) == 1
        assert not intercepted["whatsapp"], "WhatsApp appeared before CRM receipt"
        assert len(context.pages) == 1, "Blank popup opened despite failed CRM receipt"

        # Successful CRM receipt path. Real production UI, mocked backend only.
        intercepted["accept"] = True
        if mobile:
            form.locator('button[type="submit"]').click()
            page.wait_for_url(re.compile(r"^https://wa\.me/"), timeout=20000)
            assert len(context.pages) == 1, "Mobile created an unexpected second tab"
        else:
            with page.expect_popup(timeout=15000) as popup:
                form.locator('button[type="submit"]').click()
            popup.value.wait_for_url(re.compile(r"^https://wa\.me/"), timeout=20000)
            assert page.url.startswith(URL), "Desktop unexpectedly lost its CRM form"
            expect(form.locator('[role="status"]')).to_contain_text("Solicitação recebida", timeout=15000)

        assert len(intercepted["crm_posts"]) == 2, intercepted
        assert len(intercepted["whatsapp"]) == 1, intercepted
        assert EXPECTED_WHATSAPP_SUFFIX in intercepted["whatsapp"][0], "Approved commercial destination unexpectedly changed"
        assert not intercepted["unexpected_writes"], f"Unexpected real writes were blocked: {intercepted['unexpected_writes']}"
        assert intercepted["crm_posts"][-1].get("companyName") == "Nexus QA - somente simulação de navegador"
        assert intercepted["crm_posts"][-1].get("email") == "nexus-qa@example.invalid"

        print("PASS", "mobile" if mobile else "desktop", "real browser", "all writes mocked", "WhatsApp intercepted")
    finally:
        context.close()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            scenario(browser, mobile=True)
            scenario(browser, mobile=False)
        finally:
            browser.close()


if __name__ == "__main__":
    main()
