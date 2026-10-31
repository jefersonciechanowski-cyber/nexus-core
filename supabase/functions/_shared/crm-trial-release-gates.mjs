// Shared, fail-closed commercial trial gate. No network or database writes.
// Pilot is restricted to Nexus admins with MFA2 by the trial endpoint.
// Staging a deployment never enables grants or expiration by itself.
const enabled = (env, key) => env?.[key] === 'true';

/** @param {Record<string,string|undefined>} env
 * @param {'grant'|'expire'} operation
 * @returns {boolean}
 */
export function canOperateCrmTrial(env, operation) {
  if (!env || !['grant','expire'].includes(operation)) return false;
  // Independent approval is required after verifying the daily expiration
  // workflow, product tenancy and entitlement delivery in a pilot.
  if (!enabled(env,'NEXUS_CRM_TRIAL_RELEASE_APPROVED')
    || env.NEXUS_CRM_TRIAL_RELEASE_MODE !== 'pilot'
    || !enabled(env,'NEXUS_CRM_TRIAL_EXPIRY_SCHEDULE_CONFIRMED')
    || !enabled(env,'NEXUS_CRM_TRIAL_RECONCILE_ENABLED')) return false;
  return operation==='grant'
    ? enabled(env,'NEXUS_CRM_TRIAL_GRANTS_ENABLED')
    : true;
}
