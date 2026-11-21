// Read-only, bucket-scoped export for Central's private Storage documents.
// Only GitHub Actions OIDC tokens from the reviewed main-branch workflow are accepted.
// This endpoint DOES NOT authenticate Supabase users. verify_jwt=false is required
// because the JWT is signed by GitHub. All requests are verified cryptographically.
const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "https://svphwbccqeoakpmcpvhy.supabase.co/functions/v1/nexus-central-storage-backup";
const REPO = "jefersonciechanowski-cyber/nexus-core";
const REPO_ID = "1323260483";
const REF = "refs/heads/main";
const WORKFLOW_REF = REPO + "/.github/workflows/central-real-restore-drill.yml@" + REF;
const BUCKET = "sst-documents";
const JWKS = "https://token.actions.githubusercontent.com/.well-known/jwks";

function base64url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 14000) throw Error("malformed");
  const input = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(input + "=".repeat((4 - input.length % 4) % 4));
  return Uint8Array.from(raw, (v) => v.charCodeAt(0));
}
function jsonPart(part: string): Record<string, unknown> {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(base64url(part));
  const value = JSON.parse(text);
  if (!value || Array.isArray(value) || typeof value !== "object") throw Error("malformed");
  return value as Record<string, unknown>;
}
async function verifyGitHub(token: string): Promise<boolean> {
  try {
    if (token.length > 12000) return false;
    const sections = token.split(".");
    if (sections.length !== 3) return false;
    const [headerPart, claimsPart, sigPart] = sections;
    const header = jsonPart(headerPart);
    const claims = jsonPart(claimsPart);
    if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length > 150) return false;
    // Reject before network access when any of the requested trust conditions fails.
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== ISSUER || claims.aud !== AUDIENCE ||
        claims.sub !== "repo:" + REPO + ":ref:" + REF ||
        claims.repository !== REPO || claims.repository_id !== REPO_ID ||
        claims.ref !== REF || claims.workflow_ref !== WORKFLOW_REF ||
        !["schedule", "push", "workflow_dispatch"].includes(String(claims.event_name)) ||
        typeof claims.iat !== "number" || typeof claims.exp !== "number" ||
        claims.iat > now + 30 || claims.iat < now - 600 ||
        claims.exp < now - 30 || claims.exp > now + 660 ||
        (typeof claims.nbf === "number" && claims.nbf > now + 30)) return false;
    // Fetch the key set ONLY from the pinned GitHub OIDC issuer over HTTPS.
    const response = await fetch(JWKS, { redirect: "error", signal: AbortSignal.timeout(7000), cache: "no-store" });
    if (!response.ok) return false;
    const jwks = await response.json() as { keys?: Array<Record<string, unknown>> };
    if (!Array.isArray(jwks.keys)) return false;
    const match = jwks.keys.find((k) => k.kid === header.kid && k.kty === "RSA" &&
      (!k.use || k.use === "sig") && (!k.alg || k.alg === "RS256") &&
      typeof k.n === "string" && typeof k.e === "string");
    if (!match) return false;
    const key = await crypto.subtle.importKey("jwk",
      match as JsonWebKey,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false, ["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key,
      base64url(sigPart),
      new TextEncoder().encode(headerPart + "." + claimsPart));
  } catch {
    return false;
  }
}

function deny(status: number): Response {
  return new Response(JSON.stringify({ error: "Not authorized" }), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return deny(405);
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") ||
      !(await verifyGitHub(authorization.slice(7)))) return deny(401);
  try {
    const bodyText = await request.text();
    if (bodyText.length > 1500) return deny(400);
    const body = JSON.parse(bodyText) as { bucket?: unknown; name?: unknown };
    if (body.bucket !== BUCKET || typeof body.name !== "string" ||
        body.name.length < 1 || body.name.length > 800 ||
        body.name.startsWith("/") || body.name.endsWith("/") ||
        body.name.split("/").some((s) => !s || s === "." || s === "..") ||
        /[\\\u0000-\u001F\u007F]/.test(body.name)) return deny(400);
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key || !url.startsWith("https://svphwbccqeoakpmcpvhy.supabase.co")) return deny(503);
    // Read-only authenticated object retrieval. No list, write, delete,
    // signed URLs, mutable ACLs, tenant data or external provider access.
    const objectPath = body.name.split("/").map(encodeURIComponent).join("/");
    const objectUrl = url + "/storage/v1/object/authenticated/" + encodeURIComponent(BUCKET) + "/" + objectPath;
    const response = await fetch(objectUrl, {
      method: "GET",
      headers: { authorization: "Bearer " + key, apikey: key, "cache-control": "no-store" },
      redirect: "error", signal: AbortSignal.timeout(25000),
    });
    if (!response.ok || !response.body) return deny(response.status === 404 ? 404 : 502);
    return new Response(response.body, {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "cache-control": "no-store, private",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return deny(400);
  }
});
