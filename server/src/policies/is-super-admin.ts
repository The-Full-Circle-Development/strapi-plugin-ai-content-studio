import type { Core } from '@strapi/strapi';

const SUPER_ADMIN_CODE = 'strapi-super-admin';

/**
 * Gates a route to super-admins only. Key management is a hard role rule, not a delegable
 * permission, so we check the role code directly rather than using `admin::hasPermissions`.
 * `ctx.state.user` (with roles) is populated by the admin auth strategy on type:'admin' routes.
 */
const isSuperAdmin = (policyContext: any, _config: unknown, { strapi: _strapi }: { strapi: Core.Strapi }) => {
  const roles = policyContext.state?.user?.roles ?? [];
  return Array.isArray(roles) && roles.some((role: any) => role?.code === SUPER_ADMIN_CODE);
};

export default isSuperAdmin;
