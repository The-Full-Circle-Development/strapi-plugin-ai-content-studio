import type { Core } from '@strapi/strapi';
import type { AuditCoverage, AuditFinding, AuditReport, AuditSeverity } from '../types';

/**
 * Read-only security audit of the RUNNING configuration (FR-046, D2 — never project source files).
 *
 * The single most important property of this file: every `evidence` value passes through the shared
 * redaction helper BEFORE the report leaves the tool, so a secret-like value is reported as a mask
 * plus its location and nothing key-shaped ever reaches the model, the persisted transcript, or a
 * log line (FR-049, Constitution I). The `finding()` helper below is the only way to add a finding,
 * and it always masks — there is no unmasked path to add one.
 *
 * Strictly read-only (FR-050): remediations are advice. Applying one goes through proposeChanges and
 * the caller's normal permission checks.
 */

export type AuditArea = 'permissions' | 'endpoints' | 'uploads' | 'settings' | 'content-secrets';

export const AUDIT_AREAS: AuditArea[] = [
  'permissions',
  'endpoints',
  'uploads',
  'settings',
  'content-secrets',
];

/** File extensions and MIME types that execute or script if a browser or server is fooled. */
const DANGEROUS_UPLOAD_TYPES = [
  'application/x-httpd-php',
  'application/x-sh',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/javascript',
  'text/javascript',
  'application/x-executable',
  'application/vnd.microsoft.portable-executable',
  'text/html',
  'image/svg+xml',
];

const WRITE_ACTIONS = ['create', 'update', 'delete', 'publish'];

const SEVERITY: Record<string, AuditSeverity> = {
  'public-write-permission': 'critical',
  'secret-like-value': 'critical',
  'unauthenticated-endpoint': 'high',
  'unsafe-upload-types': 'high',
  'role-overbroad': 'medium',
  'debug-setting': 'medium',
};

const auditSecurityService = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ai-content-studio');
  const redact = () => plugin().service('redact');

  const service = {
    async run({
      areas = AUDIT_AREAS,
      userAbility,
    }: {
      areas?: AuditArea[];
      userAbility: unknown;
    }): Promise<AuditReport> {
      const deadline = Date.now() + plugin().service('config').getAuditOptions().timeBudgetMs;
      const outOfTime = () => Date.now() >= deadline;

      const findings: AuditFinding[] = [];
      const coverage: AuditCoverage = { inspected: [], skippedForPermissions: [], skippedForBudget: [] };

      /**
       * The ONLY way to add a finding. `evidence` is redacted here, unconditionally, so no caller
       * can bypass masking by forgetting to.
       */
      const finding = (
        category: keyof typeof SEVERITY,
        location: AuditFinding['location'],
        evidence: string,
        impact: string,
        remediation: string
      ) => {
        findings.push({
          category: category as AuditFinding['category'],
          severity: SEVERITY[category],
          location,
          evidence: redact().redactSecrets(evidence),
          impact,
          remediation,
        });
      };

      const selected = areas.filter((area) => AUDIT_AREAS.includes(area));

      for (const area of selected) {
        if (outOfTime()) {
          coverage.skippedForBudget.push(area);
          continue;
        }
        coverage.inspected.push(area);
        try {
          if (area === 'permissions' || area === 'endpoints') {
            await service.auditPublicRole(finding, area);
          }
          if (area === 'permissions') {
            await service.auditAdminRoles(finding);
          }
          if (area === 'uploads') {
            service.auditUploadRules(finding);
          }
          if (area === 'settings') {
            service.auditDebugSettings(finding);
          }
          if (area === 'content-secrets') {
            await service.auditStoredSecrets(finding, userAbility, outOfTime, coverage);
          }
        } catch (err) {
          // A failed area is reported as uncovered, never as clean.
          coverage.inspected = coverage.inspected.filter((a) => a !== area);
          coverage.skippedForBudget.push(`${area} (could not be inspected)`);
          strapi.log.warn(
            `[ai-content-studio] security audit area "${area}" failed: ${redact().describeError(err)}`
          );
        }
      }

      const counts: Record<AuditSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
      for (const f of findings) {
        counts[f.severity] += 1;
      }

      return { kind: 'security', runAt: new Date().toISOString(), coverage, counts, findings };
    },

    /**
     * The public (unauthenticated) role: write grants are critical, and any content-API endpoint it
     * can read is reported so an unintended public exposure is visible.
     */
    async auditPublicRole(
      finding: (
        category: keyof typeof SEVERITY,
        location: AuditFinding['location'],
        evidence: string,
        impact: string,
        remediation: string
      ) => void,
      area: AuditArea
    ): Promise<void> {
      const publicRole = await strapi.db
        .query('plugin::users-permissions.role')
        .findOne({ where: { type: 'public' }, populate: { permissions: true } });
      if (!publicRole) {
        return;
      }
      const permissions: Array<{ action?: string }> = Array.isArray(publicRole.permissions)
        ? publicRole.permissions
        : [];

      for (const permission of permissions) {
        const action = String(permission.action ?? '');
        if (!action.startsWith('api::')) {
          continue;
        }
        const verb = action.split('.').pop() ?? '';

        if (area === 'permissions' && WRITE_ACTIONS.includes(verb)) {
          finding(
            'public-write-permission',
            { contentTypeUid: action.split('.').slice(0, 2).join('.'), configPath: `role "public" -> ${action}` },
            `The public role is granted "${verb}" on ${action}`,
            'Anyone on the internet can change or destroy this content with no credentials at all.',
            `In Settings -> Users & Permissions -> Roles -> Public, untick "${verb}" for that content type.`
          );
        }

        if (area === 'endpoints' && verb === 'find') {
          finding(
            'unauthenticated-endpoint',
            { contentTypeUid: action.split('.').slice(0, 2).join('.'), configPath: `role "public" -> ${action}` },
            `${action} is readable without authentication`,
            'The endpoint and every field it returns are public. That is correct for a website, and a data leak for anything internal.',
            'Confirm this content type is meant to be public. If it is not, untick "find"/"findOne" for the Public role.'
          );
        }
      }
    },

    /**
     * A role holding permissions outside its stated scope. Checkable version: an admin role whose
     * name/description says read-only or author-only yet holds delete or publish.
     */
    async auditAdminRoles(
      finding: (
        category: keyof typeof SEVERITY,
        location: AuditFinding['location'],
        evidence: string,
        impact: string,
        remediation: string
      ) => void
    ): Promise<void> {
      const roles = await strapi.db
        .query('admin::role')
        .findMany({ populate: { permissions: true } })
        .catch(() => []);

      for (const role of Array.isArray(roles) ? roles : []) {
        if (role.code === 'strapi-super-admin') {
          continue;
        }
        const described = `${role.name ?? ''} ${role.description ?? ''}`.toLowerCase();
        const claimsReadOnly = /read[- ]?only|viewer|reviewer|read access/.test(described);
        const claimsAuthorScope = /author|contributor|writer/.test(described);

        const actions: string[] = (Array.isArray(role.permissions) ? role.permissions : []).map(
          (p: { action?: string }) => String(p.action ?? '')
        );
        const escalations = actions.filter((action) =>
          claimsReadOnly
            ? /\.(create|update|delete|publish)$/.test(action)
            : claimsAuthorScope
              ? /\.(delete|publish)$/.test(action)
              : false
        );

        if (escalations.length > 0) {
          finding(
            'role-overbroad',
            { configPath: `admin role "${role.name}"` },
            `Role "${role.name}" is described as ${
              claimsReadOnly ? 'read-only' : 'author-scoped'
            } but holds ${escalations.length} action${escalations.length === 1 ? '' : 's'} beyond that, e.g. ${escalations
              .slice(0, 3)
              .join(', ')}`,
            'Anyone in this role can do more than the role is documented to allow, so reviews of "who can do what" are wrong.',
            `Either narrow "${role.name}" in Settings -> Administration Panel -> Roles, or update its description to match what it actually grants.`
          );
        }
      }
    },

    /** Upload rules that accept executable or script types. */
    auditUploadRules(
      finding: (
        category: keyof typeof SEVERITY,
        location: AuditFinding['location'],
        evidence: string,
        impact: string,
        remediation: string
      ) => void
    ): void {
      const allowedTypes = strapi.config.get('plugin::upload.allowedTypes', undefined) as unknown;
      const sizeLimit = strapi.config.get('plugin::upload.sizeLimit', undefined) as unknown;

      if (Array.isArray(allowedTypes)) {
        const dangerous = allowedTypes.filter((t) => DANGEROUS_UPLOAD_TYPES.includes(String(t)));
        if (dangerous.length > 0) {
          finding(
            'unsafe-upload-types',
            { configPath: 'plugin::upload.allowedTypes' },
            `Uploads explicitly allow ${dangerous.join(', ')}`,
            'A script or executable served from your own origin can run in a visitor\'s browser (stored XSS) or be executed server-side.',
            `Remove ${dangerous.join(', ')} from plugin::upload.allowedTypes, or serve uploads from a separate origin with Content-Disposition: attachment.`
          );
        }
      } else {
        // No allow-list at all: Strapi's default. Worth stating, since it is the condition FR-046
        // asks about and most projects never revisit it.
        finding(
          'unsafe-upload-types',
          { configPath: 'plugin::upload.allowedTypes' },
          'Uploads have no MIME allow-list, so any file type is accepted, including SVG, HTML and scripts',
          'An uploaded SVG or HTML file served from your origin can execute JavaScript in a visitor\'s session.',
          "Set plugin::upload.allowedTypes in config/plugins.ts to the types your project actually needs, e.g. ['images', 'files'] with SVG excluded."
        );
      }

      if (typeof sizeLimit === 'number' && sizeLimit > 512 * 1024 * 1024) {
        finding(
          'unsafe-upload-types',
          { configPath: 'plugin::upload.sizeLimit' },
          `The upload size limit is ${Math.round(sizeLimit / 1024 / 1024)} MB`,
          'A very large limit makes it cheap for an authenticated account to exhaust disk or bandwidth.',
          'Lower plugin::upload.sizeLimit to the largest file the project genuinely needs.'
        );
      }
    },

    /** Debug and verbose-error settings that are unsafe in production. */
    auditDebugSettings(
      finding: (
        category: keyof typeof SEVERITY,
        location: AuditFinding['location'],
        evidence: string,
        impact: string,
        remediation: string
      ) => void
    ): void {
      const setting = (path: string): unknown => strapi.config.get(path, undefined) as unknown;

      if (setting('plugin::ai-content-studio.showProviderErrorDetails') === true) {
        finding(
          'debug-setting',
          { configPath: 'plugin::ai-content-studio.showProviderErrorDetails' },
          'showProviderErrorDetails is enabled, so raw provider errors are surfaced in the chat UI',
          'Provider errors can carry request URLs and internal detail. They are redacted, but the setting exists for debugging and widens what an editor sees.',
          'Set AI_STUDIO_SHOW_ERROR_DETAILS=false (or remove showProviderErrorDetails) in production.'
        );
      }

      if (setting('plugin::graphql.playgroundAlways') === true) {
        finding(
          'debug-setting',
          { configPath: 'plugin::graphql.playgroundAlways' },
          'The GraphQL playground is enabled unconditionally',
          'The playground lets anyone who can reach it explore the whole schema, which is a map of your data model.',
          'Set playgroundAlways: false outside development.'
        );
      }

      if (setting('server.app.keys') === undefined) {
        finding(
          'debug-setting',
          { configPath: 'server.app.keys' },
          'APP_KEYS is not configured',
          'Session cookies are signed with a default or missing key, which makes them forgeable.',
          'Set APP_KEYS to a comma-separated pair of random secrets in the environment.'
        );
      }
    },

    /**
     * Secret-like values stored in content fields.
     *
     * Only string fields of types the CALLER can read are inspected, and a hit is reported as a mask
     * plus its location — the value itself is never carried, not even into this function's return
     * (FR-049). The finding text contains `mask()` output only.
     */
    async auditStoredSecrets(
      finding: (
        category: keyof typeof SEVERITY,
        location: AuditFinding['location'],
        evidence: string,
        impact: string,
        remediation: string
      ) => void,
      userAbility: unknown,
      outOfTime: () => boolean,
      coverage: AuditCoverage
    ): Promise<void> {
      const uids = Object.keys(strapi.contentTypes).filter((uid) => uid.startsWith('api::'));

      for (const uid of uids) {
        if (outOfTime()) {
          coverage.skippedForBudget.push(`content-secrets: ${uid}`);
          continue;
        }
        let readable = false;
        try {
          readable = Boolean(
            strapi
              .plugin('content-manager')
              .service('permission-checker')
              .create({ userAbility, model: uid }).can.read()
          );
        } catch {
          readable = false;
        }
        if (!readable) {
          coverage.skippedForPermissions.push(`content-secrets: ${uid}`);
          continue;
        }

        const ct = (strapi.contentTypes as Record<string, any>)[uid];
        const stringFields = Object.entries(ct?.attributes ?? {})
          .filter(([, a]: [string, any]) => ['string', 'text', 'richtext'].includes(a?.type))
          .map(([name]) => name);
        if (stringFields.length === 0) {
          continue;
        }

        let entries: any[] = [];
        try {
          const result =
            ct.kind === 'singleType'
              ? [await strapi.documents(uid as never).findFirst({})]
              : await strapi.documents(uid as never).findMany({ limit: 50 });
          entries = (Array.isArray(result) ? result : []).filter(Boolean);
        } catch {
          coverage.skippedForBudget.push(`content-secrets: ${uid}`);
          continue;
        }

        for (const entry of entries) {
          for (const field of stringFields) {
            const value = entry?.[field];
            if (!redact().looksSecretLike(value)) {
              continue;
            }
            finding(
              'secret-like-value',
              { contentTypeUid: uid, documentId: entry.documentId, field },
              // mask() first, then the finding helper redacts again. Two independent barriers.
              `Field "${field}" holds what looks like a credential: ${redact().mask(String(value))}`,
              'A credential stored in content is readable by anyone who can read that entry, and is served to the public if the type is public. Treat it as compromised.',
              `Remove the value from "${field}" on this entry, move it to an environment variable, and ROTATE the credential — it must be assumed leaked.`
            );
          }
        }
      }
    },
  };

  return service;
};

export default auditSecurityService;
