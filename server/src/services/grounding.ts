import { createHash } from 'node:crypto';
import { contentTypes as ctUtils } from '@strapi/utils';
import type { Core } from '@strapi/strapi';
import type { GroundingTier, InstallDescription } from '../types';

/**
 * The deterministic, permission-scoped, size-bounded description of the running install
 * (contracts/install-description.md).
 *
 * This is the "analyse the project" capability, made safe for a plugin that ships to many different
 * projects. A hard-coded field map is wrong everywhere except the one project it was written for —
 * the previous version of this plugin shipped exactly that mistake.
 *
 * ALLOWED INPUTS, and nothing else (§1):
 *   - `strapi.contentTypes`, keys prefixed `api::` only
 *   - `strapi.components`
 *   - the plugin's own `getPreviewOptions().paths` keys
 *   - the caller's live `permission-checker` `can.read()`
 *
 * FORBIDDEN INPUTS, each for a stated reason:
 *   - the host application's SOURCE CODE, controllers, services, lifecycle hooks — not reproducible
 *     across the projects this plugin ships to, its cost scales with the host repository rather
 *     than the schema, and it would make the instructions depend on files the plugin has no
 *     contract with (FR-028);
 *   - the Document Service — any entry, any count. That would put content in the prompt and make
 *     the text vary with content volume (FR-029, FR-030);
 *   - media URLs, user data, anything secret-like (FR-029);
 *   - a language model — non-deterministic by construction, and it would spend a provider call to
 *     produce the input to a provider call (FR-030);
 *   - WALL-CLOCK TIME (FR-030). There is no `Date` in this file.
 *
 * THE DESCRIPTION AUTHORIZES NOTHING (FR-037). It is filtered by the same live `can.read()` the
 * tools use, and every read and every applied change is still checked against the caller's live
 * permissions — so a content type described here can still come back blocked with a reason. It is a
 * map, not a key.
 *
 * Attribute selection uses STRAPI'S OWN predicates from `@strapi/utils` rather than re-derived
 * ones — see `renderableAttributeNames` for exactly which predicate covers what, and for the one
 * gap that has to be closed by hand. Rendering the attributes no editor writes would waste the
 * budget on noise and put private field names in the prompt.
 */

/* --------------------------------------------------------------- determinism helpers */

/**
 * A FIXED BYTE ORDERING, never `localeCompare` (§3).
 *
 * `localeCompare` is locale-dependent, so the same schema could sort differently on two hosts —
 * exactly the non-determinism FR-030 exists to prevent.
 */
const byBytes = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sorted = (values: readonly string[]): string[] => [...values].sort(byBytes);

/** Stable serialization for fingerprinting: object keys sorted recursively, arrays kept in order. */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of sorted(Object.keys(value as Record<string, unknown>))) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
};

const sha256 = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

/* ---------------------------------------------------------------- schema reading */

type Schema = { attributes?: Record<string, any>; [key: string]: any };

/**
 * Which attribute names count as private for one schema.
 *
 * THIS IS A PARAMETER, not a direct call, for one concrete reason: Strapi's own
 * `contentTypes.getPrivateAttributes()` reads the GLOBAL `strapi` — verified in
 * `@strapi/utils@5.48.1`, where `getStoredPrivateAttributes` calls
 * `strapi?.config?.get('api.responses.privateAttributes', [])`. In a Strapi process that global
 * exists and the predicate is the authority, so the service below passes it in. In a test there is
 * no such global, and referencing it throws a `ReferenceError` rather than returning undefined.
 *
 * Passing it in is what keeps the renderer genuinely pure — which is the property FR-030 needs and
 * the property the suite asserts — while still letting the production path use Strapi's predicate,
 * including any globally configured private attributes.
 */
export type PrivateAttributesResolver = (schema: Schema) => string[];

/**
 * The pure default, used when no resolver is supplied. Mirrors Strapi's logic minus the global:
 * per-schema `options.privateAttributes` plus any attribute marked `private`.
 */
const defaultPrivateAttributes: PrivateAttributesResolver = (schema) => [
  ...((schema?.options?.privateAttributes as string[] | undefined) ?? []),
  ...Object.entries(schema?.attributes ?? {})
    .filter(([, attribute]) => Boolean((attribute as { private?: boolean })?.private))
    .map(([name]) => name),
];

/**
 * Visible, non-private, non-creator attribute names for one schema, in a fixed order.
 *
 * THE CREATOR FIELDS HAVE TO BE SUBTRACTED SEPARATELY. `getVisibleAttributes` excludes `id`,
 * `documentId`, `publishedAt`, the timestamps and anything marked `visible: false` — but NOT
 * `createdBy` / `updatedBy`: verified in `@strapi/utils@5.48.1`, where `getNonVisibleAttributes`
 * never calls `getCreatorFields`, which is exported as its own helper. Without this, `createdBy`
 * renders as a relation to `admin::user`, which is noise in the budget and a field no editor
 * writes. `grounding.test.ts` is what caught it.
 *
 * Neither `getVisibleAttributes` nor `getCreatorFields` touches a global, so both are safe in the
 * pure renderer; only `getPrivateAttributes` is, which is why that one is injected.
 */
const renderableAttributeNames = (
  schema: Schema,
  privateOf: PrivateAttributesResolver
): string[] => {
  const visible: string[] = ctUtils.getVisibleAttributes(schema as never) ?? [];
  const excluded = new Set<string>([
    ...(privateOf(schema) ?? []),
    ...(ctUtils.getCreatorFields(schema as never) ?? []),
  ]);
  return sorted(visible.filter((name) => !excluded.has(name)));
};

const isLocalized = (schema: Schema): boolean =>
  schema?.pluginOptions?.i18n?.localized === true;

/**
 * Every media field as a DOTTED PATH, including inside components and dynamic zones.
 *
 * Listed explicitly rather than left to be inferred from the field list: locating media is the
 * single most common structural question, and naming the dotted paths is what lets the assistant
 * answer it without a tool round trip (§2, SC-006).
 *
 * `visited` and `depth` guard a component graph that references itself — a real possibility in
 * Strapi, and an unguarded walk would not terminate.
 */
const mediaPaths = (
  schema: Schema,
  components: Record<string, Schema>,
  privateOf: PrivateAttributesResolver,
  prefix = '',
  depth = 0,
  visited: ReadonlySet<string> = new Set()
): string[] => {
  if (depth > 6) {
    return [];
  }
  const out: string[] = [];
  const attributes = schema?.attributes ?? {};

  for (const name of renderableAttributeNames(schema, privateOf)) {
    const attribute = attributes[name];
    if (!attribute) {
      continue;
    }
    const path = prefix ? `${prefix}.${name}` : name;

    if (attribute.type === 'media') {
      out.push(path);
      continue;
    }
    if (ctUtils.isDynamicZoneAttribute(attribute)) {
      for (const componentUid of sorted(attribute.components ?? [])) {
        if (visited.has(componentUid)) {
          continue;
        }
        const component = components[componentUid];
        if (component) {
          out.push(
            ...mediaPaths(
              component,
              components,
              privateOf,
              `${path}[${componentUid}]`,
              depth + 1,
              new Set([...visited, componentUid])
            )
          );
        }
      }
      continue;
    }
    if (ctUtils.isComponentAttribute(attribute) && attribute.component) {
      if (visited.has(attribute.component)) {
        continue;
      }
      const component = components[attribute.component];
      if (component) {
        out.push(
          ...mediaPaths(
            component,
            components,
            privateOf,
            path,
            depth + 1,
            new Set([...visited, attribute.component])
          )
        );
      }
    }
  }
  return sorted(out);
};

/** Which components a readable content type actually reaches, so unreferenced ones stay out (§4). */
const referencedComponents = (
  schema: Schema,
  components: Record<string, Schema>,
  privateOf: PrivateAttributesResolver,
  depth = 0,
  acc: Set<string> = new Set()
): Set<string> => {
  if (depth > 6) {
    return acc;
  }
  const attributes = schema?.attributes ?? {};
  for (const name of renderableAttributeNames(schema, privateOf)) {
    const attribute = attributes[name];
    if (!attribute) {
      continue;
    }
    const uids: string[] = ctUtils.isDynamicZoneAttribute(attribute)
      ? (attribute.components ?? [])
      : ctUtils.isComponentAttribute(attribute) && attribute.component
        ? [attribute.component]
        : [];
    for (const uid of uids) {
      if (acc.has(uid)) {
        continue;
      }
      acc.add(uid);
      const component = components[uid];
      if (component) {
        referencedComponents(component, components, privateOf, depth + 1, acc);
      }
    }
  }
  return acc;
};

/* -------------------------------------------------------------------- rendering */

/**
 * One attribute line. `expandComponents` is what the `no-components` tier turns off: component
 * references are still NAMED, they are just not expanded into their own section.
 */
const renderAttribute = (name: string, attribute: any): string => {
  const bits: string[] = [`${name}: ${attribute.type}`];
  if (attribute.required) {
    bits.push('required');
  }
  if (attribute.type === 'enumeration' && Array.isArray(attribute.enum)) {
    // Enum values keep their DECLARED schema order — that order is itself information, and it is
    // stable. Sorting them would destroy meaning for no determinism gain.
    bits.push(`enum: ${attribute.enum.join(' | ')}`);
  }
  if (ctUtils.isRelationalAttribute(attribute) && attribute.target) {
    bits.push(`relation -> ${attribute.target} (${attribute.relation ?? 'unknown'})`);
  }
  if (ctUtils.isDynamicZoneAttribute(attribute)) {
    bits.push(`dynamic zone: ${sorted(attribute.components ?? []).join(' | ')}`);
  } else if (ctUtils.isComponentAttribute(attribute) && attribute.component) {
    bits.push(`component: ${attribute.component}`);
    if (attribute.repeatable) {
      bits.push('repeatable');
    }
  }
  return `    - ${bits.join(', ')}`;
};

const renderFields = (schema: Schema, privateOf: PrivateAttributesResolver): string[] => {
  const attributes = schema?.attributes ?? {};
  const names = renderableAttributeNames(schema, privateOf);
  if (names.length === 0) {
    return [];
  }
  return ['  fields:', ...names.map((name) => renderAttribute(name, attributes[name]))];
};

const renderContentType = (
  uid: string,
  schema: Schema,
  components: Record<string, Schema>,
  previewPaths: Record<string, string>,
  tier: GroundingTier,
  privateOf: PrivateAttributesResolver
): string[] => {
  const displayName = schema?.info?.displayName ?? uid;
  const kind = ctUtils.isSingleType(schema as never) ? 'single' : 'collection';
  const lines: string[] = [
    `- ${uid} — "${displayName}" (${kind})`,
    `  draft & publish: ${ctUtils.hasDraftAndPublish(schema as never) ? 'yes' : 'no'}   localized: ${isLocalized(schema) ? 'yes' : 'no'}`,
    `  preview target: ${previewPaths[uid] ? 'configured' : 'none'}`,
  ];

  // `names-only` keeps identity, kind, flags, preview target and the media paths — and no other
  // field detail. The media paths stay because they answer the most common structural question.
  if (tier !== 'names-only') {
    lines.push(...renderFields(schema, privateOf));
  }

  const media = mediaPaths(schema, components, privateOf);
  if (media.length > 0) {
    lines.push(`  media fields: ${media.join(', ')}`);
  }
  return lines;
};

const renderComponent = (
  uid: string,
  schema: Schema,
  privateOf: PrivateAttributesResolver
): string[] => {
  const fields = renderFields(schema, privateOf);
  return [`- ${uid}`, ...fields];
};

/* ------------------------------------------------------------------ the composer */

export interface RenderInput {
  /** `api::*` content-type schemas, already filtered to what the caller may READ. */
  readable: Record<string, Schema>;
  /** All component schemas; only those a readable content type references are rendered. */
  components: Record<string, Schema>;
  /** The plugin's own configured preview paths, keyed by content-type uid. */
  previewPaths: Record<string, string>;
  /** The declared character budget. */
  maxChars: number;
  /** Fingerprints, computed by the caller from the FULL schema and the caller's access. */
  schemaFingerprint: string;
  readableFingerprint: string;
  /**
   * Optional. The service supplies Strapi's own `getPrivateAttributes`, which needs the global
   * `strapi`; omitted, a pure equivalent is used. See `PrivateAttributesResolver`.
   */
  privateAttributesOf?: PrivateAttributesResolver;
}

/** Assemble one tier's text. Pure: the same input always produces the same bytes. */
const renderTier = (
  input: RenderInput,
  tier: GroundingTier,
  uids: readonly string[]
): string => {
  const privateOf = input.privateAttributesOf ?? defaultPrivateAttributes;
  const blocks: string[] = [];

  blocks.push('#### Content types');
  if (uids.length === 0) {
    blocks.push('(none readable by this account)');
  }
  for (const uid of uids) {
    blocks.push(
      renderContentType(
        uid,
        input.readable[uid],
        input.components,
        input.previewPaths,
        tier,
        privateOf
      ).join('\n')
    );
  }

  if (tier === 'full') {
    const referenced = new Set<string>();
    for (const uid of uids) {
      for (const componentUid of referencedComponents(input.readable[uid], input.components, privateOf)) {
        referenced.add(componentUid);
      }
    }
    const componentUids = sorted([...referenced]).filter((uid) => input.components[uid]);
    if (componentUids.length > 0) {
      blocks.push('#### Components');
      for (const uid of componentUids) {
        blocks.push(renderComponent(uid, input.components[uid], privateOf).join('\n'));
      }
    }
  }

  const withPreview = uids.filter((uid) => input.previewPaths[uid]);
  if (withPreview.length > 0) {
    blocks.push('#### Preview targets');
    blocks.push(withPreview.map((uid) => `- ${uid}`).join('\n'));
  }

  return blocks.join('\n\n');
};

/**
 * Render the description, degrading by TIER until it fits (§6, FR-032).
 *
 *   full -> no-components -> names-only -> drop content types from the END of the sorted order
 *
 * Dropping deterministically from a fixed order is arbitrary but REPRODUCIBLE, which is what the
 * requirement asks for. Dropping "the least important" would require a judgement that varies.
 *
 * Any tier below `full` sets `partial`. `charCount` must never exceed `maxChars` (SC-011).
 */
export const renderInstallDescription = (input: RenderInput): InstallDescription => {
  const allUids = sorted(Object.keys(input.readable));
  const tiers: GroundingTier[] = ['full', 'no-components', 'names-only'];

  const result = (
    text: string,
    tier: GroundingTier,
    uids: readonly string[],
    omitted: number
  ): InstallDescription => ({
    text,
    partial: tier !== 'full' || omitted > 0,
    tier,
    schemaFingerprint: input.schemaFingerprint,
    readableFingerprint: input.readableFingerprint,
    charCount: text.length,
    contentTypeCount: uids.length,
    omittedContentTypeCount: omitted,
  });

  for (const tier of tiers) {
    const text = renderTier(input, tier, allUids);
    if (text.length <= input.maxChars) {
      return result(text, tier, allUids, 0);
    }
  }

  // `names-only` still exceeds the budget: drop from the end of the sorted order, stating the
  // count. The note itself is inside the budget, which is why it is measured with the text.
  const tier: GroundingTier = 'names-only';
  for (let keep = allUids.length - 1; keep >= 0; keep -= 1) {
    const uids = allUids.slice(0, keep);
    const omitted = allUids.length - keep;
    const note = `\n\n(${omitted} further content type(s) omitted to fit the size budget. Use the read tools to discover them.)`;
    const text = renderTier(input, tier, uids) + note;
    if (text.length <= input.maxChars) {
      return result(text, tier, uids, omitted);
    }
  }

  // Even zero content types does not fit — the budget floor makes this unreachable in practice, but
  // returning an over-budget string would break SC-011, so state the situation within it.
  const fallback = '(The install description does not fit its size budget. Use the read tools.)';
  return result(
    fallback.slice(0, input.maxChars),
    tier,
    [],
    allUids.length
  );
};

/* ----------------------------------------------------------------- the service */

/** A cache entry, keyed on the exact pair of fingerprints (§5). */
interface CacheEntry {
  schemaFingerprint: string;
  readableFingerprint: string;
  description: InstallDescription;
  maxChars: number;
}

const groundingService = ({ strapi }: { strapi: Core.Strapi }) => {
  /**
   * Cache keyed on `(schemaFingerprint, readableFingerprint)` and NOTHING ELSE.
   *
   * NO TTL, deliberately. A TTL would make the description a function of *when* you asked, which is
   * precisely the non-determinism FR-030 exists to prevent. A new content type changes the schema
   * fingerprint, so the next request reflects it WITH NO RESTART (FR-033), and the readable-uid list
   * is the only ability input that can change the output — so a cache hit is provably the right
   * text, not a probably-still-current one.
   */
  const cache = new Map<string, CacheEntry>();

  const apiContentTypes = (): Record<string, Schema> => {
    const all = strapi.contentTypes as unknown as Record<string, Schema>;
    const out: Record<string, Schema> = {};
    for (const uid of sorted(Object.keys(all))) {
      if (uid.startsWith('api::')) {
        out[uid] = all[uid];
      }
    }
    return out;
  };

  const allComponents = (): Record<string, Schema> => {
    const all = (strapi.components ?? {}) as unknown as Record<string, Schema>;
    const out: Record<string, Schema> = {};
    for (const uid of sorted(Object.keys(all))) {
      out[uid] = all[uid];
    }
    return out;
  };

  const service = {
    /** sha256 over the canonically serialized `api::*` schemas plus components (§5). */
    schemaFingerprint(): string {
      return sha256({ contentTypes: apiContentTypes(), components: allComponents() });
    },

    /**
     * The uids the CALLER may read, sorted — the same live `can.read()` every tool makes, so the
     * description can never widen what the caller may see (FR-031).
     */
    readableUids(userAbility: unknown): string[] {
      const uids: string[] = [];
      for (const uid of sorted(Object.keys(apiContentTypes()))) {
        try {
          const checker = strapi
            .plugin('content-manager')
            .service('permission-checker')
            .create({ userAbility, model: uid });
          if (checker.can.read()) {
            uids.push(uid);
          }
        } catch {
          // A checker that cannot be built is treated as NOT readable — default-deny.
        }
      }
      return uids;
    },

    /**
     * The description for one caller. Returns null when the caller can read nothing, so the prompt
     * omits section 10 entirely rather than embedding an empty heading.
     */
    describe(userAbility: unknown): InstallDescription | null {
      const readableUids = service.readableUids(userAbility);
      if (readableUids.length === 0) {
        return null;
      }

      const { maxChars } = strapi.plugin('ai-content-studio').service('config').getGroundingOptions();
      const schemaFingerprint = service.schemaFingerprint();
      const readableFingerprint = sha256(readableUids);
      const key = `${schemaFingerprint}:${readableFingerprint}`;

      const hit = cache.get(key);
      if (hit && hit.maxChars === maxChars) {
        return hit.description;
      }

      const all = apiContentTypes();
      const readable: Record<string, Schema> = {};
      for (const uid of readableUids) {
        readable[uid] = all[uid];
      }

      const description = renderInstallDescription({
        readable,
        components: allComponents(),
        previewPaths:
          strapi.plugin('ai-content-studio').service('config').getPreviewOptions().paths ?? {},
        maxChars,
        schemaFingerprint,
        readableFingerprint,
        /**
         * Strapi's OWN predicate is the authority here, and this is the boundary where it can be:
         * the global `strapi` it reads exists inside a Strapi process. It additionally covers
         * `api.responses.privateAttributes` configured globally by the host, which a re-derived
         * check would miss.
         */
        privateAttributesOf: (schema) => ctUtils.getPrivateAttributes(schema as never) ?? [],
      });

      cache.set(key, { schemaFingerprint, readableFingerprint, description, maxChars });
      return description;
    },
  };

  return service;
};

export default groundingService;
