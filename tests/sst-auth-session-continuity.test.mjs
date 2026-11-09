import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../apps/sst-controle/supabase-auth.js', import.meta.url), 'utf8');

function makeContext({ authError = null, authThrows = false, profileError = null,
  entitlementError = null, active = true, entitlementActive = true } = {}) {
  const saved = { userId: 'user-1', organizationId: 'org-1', role: 'org_admin', provider: 'supabase' };
  const storage = new Map([['nexus_demo_session', JSON.stringify(saved)]]);
  const listeners = {};
  const redirects = [], alerts = [], logs = [];
  let signouts = 0;
  const query = (table) => {
    const builder = {
      select() { return builder; }, eq() { return builder; },
      async single() {
        if (profileError) return { data: null, error: profileError };
        return { data: { id: 'user-1', full_name: 'Test', role: 'org_admin', active,
          organization_id: 'org-1', organizations: { name: 'Empresa Teste', status: 'active' } }, error: null };
      },
      async maybeSingle() {
        if (entitlementError) return { data: null, error: entitlementError };
        return { data: { access_status: entitlementActive ? 'active' : 'suspended',
          subscription_status: 'active', billing_mode: 'subscription',
          product: { code: 'sst', status: 'active' } }, error: null };
      }
    };
    if (!['profiles', 'organization_product_access'].includes(table)) throw Error('Unexpected table: ' + table);
    return builder;
  };
  const client = {
    auth: {
      async getUser() {
        if (authThrows) throw new TypeError('Failed to fetch');
        return authError
          ? { data: { user: null }, error: authError }
          : { data: { user: { id: 'user-1', email: 'test@example.com' } }, error: null };
      },
      async signOut() { signouts++; return { error: null }; }
    },
    from: query
  };
  const location = {
    pathname: '/apps/sst-controle/index.html',
    hash: '',
    replace(path) { redirects.push(path); }
  };
  const window = {
    location,
    NEXUS_SUPABASE_CONFIG: { url: 'https://example.supabase.co', publishableKey: 'sb-publishable-example' },
    supabase: { createClient: () => client }
  };
  const browser = {
    window, location, URLSearchParams,
    sessionStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, value); },
      removeItem(key) { storage.delete(key); }
    },
    document: {
      readyState: 'loading',
      addEventListener(name, fn) { listeners[name] = fn; },
      getElementById(id) { return id === 'globalCompany' ? { disabled: false } : null; }
    },
    alert(message) { alerts.push(message); },
    console: { error(...args) { logs.push(args); }, warn() {}, log() {} },
    setTimeout() {}
  };
  runInNewContext(source, browser);
  return {
    auth: window.NexusAuth, storage, alerts, redirects, logs,
    get signouts() { return signouts; },
    async start() { await listeners.DOMContentLoaded(); }
  };
}

test('Supabase getUser network failure does not remove cached session', async () => {
  const ctx = makeContext({
    authError: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }
  });
  await assert.rejects(ctx.auth.restoreSession(), /Não foi possível confirmar sua sessão/);
  assert.ok(ctx.storage.has('nexus_demo_session'));
  assert.equal(ctx.signouts, 0);
});

test('Unexpected network exception preserves local session on reload', async () => {
  const ctx = makeContext({ authThrows: true });
  await ctx.start();
  assert.ok(ctx.storage.has('nexus_demo_session'));
  assert.equal(ctx.signouts, 0);
  assert.equal(ctx.redirects.length, 0);
  assert.equal(ctx.alerts.length, 0);
});

test('Transient profile lookup does not sign out on startup', async () => {
  const ctx = makeContext({ profileError: { message: 'Service unavailable', status: 503 } });
  await ctx.start();
  assert.ok(ctx.storage.has('nexus_demo_session'));
  assert.equal(ctx.signouts, 0);
  assert.equal(ctx.redirects.length, 0);
});

test('Transient entitlement lookup also preserves session', async () => {
  const ctx = makeContext({ entitlementError: { message: 'Gateway timeout', status: 504 } });
  await ctx.start();
  assert.ok(ctx.storage.has('nexus_demo_session'));
  assert.equal(ctx.signouts, 0);
  assert.equal(ctx.redirects.length, 0);
});

test('Invalid token clears cached login and requires authentication', async () => {
  const ctx = makeContext({ authError: { code: 'invalid_token', status: 401, message: 'Invalid JWT' } });
  await ctx.start();
  assert.equal(ctx.storage.has('nexus_demo_session'), false);
  assert.deepEqual(ctx.redirects, ['login.html']);
});

test('Real authorization failure retains fail-closed redirect and signout', async () => {
  const ctx = makeContext({ entitlementActive: false });
  await ctx.start();
  assert.equal(ctx.storage.has('nexus_demo_session'), false);
  assert.equal(ctx.signouts, 1);
  assert.deepEqual(ctx.redirects, ['../portal-cliente/']);
  assert.equal(ctx.alerts.length, 1);
});

test('Valid session still restores the authenticated company context', async () => {
  const ctx = makeContext();
  const session = await ctx.auth.restoreSession();
  assert.equal(session.role, 'org_admin');
  assert.equal(session.organizationId, 'org-1');
  assert.equal(JSON.parse(ctx.storage.get('nexus_demo_session')).userId, 'user-1');
});
