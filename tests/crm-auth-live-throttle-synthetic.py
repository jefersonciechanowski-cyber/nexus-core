"""One-time authorized Supabase Auth rate-limit smoke test, entirely synthetic.

- Probes a guaranteed-nonexistent address at the reserved .invalid TLD.
- Fetches only the PUBLIC publishable key already served by the CRM website.
- Runs from GitHub's isolated runner IP (not customers' IPs).
- Never uses an actual account, password, e-mail, token, or private API key.
- Stops on the first HTTP 429 and never exceeds 48 password grants.
- Never signs up, sends recovery mail, changes a user or calls payment providers.
"""
import concurrent.futures
import collections
import html
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

SITE = "https://crm.nexuscore.app.br/site-captacao"
AUTH = "https://ngxqtztfotkpdvynstae.supabase.co/auth/v1/token?grant_type=password"
MAX_REQUESTS = 48
WORKERS = 14
STOP = threading.Event()
HTTP_TIMEOUT = 12


def public_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "NexusAuthorizedReadOnlyCheck/1.0"})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as response:
        return response.read(3_000_000).decode("utf-8", errors="replace")


def get_public_publishable_key():
    page = public_get(SITE)
    assert "<title>" in page and "Nexus CRM" in page, "Unexpected public CRM page"
    regexp = re.compile(r"sb_publishable_[A-Za-z0-9_-]{20,}")
    found = regexp.search(page)
    if found:
        return found.group(0)
    assets = list(dict.fromkeys(
        html.unescape(m.group(1))
        for m in re.finditer(r'<script[^>]+src="(/_next/static/[^"]+\.js[^"]*)"', page)
    ))
    for path in assets[:22]:
        if not path.startswith("/_next/static/"):
            continue
        found = regexp.search(public_get(urllib.parse.urljoin(SITE, path)))
        if found:
            return found.group(0)
    raise RuntimeError("Public project key not found in published source; no Auth requests were made")


def request_password_grant(key, address, password):
    body = json.dumps({"email": address, "password": password}).encode("utf-8")
    req = urllib.request.Request(
        AUTH, data=body, method="POST",
        headers={
            "Content-Type": "application/json",
            "apikey": key,
            "Authorization": "Bearer " + key,
            "User-Agent": "NexusAuthorizedSyntheticThrottleTest/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as response:
            status, raw = response.status, response.read(2048)
    except urllib.error.HTTPError as exc:
        status, raw = exc.code, exc.read(2048)
    try:
        details = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        details = {}
    # Never expose credentials, email addresses, public keys or response bodies.
    code = str(details.get("error_code", details.get("code", "")))
    return status, code


def main():
    key = get_public_publishable_key()
    # RFC 2606 .invalid + random UUID guarantees no existing customer is targeted.
    address = "nexus-auth-synthetic-" + uuid.uuid4().hex + "@example.invalid"
    password = "SyntheticNeverValid-" + uuid.uuid4().hex + "!"
    first_status, first_code = request_password_grant(key, address, password)
    assert first_status in (400, 401, 422), (
        "Preflight was not a rejected synthetic password grant; aborting without load",
        first_status,
        first_code,
    )

    results = [(first_status, first_code)]
    def one(_):
        if STOP.is_set():
            return None
        status, code = request_password_grant(key, address, password)
        if status == 429:
            STOP.set()
        elif status in (500, 502, 503, 504):
            STOP.set()
        return (status, code)

    started = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        jobs = [pool.submit(one, i) for i in range(MAX_REQUESTS - 1)]
        for job in concurrent.futures.as_completed(jobs):
            x = job.result()
            if x is not None:
                results.append(x)
    elapsed = time.monotonic() - started
    counts = dict(sorted(collections.Counter(status for status, _ in results).items()))
    rate_limited = sum(1 for status, _ in results if status == 429)
    if 200 in counts:
        raise AssertionError("Unexpected synthetic sign-in success")
    if any(status >= 500 for status, _ in results):
        raise AssertionError("Provider returned 5xx; do not conclude rate limiting")
    if rate_limited == 0:
        raise AssertionError("No native 429 within the strictly capped synthetic test; provider configuration still requires inspection")

    # One non-customer follow-up after cool-down: do NOT try more credentials.
    time.sleep(10)
    resumed_status, resumed_code = request_password_grant(key, address, password)
    print(json.dumps({
        "type": "SYNTHETIC_AUTH_THROTTLE_ONLY",
        "environment": "crm-prod-supabase",
        "auth_path": "/auth/v1/token?grant_type=password",
        "request_cap": MAX_REQUESTS,
        "attempts": len(results),
        "seconds": round(elapsed, 2),
        "status_histogram": counts,
        "rate_limited": rate_limited,
        "rate_limit_codes": sorted(set(code for status, code in results if status == 429)),
        "after_ten_seconds": resumed_status,
        "real_customer_accounts_touched": 0,
        "email_or_message_sends": 0,
        "payments_or_signup_calls": 0,
        "isolation": "GitHub runner public egress IP; no customer IP forwarded",
    }, ensure_ascii=False))
    if resumed_status == 429:
        print("NOTE: Cool-down did not expire in 10 seconds. Do not retry automatically.")


if __name__ == "__main__":
    main()
