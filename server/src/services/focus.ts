import type { Core } from '@strapi/strapi';
import type { FocusResolution, ThreadFocus } from '../types';

/**
 * Focus — the one entry an editor has pointed at (005 contracts/situation-and-focus.md §1, §3).
 *
 * FOCUS GRANTS NOTHING, and this file is where that is true or false. It is re-resolved and
 * re-permission-checked on EVERY turn, through the same `permission-checker` path every tool uses.
 * It adds no tool, removes no check, pre-authorizes no read, and changes no write path. A focus is
 * a pointer, not a key (FR-017, FR-034).
 *
 * A TURN NEVER FAILS ON A BAD FOCUS (FR-019). An entry that was deleted, a content type that was
 * removed, a locale version that was never created, an account whose permissions no longer include
 * it, a `focus` column holding something this build does not recognise — every one of those resolves
 * to a state the situation block can describe, and the turn proceeds.
 *
 * The pure core is separated from the Strapi-facing wrapper for the reason `grounding.ts` separates
 * its own: normalization and rendering are where the totality guarantee lives, and they must be
 * drivable across their whole range without a host.
 */

/* ------------------------------------------------------------------ the pure core */

/** How much of an editor-written label may reach the prompt or the panel. */
const MAX_LABEL_CHARS = 120;

/**
 * Flatten and bound one editor-written label.
 *
 * ⚠ THE NEWLINE COLLAPSE IS NOT COSMETIC. The label is the ONLY entry-derived text in the situation
 * block, and that block's grammar is one fact per line — so a title containing a newline could write
 * a line of its own and forge a fact the server never stated. That is the cheapest possible
 * injection into a line-delimited block, and it is closed HERE, at the point the label is derived,
 * rather than at each of the places a label is later rendered: the prompt, the picker, the Focus bar
 * and the route response all get the guarantee by construction.
 *
 * The "data, not instruction" clause in the block's preamble is the rule; this is the structure.
 * Length is bounded for a different reason: an unbounded title could crowd out the rest of the
 * prompt.
 */
const flattenLabel = (raw: string): string => {
  const flat = raw.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_LABEL_CHARS ? `${flat.slice(0, MAX_LABEL_CHARS)}…` : flat;
};

/**
 * The display-label ladder, and it is DELIBERATELY THE ONE `describePageStructure` ALREADY USES.
 *
 * A second ladder would mean the label in the Focus bar and the label in a tool result could differ
 * for the same entry, which reads to an editor as the assistant looking at something else.
 */
export const LABEL_FIELDS = ['title', 'name', 'heading', 'label', 'slug'] as const;

/**
 * Derive a display label from a document, falling back to the content type's display name.
 *
 * TOTAL: a document with none of those fields, or no document at all, still yields a usable label
 * rather than an empty string that would render as a blank chip.
 */
export const deriveLabel = (doc: unknown, displayName: string): string => {
  const record = (doc ?? {}) as Record<string, unknown>;
  const found = LABEL_FIELDS.map((field) => record[field]).find(
    (value) => typeof value === 'string' && value.trim() !== ''
  );
  return flattenLabel(typeof found === 'string' ? found : displayName);
};

/**
 * Read a stored `focus` column back into a `ThreadFocus`, or null.
 *
 * ⚠ TOTAL BY CONSTRUCTION, AND THAT IS A REQUIREMENT RATHER THAN DEFENSIVENESS (FR-019). This reads
 * a JSON column that may have been written by a different build, hand-edited, or left holding
 * something else entirely. A throw here would fail a chat turn over a stored pointer — the one
 * outcome the four-state ladder exists to prevent. So every malformed shape reads back as null,
 * which resolves to `none`, which is a legal state the assistant can describe.
 *
 * `uid` is the only field that MUST be present and a non-empty string: without it there is nothing
 * to re-check permissions against, and a focus that cannot be permission-checked must not exist.
 */
export const normalizeFocus = (raw: unknown): ThreadFocus | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const uid = typeof value.uid === 'string' ? value.uid.trim() : '';
  if (uid === '') {
    return null;
  }
  const str = (input: unknown): string | null =>
    typeof input === 'string' && input.trim() !== '' ? input.trim() : null;

  return {
    uid,
    documentId: str(value.documentId),
    locale: str(value.locale),
    /*
     * A stored focus with no label is legal — the label is a display convenience, and an empty one
     * renders as the uid rather than as a blank.
     *
     * Flattened on READ as well as on write, because a column written by a different build (or by
     * hand) is exactly the path a multi-line label would arrive by.
     */
    label: flattenLabel(str(value.label) ?? uid),
    setAt: str(value.setAt) ?? '',
  };
};

/**
 * Render the focus line for the situation block (contracts/situation-and-focus.md §3).
 *
 * ⚠ THE `unreadable` BRANCH IS THE LOAD-BEARING ONE (FR-017, SC-008). It renders NO label, NO
 * documentId and NO uid — an account whose permissions exclude the focused entry must learn that it
 * lacks the permission and NOTHING about the entry. The uid itself is withheld too: a content-type
 * identifier is information about what exists in this project, and an account that cannot read it
 * has not been told it exists.
 */
export const renderFocusLine = (resolution: FocusResolution): string => {
  switch (resolution.state) {
    case 'set': {
      const { focus } = resolution;
      const parts = [`focus: ${focus.uid}`, `"${focus.label}"`];
      if (focus.documentId) {
        parts.push(`documentId ${focus.documentId}`);
      }
      if (focus.locale) {
        parts.push(`language version ${focus.locale}`);
      }
      return parts.join(' - ');
    }
    case 'unreadable':
      return 'focus: a focus is set, but this account may not read it. Report the permission denial and say nothing about the entry.';
    case 'missing':
      return 'focus: the focused entry no longer exists. Say so and ask the editor to set a new focus.';
    case 'none':
      return 'focus: none is set. If the editor says "this page" or similar, ASK which entry they mean and list candidates - never guess.';
    default:
      return 'focus: none is set.';
  }
};

/* ---------------------------------------------------------------- the service */

const focusService = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ai-content-studio');
  const localesSvc = () => plugin().service('locales');

  const ctOf = (uid: string): any => (strapi.contentTypes as Record<string, any>)[uid];
  const allowedUids = (): string[] =>
    Object.keys(strapi.contentTypes).filter((uid) => uid.startsWith('api::'));

  const service = {
    normalizeFocus,
    deriveLabel,
    renderFocusLine,

    /** The display name for a uid, for labels and the picker. */
    displayNameOf(uid: string): string {
      return ctOf(uid)?.info?.displayName ?? uid;
    },

    /** Whether a uid is one this plugin may ever touch. Checked on WRITE and again on every READ. */
    isAllowed(uid: string): boolean {
      return allowedUids().includes(uid);
    },

    /**
     * Can THIS caller read that content type, right now?
     *
     * The same `permission-checker` path every tool uses, re-derived per call and never cached
     * across users. This is the whole of "focus grants nothing".
     */
    canRead(uid: string, userAbility: unknown): boolean {
      try {
        const checker = strapi
          .plugin('content-manager')
          .service('permission-checker')
          .create({ userAbility, model: uid });
        return Boolean(checker.can.read());
      } catch {
        // A checker that cannot be built is not permission to proceed.
        return false;
      }
    },

    /**
     * Resolve a stored focus into one of the four states, for THIS caller, on THIS turn.
     *
     * Order is the contract, and each step is a different fact:
     *   1. nothing stored, or stored nonsense -> `none`;
     *   2. the content type no longer exists -> `missing` (the type was removed, not the entry);
     *   3. the caller may not read it -> `unreadable`, carrying nothing;
     *   4. the document or its locale version is gone -> `missing`;
     *   5. otherwise `set`, with the label REFRESHED from the live document.
     *
     * Step 3 must come before step 4: checking existence first and reporting `missing` for an entry
     * the caller cannot read would leak whether it exists.
     */
    async resolve(rawFocus: unknown, userAbility: unknown): Promise<FocusResolution> {
      const focus = normalizeFocus(rawFocus);
      if (!focus) {
        return { state: 'none' };
      }
      if (!service.isAllowed(focus.uid)) {
        return { state: 'missing' };
      }
      if (!service.canRead(focus.uid, userAbility)) {
        return { state: 'unreadable' };
      }

      const isSingle = ctOf(focus.uid)?.kind === 'singleType';
      let doc: any = null;
      try {
        const docs = strapi.documents(focus.uid as never) as any;
        // The locale is passed only where it was recorded, so a non-localized type behaves exactly
        // as it did before language versions existed.
        const scope = focus.locale ? { locale: focus.locale } : {};
        doc = isSingle
          ? await docs.findFirst({ ...scope })
          : focus.documentId
            ? await docs.findOne({ documentId: focus.documentId, ...scope })
            : null;
      } catch {
        // A read that throws is indistinguishable, from the editor's side, from an entry that is
        // gone — and either way the turn proceeds.
        doc = null;
      }

      if (!doc) {
        /*
         * FR-044: a focused LANGUAGE VERSION that does not exist is `missing`, and the assistant
         * says that version does not exist rather than answering from another one. That is why the
         * locale is part of the read rather than applied afterwards.
         */
        return { state: 'missing' };
      }

      return {
        state: 'set',
        focus: {
          ...focus,
          // Refreshed from the live document: a stored label is a snapshot, and an entry retitled
          // since it was focused should show its current title.
          label: deriveLabel(doc, service.displayNameOf(focus.uid)),
        },
      };
    },

    /**
     * Build a `ThreadFocus` for a validated set request. Callers must have already checked the
     * allow-list and the caller's `can.read` — this only shapes the record.
     */
    async build({
      uid,
      documentId,
      locale,
      doc,
    }: {
      uid: string;
      documentId: string | null;
      locale: string | null;
      doc: unknown;
    }): Promise<ThreadFocus> {
      // A locale is recorded only where the content type actually holds language versions, so a
      // single-locale install stores exactly what it stored before (FR-042).
      const keepsLocale = localesSvc().isLocalized(uid);
      return {
        uid,
        documentId,
        locale: keepsLocale ? locale : null,
        label: deriveLabel(doc, service.displayNameOf(uid)),
        setAt: new Date().toISOString(),
      };
    },
  };

  return service;
};

export default focusService;
