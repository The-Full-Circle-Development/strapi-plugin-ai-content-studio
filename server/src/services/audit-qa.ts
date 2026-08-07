import type { Core } from '@strapi/strapi';
import type { AuditCoverage, AuditFinding, AuditReport, AuditSeverity } from '../types';

/**
 * Functional QA over the RUNNING configuration and content data.
 *
 * Strictly read-only (FR-042): nothing here calls create, update, publish or delete. It only reads
 * `strapi.contentTypes`, `strapi.components`, and documents the CALLER is permitted to read.
 *
 * Two honesty rules are structural rather than advisory:
 *   - types the caller cannot read are SKIPPED and listed (FR-043);
 *   - the pass stops at its time budget and lists what it never reached, so a partial pass can never
 *     read as a clean bill of health (FR-044).
 *
 * Scope is bounded by spec decision D2: the running application, never the project's source files.
 */

const DEFAULT_SAMPLE = 50;
const MAX_SAMPLE = 200;

/** Severity per check, chosen by how visibly the defect breaks a rendered page. */
const SEVERITY: Record<string, AuditSeverity> = {
  'published-required-empty': 'high',
  'dangling-relation': 'high',
  'missing-media': 'medium',
  'required-empty': 'medium',
  'enum-out-of-range': 'medium',
  'component-broken': 'medium',
  'single-type-missing': 'low',
};

const auditQaService = ({ strapi }: { strapi: Core.Strapi }) => {
  const docs = (uid: string): any => strapi.documents(uid as never);
  const plugin = () => strapi.plugin('ai-content-studio');

  const ctOf = (uid: string): any => (strapi.contentTypes as Record<string, any>)[uid];
  const componentOf = (name: string): any => (strapi.components as Record<string, any>)[name];

  const canRead = (uid: string, userAbility: unknown): boolean => {
    try {
      return Boolean(
        strapi
          .plugin('content-manager')
          .service('permission-checker')
          .create({ userAbility, model: uid }).can.read()
      );
    } catch {
      return false;
    }
  };

  const isEmpty = (value: unknown): boolean =>
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0);

  const labelOf = (doc: any, uid: string): string => {
    for (const key of ['title', 'name', 'heading', 'label', 'slug']) {
      if (typeof doc?.[key] === 'string' && doc[key].trim() !== '') {
        return doc[key];
      }
    }
    return doc?.documentId ?? ctOf(uid)?.info?.displayName ?? uid;
  };

  const service = {
    async run({
      userAbility,
      contentTypeUids,
      maxEntriesPerType = DEFAULT_SAMPLE,
    }: {
      userAbility: unknown;
      contentTypeUids?: string[];
      maxEntriesPerType?: number;
    }): Promise<AuditReport> {
      const deadline = Date.now() + plugin().service('config').getAuditOptions().timeBudgetMs;
      const sample = Math.min(MAX_SAMPLE, Math.max(1, Math.trunc(maxEntriesPerType) || DEFAULT_SAMPLE));
      const outOfTime = () => Date.now() >= deadline;

      const allUids = Object.keys(strapi.contentTypes).filter((uid) => uid.startsWith('api::'));
      const requested =
        contentTypeUids && contentTypeUids.length > 0
          ? allUids.filter((uid) => contentTypeUids.includes(uid))
          : allUids;

      const coverage: AuditCoverage = { inspected: [], skippedForPermissions: [], skippedForBudget: [] };
      const findings: AuditFinding[] = [];

      const add = (
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
          // Content values can contain anything, including something key-shaped a QA finding would
          // otherwise echo. One shared helper, applied before the result leaves the tool.
          evidence: plugin().service('redact').redactSecrets(evidence),
          impact,
          remediation,
        });
      };

      for (const uid of requested) {
        if (outOfTime()) {
          coverage.skippedForBudget.push(uid);
          continue;
        }
        if (!canRead(uid, userAbility)) {
          coverage.skippedForPermissions.push(uid);
          continue;
        }

        const ct = ctOf(uid);
        const attributes: Record<string, any> = ct?.attributes ?? {};
        const draftAndPublish = Boolean(ct?.options?.draftAndPublish);
        coverage.inspected.push(uid);

        // --- single type never created
        if (ct?.kind === 'singleType') {
          const sole = await docs(uid).findFirst({ populate: '*' });
          if (!sole) {
            add(
              'single-type-missing',
              { contentTypeUid: uid },
              `${ct.info?.displayName ?? uid} has no entry`,
              'Anything on the site that reads this single type renders empty or errors.',
              `Create the ${ct.info?.displayName ?? uid} entry in the Content Manager and fill its required fields.`
            );
            continue;
          }
          await service.inspectEntry({ uid, attributes, doc: sole, draftAndPublish, add, outOfTime });
          continue;
        }

        // --- collection type: bounded sample
        let entries: any[] = [];
        try {
          const result = await docs(uid).findMany({ populate: '*', limit: sample, status: 'draft' });
          entries = Array.isArray(result) ? result : [];
        } catch {
          coverage.inspected = coverage.inspected.filter((u) => u !== uid);
          coverage.skippedForBudget.push(uid);
          continue;
        }

        for (const doc of entries) {
          if (outOfTime()) {
            coverage.skippedForBudget.push(`${uid} (after ${entries.indexOf(doc)} of ${entries.length} entries)`);
            break;
          }
          await service.inspectEntry({ uid, attributes, doc, draftAndPublish, add, outOfTime });
        }
      }

      const counts: Record<AuditSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
      for (const finding of findings) {
        counts[finding.severity] += 1;
      }

      return {
        kind: 'qa',
        runAt: new Date().toISOString(),
        coverage,
        counts,
        findings,
      };
    },

    /** The per-entry checks from R7. Read-only throughout. */
    async inspectEntry({
      uid,
      attributes,
      doc,
      draftAndPublish,
      add,
      outOfTime,
      pathPrefix = '',
    }: {
      uid: string;
      attributes: Record<string, any>;
      doc: any;
      draftAndPublish: boolean;
      add: (
        category: keyof typeof SEVERITY,
        location: AuditFinding['location'],
        evidence: string,
        impact: string,
        remediation: string
      ) => void;
      outOfTime: () => boolean;
      pathPrefix?: string;
    }): Promise<void> {
      const label = labelOf(doc, uid);
      const documentId = doc?.documentId;
      // A published entry that fails its own required fields is the worst case: it is LIVE.
      const isPublished = draftAndPublish && Boolean(doc?.publishedAt);

      for (const [name, attribute] of Object.entries(attributes)) {
        if (outOfTime()) {
          return;
        }
        const path = pathPrefix ? `${pathPrefix}.${name}` : name;
        const value = doc?.[name];

        // --- required field empty
        if (attribute.required && isEmpty(value)) {
          if (isPublished) {
            add(
              'published-required-empty',
              { contentTypeUid: uid, documentId, field: path },
              `"${label}" is published with required field "${path}" empty`,
              'A live page reads a value that is not there, so it renders blank or throws.',
              `Fill "${path}" on "${label}", or unpublish the entry until it is complete.`
            );
          } else {
            add(
              'required-empty',
              { contentTypeUid: uid, documentId, field: path },
              `"${label}" has required field "${path}" empty`,
              'Saving or publishing this entry will fail validation, and anything reading the field gets nothing.',
              `Fill "${path}" on "${label}".`
            );
          }
        }

        // --- value outside an enumeration's allowed set
        if (attribute.type === 'enumeration' && !isEmpty(value)) {
          const allowed: string[] = Array.isArray(attribute.enum) ? attribute.enum : [];
          if (allowed.length > 0 && !allowed.includes(String(value))) {
            add(
              'enum-out-of-range',
              { contentTypeUid: uid, documentId, field: path },
              `"${label}" has "${path}" = "${String(value)}", which is not one of ${allowed.join(', ')}`,
              'Code that switches on this value falls through, so the entry renders with the wrong variant or not at all.',
              `Set "${path}" on "${label}" to one of: ${allowed.join(', ')}.`
            );
          }
        }

        // --- relation pointing at a missing document
        if (attribute.type === 'relation' && !isEmpty(value)) {
          const targets = Array.isArray(value) ? value : [value];
          const missing = targets.filter((t: any) => t && typeof t === 'object' && !t.documentId && !t.id);
          if (missing.length > 0) {
            add(
              'dangling-relation',
              { contentTypeUid: uid, documentId, field: path },
              `"${label}" has ${missing.length} unresolvable relation${missing.length === 1 ? '' : 's'} in "${path}" (target ${attribute.target ?? 'unknown'})`,
              'Following the relation yields nothing, so a linked title, image or page URL renders empty.',
              `Re-link "${path}" on "${label}" to an existing ${attribute.target ?? 'entry'}, or clear it.`
            );
          }
        }

        // --- media field referencing a missing file
        if (attribute.type === 'media' && !isEmpty(value)) {
          const files = Array.isArray(value) ? value : [value];
          for (const file of files) {
            const id = (file as any)?.id;
            if (!id) {
              continue;
            }
            const exists = await strapi.db
              .query('plugin::upload.file')
              .findOne({ where: { id }, select: ['id'] })
              .catch(() => null);
            if (!exists) {
              add(
                'missing-media',
                { contentTypeUid: uid, documentId, field: path },
                `"${label}" references file id ${id} in "${path}", which is not in the Media Library`,
                'The image or download is a broken link on every page that renders it.',
                `Re-upload the file and re-select it on "${path}" for "${label}", or clear the field.`
              );
            }
          }
        }

        // --- component usage that cannot render
        if (attribute.type === 'component') {
          const definition = componentOf(attribute.component);
          if (!definition) {
            add(
              'component-broken',
              { contentTypeUid: uid, documentId, field: path },
              `"${label}" uses component "${attribute.component}" in "${path}", which is not registered`,
              'The component cannot be resolved, so the section it belongs to fails to render.',
              `Restore the "${attribute.component}" component definition, or remove "${path}" from ${uid}.`
            );
          } else if (!isEmpty(value)) {
            const entries = attribute.repeatable ? (Array.isArray(value) ? value : []) : [value];
            for (const [index, entry] of entries.entries()) {
              await service.inspectEntry({
                uid,
                attributes: definition.attributes ?? {},
                // The component entry carries the parent's identity for reporting purposes.
                doc: { ...entry, documentId, title: label },
                draftAndPublish,
                add,
                outOfTime,
                pathPrefix: attribute.repeatable ? `${path}[${index}]` : path,
              });
            }
          }
        }

        // --- dynamic zone: an entry naming a component that no longer exists
        if (attribute.type === 'dynamiczone' && !isEmpty(value)) {
          const entries = Array.isArray(value) ? value : [];
          for (const [index, entry] of entries.entries()) {
            const componentName = (entry as any)?.__component;
            const definition = componentName ? componentOf(componentName) : null;
            if (!definition) {
              add(
                'component-broken',
                { contentTypeUid: uid, documentId, field: `${path}[${index}]` },
                `"${label}" has a "${componentName ?? 'unnamed'}" block in "${path}" that is not a registered component`,
                'The block cannot be resolved, so the page section fails to render.',
                `Remove the block from "${path}" on "${label}", or restore the "${componentName}" component.`
              );
              continue;
            }
            await service.inspectEntry({
              uid,
              attributes: definition.attributes ?? {},
              doc: { ...(entry as object), documentId, title: label },
              draftAndPublish,
              add,
              outOfTime,
              pathPrefix: `${path}[${index}]`,
            });
          }
        }
      }
    },
  };

  return service;
};

export default auditQaService;
