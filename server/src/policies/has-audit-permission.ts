import type { Core } from '@strapi/strapi';

export const AUDIT_RUN_ACTION = 'plugin::ai-content-studio.audit.run';

/**
 * Gates a route on the new `audit.run` action.
 *
 * The security audit's real gate is inside the tool, checked against the caller's LIVE ability so
 * it re-derives per request (Constitution II). This policy exists for any route that surfaces
 * audit output directly, and it deliberately refuses without disclosing anything about what the
 * audit would have found (FR-048).
 */
const hasAuditPermission = (policyContext: any, _config: unknown, { strapi: _strapi }: { strapi: Core.Strapi }) => {
  const ability = policyContext.state?.userAbility;
  return Boolean(ability?.can?.(AUDIT_RUN_ACTION));
};

export default hasAuditPermission;
