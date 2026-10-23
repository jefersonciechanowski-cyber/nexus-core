// Shared by the deployed Edge Function and its runtime-independent tests.
export const CRM_DEMO_HONEYPOT_KEYS = Object.freeze([
  "website", // Existing public form during the safe rollout.
  "crmHiddenSecurityField", // New field name not associated with browser URL autofill.
]);

export function isHoneypotFilled(payload) {
  if (!payload || typeof payload !== "object") return false;
  return CRM_DEMO_HONEYPOT_KEYS.some((key) => {
    const value = payload[key];
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.trim().length > 0;
    return true;
  });
}
