import { createHash } from 'node:crypto';
import { contentTypes as ctUtils } from '@strapi/utils';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { Core } from '@strapi/strapi';
import { UID } from '../content-types';
import type {
  BriefCoverage,
  BriefDepth,
  BriefIndexEntry,
  BriefRun,
  BriefSection,
  PageReading,
  PageReadingFailure,
} from '../types';

/**
 * The content brief: a human-readable account of what this project's content actually IS, written
 * once by the model against real entries and shared by every account (contracts/content-brief.md).
 *
 * WHY THIS EXISTS ALONGSIDE `grounding.ts` RATHER THAN INSIDE IT. The install description is
 * deterministic, derived only from the schema, and free — it answers "what fields exist". It cannot
 * answer "what is this site, what do these entries mean, how is this project actually using these
 * types", because nothing in a schema carries that. The brief answers exactly that, and it pays for
 * it with the three properties the install description refuses to give up: it reads content, it
 * costs provider calls, and it is not deterministic. Folding the two together would have forced the
 * install description to surrender its own guarantees, so they stay separate sources an
 * administrator chooses between (`schema` / `brief` / `both`).
 *
 * ONE BRIEF, THE SAME FOR EVERY ACCOUNT — the stated product decision.
 *
 * A super-admin runs it once, and every account with chat access is given the SAME text, including
 * the project overview. The brief is a shared description of the platform, not a per-reader view of
 * it, and two colleagues discussing the assistant's answers should not be looking at different
 * briefings.
 *
 * This does not weaken Principle II, and the distinction matters enough to state precisely. That
 * principle governs what the assistant can DO: every tool still validates its uid against a live
 * allow-list and still RBAC-checks the CALLER before touching the Document Service, and the apply
 * path is still the only write path. None of that changes. What changes is what the assistant KNOWS
 * about the shape of the project — orientation, of the kind a colleague would give a new starter.
 *
 * It is nonetheless a real disclosure, so it is bounded and it is stated plainly:
 *   - the walk uses the RUNNER's ability, so the brief can never describe a content type the
 *     super-admin who ran it could not read;
 *   - the settings page says, above the button, exactly who will be able to read the result;
 *   - `contentBrief.scopeToReader` restores per-reader filtering for installs that need it
 *     (compliance, multi-tenant, a content type only one team may know about). Off by default.
 *
 * WHAT NEVER REACHES THE STORED TEXT:
 *   - verbatim personal data. The generation prompt forbids it and the sampler truncates hard, but
 *     the real guarantee is that the brief describes PATTERNS, and a pattern is not a record.
 *   - anything the run's own operator could not read (above).
 *   - a provider error. Failures are stored through `redact.describeError` (Principle I).
 */

/** Hard ceiling on one sampled field, so a single long body cannot dominate the model's input. */
const MAX_FIELD_CHARS = 400;

/** Hard ceiling on the characters of sampled content handed to the model for ONE content type. */
const MAX_SAMPLE_CHARS = 24000;

/**
 * A run is considered abandoned after this long, so a process that died mid-run cannot hold the
 * lock forever. It is generous: a `deep` run over a large install is legitimately slow.
 */
const RUN_LOCK_STALE_MINUTES = 30;

/**
 * Below this fraction of a content type read, a section is labelled WEAK (005 FR-013).
 *
 * DECLARED IN ONE PLACE, WITH ITS REASONING, AND WITH NO CONFIG KEY. The constitution requires the
 * simpler option absent a concrete stated need, and no requirement asks for per-install tuning of
 * it — a second knob here would be a setting nobody could choose well, because the number that
 * matters is not the ratio but whether a reader was misled.
 *
 * WHY A TENTH. The shipped sampling depths are 5 / 15 / 50 entries, so this marks a section weak
 * once the content type is more than ten times its sample: a `deep` run stays unlabelled up to 500
 * entries, and the case the feature was reported for — 4 entries out of 9,000 — is weak by three
 * orders of magnitude. Setting it higher would label ordinary well-sampled sections and train
 * everyone to ignore the label, which is the failure mode a warning has.
 */
export const WEAK_COVERAGE_RATIO = 0.1;

/**
 * Is this section's evidence weak? PURE, and exported so the suite can drive the whole matrix.
 *
 * WEAK IS LABELLED, NEVER WITHHELD (FR-013). Withholding would leave the assistant with no basis at
 * all and no way to say why, which is worse than a labelled weak section and is exactly what
 * "rather than withheld silently or returned flat" rules out.
 *
 * `totalCount: 0` is weak because the content type is now EMPTY: whatever the section says, it
 * describes entries that are no longer there. That is a different fact from a low ratio, and it is
 * the one most likely to make an answer confidently wrong.
 */
export const isWeakCoverage = ({
  sampledCount,
  totalCount,
  stale,
}: {
  sampledCount: number;
  totalCount: number;
  stale: boolean;
}): boolean => {
  if (stale) {
    return true;
  }
  if (totalCount <= 0) {
    return true;
  }
  return sampledCount / totalCount < WEAK_COVERAGE_RATIO;
};

/**
 * The derived coverage view both surfaces use — the index ahead of a retrieval, and the retrieval
 * result itself (FR-009). PURE: `stale` is resolved by the caller, which is the only part that
 * needs a database.
 */
export const deriveCoverage = (section: BriefSection, stale: boolean): BriefCoverage => ({
  sampledCount: section.sampledCount,
  totalCount: section.totalCount,
  locale: section.locale,
  generatedAt: section.generatedAt,
  stale,
  weak: isWeakCoverage({
    sampledCount: section.sampledCount,
    totalCount: section.totalCount,
    stale,
  }),
  pageInformed: section.pageInformed,
});

/**
 * Render one index line: NAMES AND NUMBERS ONLY (FR-032).
 *
 * THE INVARIANT IS THE WHOLE FUNCTION. Not one character of `section.text` may reach here. A line
 * of prose would quietly restore the ambient claims FR-031 removed and make the index a second copy
 * of the briefing — which is why this takes a `BriefIndexEntry`, a type that has no prose in it, and
 * not a `BriefSection`.
 */
export const renderIndexLine = (entry: BriefIndexEntry): string => {
  const { coverage } = entry;
  const parts = [
    entry.uid,
    `"${entry.displayName}"`,
    `${coverage.sampledCount} of ${coverage.totalCount} entries`,
  ];
  // Null means "written before language versions were tracked", so the line says nothing rather
  // than implying the counts cover every version.
  if (coverage.locale) {
    parts.push(coverage.locale);
  }
  parts.push(coverage.generatedAt.slice(0, 10));
  parts.push(coverage.stale ? 'OUT OF DATE' : 'current');
  if (coverage.weak && !coverage.stale) {
    parts.push('WEAK COVERAGE');
  }
  if (coverage.pageInformed) {
    parts.push('page-informed');
  }
  return parts.join(' - ');
};

const sha256 = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const byBytes = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The text of a chat-model reply, whichever shape the provider returned it in.
 *
 * `content` is a string on some providers and an array of typed content blocks on others, so
 * reading `.content` directly would silently produce "[object Object]" on half the catalogue.
 */
const textOf = (reply: unknown): string => {
  const content = (reply as { content?: unknown })?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
      .map((part: any) => part.text)
      .join('');
  }
  return '';
};

/**
 * The instruction the brief is written under.
 *
 * NEUTRAL BY THE SAME RULE `prompt.ts` FOLLOWS: it names no consuming project and hard-codes no
 * field. It asks for prose because prose is the entire point of the feature — a serialized entry
 * dump is what the tools already return on demand, and what this was asked to stop being.
 */
const SECTION_SYSTEM_PROMPT = `You are documenting one content type of a Strapi project for a colleague who has never seen it.

You are given the content type's schema and a sample of its real entries. Write a SHORT briefing —
plain prose, 2 to 5 sentences, no headings, no bullet lists, no JSON, no code fences.

Cover, in your own words and only where the sample actually supports it:
- what this content type is FOR in this project, in plain language;
- how it is actually used in practice: roughly how many entries, whether they are short or long,
  which fields carry the real substance and which are usually empty;
- any convention a colleague would otherwise have to discover the hard way (naming or slug patterns,
  how sections or components are typically composed, a field used for something its name does not
  suggest).

Rules:
- Describe PATTERNS, never individual records. Do not reproduce personal data, email addresses,
  phone numbers, credentials or long verbatim passages from any entry.
- Say only what the sample supports. If the sample is small or the entries are mostly empty, say so
  plainly rather than generalizing.
- Do not restate the field list — the schema is already available separately. Add meaning, not a
  second copy of the structure.
- Write in English, in the third person, with no preamble and no sign-off.`;

/**
 * Appended to the section prompt ONLY when a rendered page was read (005 contracts/page-reading.md
 * §4.1).
 *
 * WHAT THE PAGE ADDS THAT THE SCHEMA AND THE ENTRIES CANNOT. A schema says a `page` has a `hero`
 * with an `image`; a sample says the image is usually populated. Neither can say the page is a
 * marketing landing page, that the hero is its lead region, or that the component named `block-c` is
 * the testimonial carousel. That meaning exists only in the rendered output.
 *
 * The prohibitions are repeated rather than assumed inherited, because this input is the one that
 * carries a real person's words: a page is written for readers, and the entries behind it were not.
 */
const PAGE_READING_CLAUSE = `

You are ALSO given a reading of one entry's published page, as text: its title, its main regions in
document order, and its readable text. Use it to say:
- what the page is FOR, as a reader would experience it;
- how its main regions are arranged, and what kind of content each one carries.

Rules for the page reading, and they are not optional:
- Describe PATTERNS, never records. What this KIND of page is for, not what this one page says.
- Reproduce NO personal data — no person's name, no contact detail — and NO verbatim passage from
  the page. If you would be quoting, describe instead.
- The reading is ONE page of possibly many. Do not generalize beyond what its structure supports,
  and do not state its particular content as a fact about the content type.`;

/**
 * The whole-platform paragraph.
 *
 * This is the part that answers "what IS this project", which is the question a per-content-type
 * section cannot reach: a section knows its own type and nothing about how the types relate. It is
 * written from the finished sections rather than from a second pass over content — the sections
 * already contain everything a summary could draw on, and re-reading entries would double the cost
 * of a run to restate what was just established.
 */
const OVERVIEW_SYSTEM_PROMPT = `You are writing the opening paragraph of a briefing about a Strapi project, for a colleague who has never seen it.

You are given short briefings about each of the project's content types. From them, write 3 to 6
sentences of plain prose — no headings, no bullet lists, no JSON — covering:
- what this project appears to BE (a marketing site, a documentation portal, a shop, a publication,
  an internal tool — say which, and say it plainly);
- how its main content types relate to each other, and which ones carry the substance;
- anything that characterises how this particular team works with it.

Rules:
- Infer only from the briefings you were given. If they do not support a conclusion, leave it out
  rather than guessing at the project's purpose.
- Describe PATTERNS, never individual records, and reproduce no personal data.
- Do not list the content types back — the list follows this paragraph already. Say what they add up
  to.
- Write in English, in the third person, with no preamble and no sign-off.`;

const contentBriefService = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ai-content-studio');
  const configSvc = () => plugin().service('config');
  const redact = () => plugin().service('redact');
  const grounding = () => plugin().service('grounding');
  const localesSvc = () => plugin().service('locales');

  /** In-process guard. The store record is the cross-process one; this stops a same-process race. */
  let running = false;

  /** See `staleness` for why this exists and why a TTL is the right key for it. */
  let stalenessCache: { at: number; value: { stale: string[]; missing: string[] } } | null = null;
  const STALENESS_TTL_MS = 30_000;
  const invalidateStaleness = () => {
    stalenessCache = null;
  };

  const docs = (uid: string): any => strapi.documents(uid as any);

  const apiUids = (): string[] =>
    Object.keys(strapi.contentTypes)
      .filter((uid) => uid.startsWith('api::'))
      .sort(byBytes);

  const schemaOf = (uid: string): any => (strapi.contentTypes as Record<string, any>)[uid];

  const isSingle = (uid: string): boolean => ctUtils.isSingleType(schemaOf(uid) as never);

  const truncate = (value: unknown): unknown => {
    if (typeof value !== 'string') {
      return value;
    }
    return value.length > MAX_FIELD_CHARS
      ? `${value.slice(0, MAX_FIELD_CHARS)}… [+${value.length - MAX_FIELD_CHARS} chars]`
      : value;
  };

  /**
   * One entry, reduced to what a briefing can be written from.
   *
   * Strapi's own visibility predicates decide what is included, so private and non-visible
   * attributes never reach the model — the same rule `grounding.ts` applies to field NAMES, applied
   * here to field VALUES, where it matters more.
   */
  const compactEntry = (uid: string, entry: any): Record<string, unknown> => {
    if (!entry || typeof entry !== 'object') {
      return {};
    }
    const schema = schemaOf(uid);
    const visible: string[] = ctUtils.getVisibleAttributes(schema as never) ?? [];
    const excluded = new Set<string>([
      ...((ctUtils.getPrivateAttributes(schema as never) ?? []) as string[]),
      ...((ctUtils.getCreatorFields(schema as never) ?? []) as string[]),
    ]);
    const out: Record<string, unknown> = {};
    for (const name of visible) {
      if (excluded.has(name) || !(name in entry)) {
        continue;
      }
      const value = entry[name];
      if (value === null || value === undefined) {
        continue;
      }
      if (Array.isArray(value)) {
        // Component lists and dynamic zones: the SHAPE is what matters, not every nested value.
        out[name] = `[${value.length} item(s)${
          value[0]?.__component ? `: ${value.map((v: any) => v.__component ?? '?').join(', ')}` : ''
        }]`;
        continue;
      }
      if (typeof value === 'object') {
        out[name] = (value as any).name ?? (value as any).documentId ?? '[object]';
        continue;
      }
      out[name] = truncate(value);
    }
    return out;
  };

  const service = {
    /* --------------------------------------------------------------- fingerprints */

    /**
     * A cheap staleness signal for one content type: how many entries it has and when the newest
     * one changed.
     *
     * DELIBERATELY NOT A HASH OF THE CONTENT. Hashing every entry would cost a full scan on every
     * chat turn to answer a question — "might this be out of date?" — that a count and a high-water
     * mark answer well enough. It misses an edit that changes no `updatedAt`, which Strapi does not
     * do, and it misses a delete-plus-create that nets to the same count in the same instant, which
     * is not worth a table scan per turn.
     */
    async contentFingerprint(uid: string): Promise<string> {
      try {
        const total = isSingle(uid) ? 1 : await docs(uid).count({});
        const newest = await docs(uid).findMany({
          sort: 'updatedAt:desc',
          limit: 1,
          fields: ['updatedAt'],
        });
        const latest = Array.isArray(newest) ? (newest[0] as any)?.updatedAt ?? null : null;
        return sha256({ total, latest });
      } catch (err) {
        strapi.log.warn(
          `[ai-content-studio] could not fingerprint ${uid}: ${redact().describeError(err)}`
        );
        return sha256({ error: true, uid });
      }
    },

    /* ------------------------------------------------------------------ the walk */

    /**
     * Sample entries for one content type, from BOTH ENDS of the update order.
     *
     * Taking only the newest would describe a project by its most recent burst of work, which is
     * precisely the period least representative of the whole. Half newest and half oldest shows the
     * assistant what the project has settled into as well as what it is doing now.
     */
    async sample(
      uid: string,
      limit: number
    ): Promise<{ entries: unknown[]; total: number; locale: string | null }> {
      /**
       * ONE LANGUAGE VERSION, NOT ALL OF THEM (005 FR-040, SC-016).
       *
       * Before this, a run counted and sampled every translation of every entry, so `totalCount`
       * was multiplied by the number of locales: "4 of 9,000" on a three-language install is 4 of
       * 3,000 entries, and a coverage figure that means neither is worse than no figure at all. The
       * run now reads the install's DEFAULT locale and records which one it read.
       *
       * Null on a content type that is not localized, or an install with no i18n — in which case
       * the parameter is omitted entirely and the Document Service behaves exactly as before.
       */
      const localized = localesSvc().isLocalized(uid);
      const locale = localized ? (await localesSvc().facts()).defaultLocale : null;
      const scope = locale ? { locale } : {};

      if (isSingle(uid)) {
        const one = await docs(uid).findFirst({ populate: '*', ...scope });
        return { entries: one ? [compactEntry(uid, one)] : [], total: one ? 1 : 0, locale };
      }

      const total = await docs(uid).count({ ...scope });
      const half = Math.max(1, Math.floor(limit / 2));
      const newest = await docs(uid).findMany({
        sort: 'updatedAt:desc',
        limit: half,
        populate: '*',
        ...scope,
      });
      const oldest =
        total > half
          ? await docs(uid).findMany({
              sort: 'updatedAt:asc',
              limit: Math.min(half, total - half),
              populate: '*',
              ...scope,
            })
          : [];

      const seen = new Set<string>();
      const entries: unknown[] = [];
      for (const entry of [...(newest ?? []), ...(oldest ?? [])]) {
        const id = (entry as any)?.documentId;
        if (id && seen.has(id)) {
          continue;
        }
        if (id) {
          seen.add(id);
        }
        entries.push(compactEntry(uid, entry));
      }
      return { entries, total, locale };
    },

    /* -------------------------------------------------------------- generation */

    /**
     * Write one content type's section. Returns null when the model produced nothing usable, so a
     * single bad section never fails a whole run.
     */
    async generateSection(
      uid: string,
      depth: BriefDepth,
      model: any,
      providerId: string,
      modelId: string,
      /**
       * Passed IN rather than computed here, and that is not a micro-optimization: the fingerprint
       * hashes the WHOLE schema, so computing it per section would hash every content type once per
       * content type. On a large install that is quadratic work inside the slowest loop in the
       * plugin. The run computes it once.
       */
      schemaFingerprint: string,
      signal?: AbortSignal,
      /**
       * Where a page-reading failure is recorded, so the settings page can show which content types
       * fell back and why (FR-023, SC-012). Passed IN rather than written here, because the record
       * belongs to the RUN and a section does not know whether it is part of one.
       */
      onPageReadingFailure?: (reason: PageReadingFailure) => void
    ): Promise<BriefSection | null> {
      const limit = configSvc().briefSampleSize(depth);
      const { entries, total, locale } = await service.sample(uid, limit);
      const schema = schemaOf(uid);
      const displayName = schema?.info?.displayName ?? uid;

      let payload = JSON.stringify({ entries }, null, 1);
      if (payload.length > MAX_SAMPLE_CHARS) {
        payload = `${payload.slice(0, MAX_SAMPLE_CHARS)}\n… [sample truncated to fit]`;
      }

      const fieldSummary = (ctUtils.getVisibleAttributes(schema as never) ?? [])
        .map((name: string) => `${name}: ${schema?.attributes?.[name]?.type ?? 'unknown'}`)
        .join(', ');

      /**
       * Rendered-page grounding (005 FR-020..FR-026), where the capability is on and the content
       * type already has a preview target.
       *
       * ⚠ IT ADDS NO MODEL CALL. The reading is extra INPUT to the section call that was already
       * counted — which is exactly what makes the cost stated in Settings before the run checkable
       * (SC-011), and why it is bounded inside the briefing's existing budgets rather than alongside
       * them.
       *
       * ⚠ THE READING IS NEVER PERSISTED. It reaches the model here and is then gone; only the
       * model's prose reaches a row. That absence is the mechanism behind FR-025.
       *
       * EVERY FAILURE DEGRADES THE SECTION TO ENTRY-ONLY and is recorded. It must never fail the
       * section, the run, or a chat turn (FR-023).
       */
      let reading: PageReading | null = null;
      try {
        const first = entries[0] as Record<string, unknown> | undefined;
        const result = await plugin().service('page-reading').read(uid, first ?? null, locale);
        if (result.ok) {
          reading = result.reading;
        } else if (result.reason !== 'not_configured') {
          /*
           * `not_configured` is not a degradation worth reporting: it means this content type has no
           * preview target, or the capability is off. Recording it would fill the operator's list
           * with content types that were never eligible and bury the ones that actually failed.
           */
          onPageReadingFailure?.(result.reason);
        }
      } catch (err) {
        // A throw from the reader is still just a fallback to an entry-only section.
        strapi.log.warn(
          `[ai-content-studio] page reading failed for ${uid}: ${redact().describeError(err)}`
        );
        onPageReadingFailure?.('unreachable');
      }

      const human = [
        `Content type: ${uid} — "${displayName}" (${isSingle(uid) ? 'single type' : 'collection type'})`,
        `Fields: ${fieldSummary || '(none)'}`,
        `Total entries in this project: ${total}. Entries sampled below: ${entries.length}.`,
        locale ? `Language version read: ${locale}.` : null,
        '',
        'Sample:',
        payload,
        ...(reading
          ? ['', 'Rendered page reading:', plugin().service('page-reading').renderReading(reading)]
          : []),
      ]
        .filter((line) => line !== null)
        .join('\n');

      const { maxSectionChars } = configSvc().getContentBriefOptions();

      const reply = await model.invoke(
        [
          new SystemMessage(reading ? `${SECTION_SYSTEM_PROMPT}${PAGE_READING_CLAUSE}` : SECTION_SYSTEM_PROMPT),
          new HumanMessage(human),
        ],
        signal ? { signal } : {}
      );

      const text = textOf(reply).trim();
      if (!text) {
        return null;
      }

      return {
        uid,
        text: text.length > maxSectionChars ? `${text.slice(0, maxSectionChars)}…` : text,
        /*
         * ⚠ THE FINGERPRINTS DELIBERATELY DO NOT FOLD IN `locale` (005 research D8).
         *
         * Folding it in would mark EVERY STORED SECTION STALE the moment this code ships — and with
         * `contentBrief.autoRefresh` on by default, that is an upgrade spending provider money
         * nobody asked for, straight through FR-027. `locale` is additive metadata instead: a
         * pre-upgrade section reads back with `locale: null`, its coverage says so honestly, and the
         * next deliberate run fixes it.
         */
        schemaFingerprint,
        contentFingerprint: await service.contentFingerprint(uid),
        sampledCount: entries.length,
        totalCount: total,
        generatedAt: new Date().toISOString(),
        provider: providerId,
        model: modelId,
        locale,
        /*
         * FR-026: the section RECORDS that a page informed it, and which page, so an operator can
         * tell the two kinds of section apart and re-run one without the other. These are the only
         * things about the reading that survive it.
         */
        pageInformed: reading !== null,
        pageUrl: reading?.url ?? null,
        pageLocale: reading?.locale ?? null,
      };
    },

    /**
     * Write the whole-platform paragraph from the sections a run just produced.
     *
     * Returns null rather than throwing: a run that produced good sections but no overview is a
     * usable brief, and failing the whole run over its opening paragraph would be the wrong trade.
     */
    async generateOverview(
      sections: BriefSection[],
      model: any,
      signal?: AbortSignal
    ): Promise<string | null> {
      if (sections.length === 0) {
        return null;
      }
      const { maxSectionChars } = configSvc().getContentBriefOptions();
      const digest = sections
        .map((section) => {
          const schema = schemaOf(section.uid);
          const displayName = schema?.info?.displayName ?? section.uid;
          return `${section.uid} — "${displayName}" (${section.totalCount} entries): ${section.text}`;
        })
        .join('\n\n');

      try {
        const reply = await model.invoke(
          [
            new SystemMessage(OVERVIEW_SYSTEM_PROMPT),
            new HumanMessage(
              digest.length > MAX_SAMPLE_CHARS
                ? `${digest.slice(0, MAX_SAMPLE_CHARS)}\n… [further content types omitted to fit]`
                : digest
            ),
          ],
          signal ? { signal } : {}
        );
        const text = textOf(reply).trim();
        if (!text) {
          return null;
        }
        // The overview shares the per-section ceiling: it is one paragraph, not a preamble that can
        // grow to crowd out the sections it introduces.
        return text.length > maxSectionChars ? `${text.slice(0, maxSectionChars)}…` : text;
      } catch (err) {
        strapi.log.warn(
          `[ai-content-studio] brief overview failed: ${redact().describeError(err)}`
        );
        return null;
      }
    },

    /* ----------------------------------------------------------------- storage */

    async storedSections(): Promise<BriefSection[]> {
      const rows = await docs(UID.contentBrief).findMany({ limit: 1000 });
      return (Array.isArray(rows) ? rows : []).map((row: any) => ({
        uid: row.uid,
        text: row.text,
        schemaFingerprint: row.schemaFingerprint,
        contentFingerprint: row.contentFingerprint,
        sampledCount: row.sampledCount ?? 0,
        totalCount: row.totalCount ?? 0,
        generatedAt: row.generatedAt,
        provider: row.provider ?? null,
        model: row.model ?? null,
        /*
         * A ROW WRITTEN BY AN OLDER BUILD READS BACK HONESTLY (005 data-model §4.1). `locale: null`
         * says "written before language versions were tracked" — which is true, and is deliberately
         * NOT the same claim as "all of them". `pageInformed: false` is likewise the honest value
         * for a section written before pages could be read.
         */
        locale: row.locale ?? null,
        pageInformed: row.pageInformed === true,
        pageUrl: row.pageUrl ?? null,
        pageLocale: row.pageLocale ?? null,
      }));
    },

    /** Upsert one section by uid — a regenerated section replaces, never duplicates. */
    async saveSection(section: BriefSection): Promise<void> {
      const existing = await docs(UID.contentBrief).findMany({
        filters: { uid: section.uid },
        limit: 1,
      });
      const found = Array.isArray(existing) ? existing[0] : null;
      if (found) {
        await docs(UID.contentBrief).update({ documentId: (found as any).documentId, data: section });
        return;
      }
      await docs(UID.contentBrief).create({ data: section });
    },

    /** Drop sections for content types that no longer exist, so a removed type cannot linger. */
    async pruneSections(): Promise<number> {
      const live = new Set(apiUids());
      const sections = await service.storedSections();
      let removed = 0;
      for (const section of sections) {
        if (live.has(section.uid)) {
          continue;
        }
        const rows = await docs(UID.contentBrief).findMany({
          filters: { uid: section.uid },
          limit: 1,
        });
        const found = Array.isArray(rows) ? rows[0] : null;
        if (found) {
          await docs(UID.contentBrief).delete({ documentId: (found as any).documentId });
          removed += 1;
        }
      }
      return removed;
    },

    /* --------------------------------------------------------------- staleness */

    /**
     * Which stored sections no longer match the live schema or content, plus which content types
     * have no section at all. Both are "needs generating"; they are reported apart so the settings
     * page can say which.
     *
     * ⚠ CACHED, AND THE CACHE IS NOT OPTIONAL. This walks every content type and issues a count
     * plus a one-row lookup for each, so it is O(content types) database round trips. The settings
     * page polls `status` every three seconds while a run is in progress, which without a cache
     * would put a few hundred queries per poll onto an install that is already busy generating.
     *
     * A short TTL is the right cache here rather than a fingerprint key, because the thing being
     * cached IS the freshness check — there is no cheaper key that would not itself be the query.
     * Staleness is a hint that drives a "re-run?" prompt, so being up to thirty seconds behind
     * costs nothing, and a run invalidates it explicitly on the way out.
     */
    async staleness(): Promise<{ stale: string[]; missing: string[] }> {
      if (stalenessCache && Date.now() - stalenessCache.at < STALENESS_TTL_MS) {
        return stalenessCache.value;
      }
      const value = await service.computeStaleness();
      stalenessCache = { at: Date.now(), value };
      return value;
    },

    /** The uncached walk. Public so a run can force a fresh read after it finishes. */
    async computeStaleness(): Promise<{ stale: string[]; missing: string[] }> {
      const sections = new Map((await service.storedSections()).map((s) => [s.uid, s]));
      const schemaFingerprint = grounding().schemaFingerprint();
      const stale: string[] = [];
      const missing: string[] = [];

      for (const uid of apiUids()) {
        const section = sections.get(uid);
        if (!section) {
          missing.push(uid);
          continue;
        }
        if (section.schemaFingerprint !== schemaFingerprint) {
          stale.push(uid);
          continue;
        }
        if ((await service.contentFingerprint(uid)) !== section.contentFingerprint) {
          stale.push(uid);
        }
      }
      return { stale, missing };
    },

    /* ------------------------------------------------------------------- the run */

    /**
     * Start a full run in the BACKGROUND and return immediately.
     *
     * A `deep` run over a large install is minutes of sequential provider calls, which no HTTP
     * request should hold open — so the route starts it, the store carries the progress, and the
     * settings page polls. The run is never awaited by a request handler.
     */
    async startRun({
      userAbility,
      userId,
      depth,
      uids,
    }: {
      userAbility: unknown;
      userId: number;
      depth: BriefDepth;
      /** Restrict the run to these uids. Omitted, every readable content type is regenerated. */
      uids?: string[];
    }): Promise<{ ok: true; total: number } | { ok: false; error: string; message: string }> {
      const options = configSvc().getContentBriefOptions();
      if (!options.enabled) {
        return {
          ok: false,
          error: 'disabled',
          message: 'The content brief is turned off for this deployment by plugin configuration.',
        };
      }

      const current = await configSvc().getBriefRun();
      if (running || service.isRunActive(current)) {
        return {
          ok: false,
          error: 'already_running',
          message: 'A brief run is already in progress.',
        };
      }

      // The RUNNER's ability decides what may be walked, so a run can never read past the account
      // that started it (Principle II).
      const readable: string[] = grounding().readableUids(userAbility);
      const targets = (uids ? readable.filter((uid) => uids.includes(uid)) : readable).sort(byBytes);
      if (targets.length === 0) {
        return {
          ok: false,
          error: 'nothing_readable',
          message: 'Your account cannot read any content type, so there is nothing to describe.',
        };
      }

      let active;
      try {
        active = await plugin().service('registry').getActiveModel();
      } catch (err) {
        return {
          ok: false,
          error: 'provider',
          message: redact().describeError(err),
        };
      }

      running = true;
      await configSvc().setBriefRun({
        state: 'running',
        depth,
        startedAt: new Date().toISOString(),
        completedAt: null,
        currentUid: targets[0],
        doneCount: 0,
        totalCount: targets.length,
        error: null,
        lastRunByUserId: userId,
      });

      // Deliberately NOT awaited: this is the background run the route promised to start.
      void service
        .executeRun(targets, depth, active)
        .catch(async (err) => {
          strapi.log.error(
            `[ai-content-studio] brief run failed: ${redact().describeError(err)}`
          );
          await configSvc().setBriefRun({
            state: 'failed',
            error: redact().describeError(err),
            currentUid: null,
            completedAt: new Date().toISOString(),
          });
        })
        .finally(() => {
          running = false;
        });

      return { ok: true, total: targets.length };
    },

    /** The sequential body of a run. One content type at a time, progress persisted per section. */
    async executeRun(
      targets: string[],
      depth: BriefDepth,
      active: { model: any; provider: string; modelId: string }
    ): Promise<void> {
      const providerId = active.provider;
      const modelId = active.modelId;
      // Once per run — see `generateSection`'s note on why this is not computed per section.
      const schemaFingerprint = grounding().schemaFingerprint();
      let done = 0;
      let failures = 0;
      /**
       * Which content types fell back to an entry-only section, and why (005 FR-023, SC-012).
       *
       * Collected across the whole run and written once at the end, rather than appended per
       * section: the record describes a run, and a partially-written list read mid-run would tell
       * the operator that content types still being processed had already failed.
       *
       * Replaced wholesale rather than accumulated across runs — a failure from a previous run that
       * has since been fixed is not a failure of this one.
       */
      const pageReadingFailures: BriefRun['pageReadingFailures'] = [];

      for (const uid of targets) {
        await configSvc().setBriefRun({ currentUid: uid, doneCount: done });
        try {
          const section = await service.generateSection(
            uid,
            depth,
            active.model,
            providerId,
            modelId,
            schemaFingerprint,
            undefined,
            (reason) => pageReadingFailures.push({ uid, reason })
          );
          if (section) {
            await service.saveSection(section);
          } else {
            failures += 1;
          }
        } catch (err) {
          // One content type failing is not a run failing: the rest are still worth describing.
          failures += 1;
          strapi.log.warn(
            `[ai-content-studio] brief section for ${uid} failed: ${redact().describeError(err)}`
          );
        }
        done += 1;
      }

      await service.pruneSections();
      // The run is exactly what makes the cached answer wrong, so it clears it rather than waiting
      // out the TTL — an operator who just watched a run finish must not be told it is still stale.
      invalidateStaleness();

      /*
       * The whole-platform paragraph, written LAST and from the finished sections.
       *
       * It is recomputed on every run, including a partial auto-refresh run, because it is a
       * statement about how the content types relate — and that is exactly what a changed section
       * can invalidate. Leaving a stale overview in front of freshly-written sections would be the
       * one part of the brief that contradicts the rest of it.
       */
      await configSvc().setBriefRun({ currentUid: 'overview', doneCount: done });
      const overview = await service.generateOverview(await service.storedSections(), active.model);

      await configSvc().setBriefRun({
        state: 'ready',
        currentUid: null,
        doneCount: done,
        overview,
        completedAt: new Date().toISOString(),
        pageReadingFailures,
        error:
          failures > 0
            ? `${failures} of ${targets.length} content type(s) could not be described. The rest were.`
            : null,
      });
    },

    /** True while a run record is both `running` and recent enough not to be an abandoned lock. */
    isRunActive(run: { state: string; startedAt: string | null }): boolean {
      if (run.state !== 'running') {
        return false;
      }
      const startedAt = run.startedAt ? Date.parse(run.startedAt) : NaN;
      if (!Number.isFinite(startedAt)) {
        return false;
      }
      return Date.now() - startedAt < RUN_LOCK_STALE_MINUTES * 60 * 1000;
    },

    /* --------------------------------------------------------- automatic refresh */

    /**
     * Regenerate a BOUNDED number of stale sections, if enough time has passed. Never throws, never
     * blocks the caller — a chat turn calls this without awaiting it.
     *
     * Three independent bounds keep unattended spend predictable, and each answers a different
     * failure: the throttle stops a busy install from refreshing on every turn, the section cap
     * stops one pass from regenerating a whole large install, and the staleness filter stops
     * anything being regenerated that did not actually change.
     */
    async refreshIfDue(userAbility: unknown): Promise<void> {
      const options = configSvc().getContentBriefOptions();
      if (!options.enabled || !options.autoRefresh || running) {
        return;
      }

      const run = await configSvc().getBriefRun();
      // Never auto-refresh an install that has no brief at all: the first run is a deliberate,
      // operator-sized act with a stated cost, not something a chat turn starts on its own.
      if (run.state !== 'ready' || service.isRunActive(run)) {
        return;
      }
      const last = run.lastAutoRefreshAt ? Date.parse(run.lastAutoRefreshAt) : 0;
      if (Date.now() - last < options.refreshThrottleMinutes * 60 * 1000) {
        return;
      }

      const { stale, missing } = await service.staleness();
      const candidates = [...stale, ...missing].slice(0, options.maxAutoRefreshSections);
      if (candidates.length === 0) {
        return;
      }

      // Stamped BEFORE the work, so a slow or failing pass cannot be retried on every turn.
      await configSvc().setBriefRun({ lastAutoRefreshAt: new Date().toISOString() });

      const readable = new Set<string>(grounding().readableUids(userAbility));
      const targets = candidates.filter((uid) => readable.has(uid));
      if (targets.length === 0) {
        return;
      }

      await service.startRun({
        userAbility,
        userId: run.lastRunByUserId ?? 0,
        depth: run.depth,
        uids: targets,
      });
    },

    /* ------------------------------------------------------- the caller's brief */

    /**
     * Assemble the whole brief as ambient prose.
     *
     * ⚠ NO LONGER ON THE CHAT PATH (005 FR-031). The chat controller used to call this and put the
     * result in every request's instructions; it now reads `overviewFor()` and `briefIndex()`
     * instead, and the per-content-type sections are reachable only through `getContentBriefing`.
     *
     * KEPT, deliberately, as the DEFINITION OF THE VISIBILITY RULE the retrieval and the index both
     * apply — shared by default, per-reader filtered under `scopeToReader`. `retrieve` and
     * `briefIndex` state that they apply "exactly the rule `describeFor` applies", and having that
     * rule written once, here, is what makes the three of them provably the same rather than three
     * copies that drift. It is also what the invariant in contracts/briefing-retrieval.md §3.1 is
     * measured against: the tool returns no more than this block already returned to the same
     * caller.
     *
     * ONE BRIEF, THE SAME FOR EVERY ACCOUNT — see the file header.
     *
     * The default path does no per-caller filtering: every account with chat access is given the
     * whole thing, overview included, because the brief is a shared description of the platform and
     * two colleagues comparing the assistant's answers should not be reading different ones.
     *
     * `scopeToReader` is the deploy-time opt-out for installs where that is not acceptable —
     * multi-tenant, or a content type only one team may know exists. It is OFF by default, and the
     * settings page states which of the two an install is running under, so the disclosure is never
     * a surprise.
     */
    async describeFor(
      userAbility: unknown
    ): Promise<{ text: string; sectionCount: number; partial: boolean; charCount: number } | null> {
      const options = configSvc().getContentBriefOptions();
      if (!options.enabled) {
        return null;
      }

      const all = (await service.storedSections()).sort((a, b) => byBytes(a.uid, b.uid));
      const sections = options.scopeToReader
        ? (() => {
            const readable = new Set<string>(grounding().readableUids(userAbility));
            return all.filter((section) => readable.has(section.uid));
          })()
        : all;

      if (sections.length === 0) {
        return null;
      }

      /*
       * The overview is withheld under `scopeToReader`, and only there. It is synthesized from every
       * content type, so it cannot be attributed to any single permission and cannot be filtered —
       * which means an install that asked for per-reader scoping would be handed the one paragraph
       * that defeats it. On the default path it is the first thing the assistant reads.
       */
      const run = await configSvc().getBriefRun();
      const overview = !options.scopeToReader && run.overview ? run.overview.trim() : '';

      const render = (section: BriefSection): string => {
        const schema = schemaOf(section.uid);
        const displayName = schema?.info?.displayName ?? section.uid;
        return `- ${section.uid} — "${displayName}"\n  ${section.text.replace(/\n+/g, '\n  ')}`;
      };

      const kept: string[] = [];
      let charCount = 0;
      let omitted = 0;

      /*
       * The overview is placed FIRST and charged to the budget FIRST, so it is the one part that
       * cannot be squeezed out by a long tail of content types. It is the answer to "what is this
       * project", which is the question the assistant most needs answered and the one the sections
       * below it cannot answer individually.
       */
      if (overview) {
        kept.push(overview);
        charCount += overview.length + 2;
      }

      for (const section of sections) {
        const block = render(section);
        // +2 for the blank line between blocks, counted before accepting so the budget is a real
        // ceiling on the assembled text rather than on the sum of its pieces.
        if (charCount + block.length + 2 > options.maxChars) {
          omitted += 1;
          continue;
        }
        kept.push(block);
        charCount += block.length + 2;
      }

      // An overview on its own is not a brief — it describes content types that were all dropped.
      if (kept.length === 0 || (overview && kept.length === 1)) {
        return null;
      }
      const note =
        omitted > 0
          ? `\n\n(${omitted} further content type(s) omitted to fit the size budget. Use the read tools for those.)`
          : '';
      const text = kept.join('\n\n') + note;
      return {
        text,
        // The overview is not a content type, so it is not counted as one.
        sectionCount: overview ? kept.length - 1 : kept.length,
        partial: omitted > 0,
        charCount: text.length,
      };
    },

    /* ------------------------------------------------- coverage and the index (005) */

    /**
     * Is ONE stored section stale, read live?
     *
     * Two cheap queries for the single uid being retrieved, rather than the O(content types) walk
     * `staleness()` performs for the settings page. A retrieval must not pay for a full sweep, and a
     * thirty-second-old cached answer is the wrong input to a claim the assistant is about to make.
     */
    async isSectionStale(section: BriefSection): Promise<boolean> {
      if (section.schemaFingerprint !== grounding().schemaFingerprint()) {
        return true;
      }
      return (await service.contentFingerprint(section.uid)) !== section.contentFingerprint;
    },

    /**
     * One stored section plus its coverage, for the retrieval tool (005 contracts/briefing-retrieval.md §3).
     *
     * Applies EXACTLY the visibility rule `describeFor` applies — shared by default, per-reader
     * filtered under `scopeToReader`. The invariant, stated because it touches a NON-NEGOTIABLE
     * principle: this returns NO MORE than the ambient block it replaces already returned to the
     * same caller. Making it stricter would silently remove briefing that installs receive today,
     * which FR-033 and SC-009 forbid.
     */
    async retrieve(
      uid: string,
      userAbility: unknown
    ): Promise<{ section: BriefSection; coverage: BriefCoverage } | null> {
      const options = configSvc().getContentBriefOptions();
      if (!options.enabled) {
        return null;
      }
      if (options.scopeToReader && !grounding().readableUids(userAbility).includes(uid)) {
        return null;
      }
      const section = (await service.storedSections()).find((s) => s.uid === uid);
      if (!section) {
        return null;
      }
      return { section, coverage: deriveCoverage(section, await service.isSectionStale(section)) };
    },

    /**
     * The ambient index: one entry per content type that has a stored section (005 FR-032).
     *
     * NAMES AND NUMBERS, NEVER PROSE. It exists so the assistant can judge whether a section is
     * worth retrieving BEFORE it spends the call — which is the measurement SC-006 makes — and so
     * it can say when it relied on a weak one anyway.
     *
     * Visibility mirrors `describeFor` exactly: filtered to the caller's readable uids under
     * `scopeToReader`, unfiltered on the shared default (FR-037).
     *
     * `stale` here comes from the CACHED sweep rather than a live read per uid: the index describes
     * every stored section, so a live read would be O(content types) round trips on every turn, and
     * an index line is a hint that drives a retrieval rather than a claim. The retrieval that
     * follows reads staleness live.
     */
    async briefIndex(userAbility: unknown): Promise<BriefIndexEntry[]> {
      const options = configSvc().getContentBriefOptions();
      if (!options.enabled) {
        return [];
      }

      const all = (await service.storedSections()).sort((a, b) => byBytes(a.uid, b.uid));
      const sections = options.scopeToReader
        ? (() => {
            const readable = new Set<string>(grounding().readableUids(userAbility));
            return all.filter((section) => readable.has(section.uid));
          })()
        : all;

      if (sections.length === 0) {
        return [];
      }

      const { stale } = await service.staleness();
      const staleSet = new Set(stale);

      return sections.map((section) => ({
        uid: section.uid,
        displayName: schemaOf(section.uid)?.info?.displayName ?? section.uid,
        coverage: deriveCoverage(section, staleSet.has(section.uid)),
      }));
    },

    /**
     * The project overview alone, for the ambient `brief-overview` section (005 FR-036).
     *
     * Withheld under `scopeToReader` and only there, unchanged from `describeFor`'s rule: it is
     * synthesized across every content type, so it cannot be attributed to any one permission and
     * cannot be filtered.
     */
    async overviewFor(): Promise<{ text: string; generatedAt: string | null } | null> {
      const options = configSvc().getContentBriefOptions();
      if (!options.enabled || options.scopeToReader) {
        return null;
      }
      const run = await configSvc().getBriefRun();
      const text = run.overview?.trim() ?? '';
      return text ? { text, generatedAt: run.completedAt } : null;
    },

    /** The settings page's view: run state, coverage and staleness. Super-admin only, by route. */
    async status(userAbility: unknown): Promise<Record<string, unknown>> {
      const options = configSvc().getContentBriefOptions();
      const run = await configSvc().getBriefRun();
      const sections = await service.storedSections();
      const { stale, missing } = await service.staleness();
      const readable: string[] = grounding().readableUids(userAbility);

      return {
        enabled: options.enabled,
        /** Which of the two visibility modes this install runs under, so the panel can say so. */
        scopeToReader: options.scopeToReader,
        autoRefresh: options.autoRefresh,
        refreshThrottleMinutes: options.refreshThrottleMinutes,
        maxAutoRefreshSections: options.maxAutoRefreshSections,
        maxChars: options.maxChars,
        run: { ...run, active: service.isRunActive(run) },
        sectionCount: sections.length,
        readableCount: readable.length,
        staleCount: stale.length,
        missingCount: missing.length,
        /**
         * What one run would cost, in the units an operator can reason about.
         *
         * `modelCalls` is one per content type PLUS ONE for the project overview, which is written
         * last from the finished sections. Understating it by the overview would make the stated
         * cost wrong in the one direction a cost warning must never be wrong in.
         */
        estimate: {
          contentTypes: readable.length,
          entriesPerType: configSvc().briefSampleSize(run.depth),
          modelCalls: readable.length + (options.scopeToReader ? 0 : 1),
          /**
           * The added cost of rendered-page grounding, stated BEFORE the run (005 FR-024, SC-011).
           *
           * ⚠ `modelCalls` ABOVE IS UNCHANGED BY IT, and that is the checkable claim: the reading is
           * extra INPUT to the section call that was already counted, not an extra call. What page
           * reading adds is one bounded HTTP fetch per content type that has a preview target.
           */
          pageReading: {
            enabled: options.pageReading.enabled,
            /*
             * How many of the content types this run would walk actually have a preview target —
             * not how many exist. A content type with no target is simply not eligible, its section
             * is produced from entries exactly as today, and the run does not fail (US4-2).
             */
            withPreviewTarget: options.pageReading.enabled
              ? readable.filter((uid) => Boolean(configSvc().getPreviewOptions().paths[uid])).length
              : 0,
            timeoutMs: options.pageReading.timeoutMs,
            maxBytes: options.pageReading.maxBytes,
          },
        },
        /**
         * Which content types fell back to an entry-only section on the last run, and why
         * (FR-023, SC-012). DEGRADATION IS RECORDED, NEVER HIDDEN: an operator who turned page
         * reading on and got no benefit must be able to see what stopped it.
         */
        pageReadingFailures: run.pageReadingFailures,
        /** The stored overview, so an operator reads exactly what every account is being told. */
        overview: options.scopeToReader ? null : run.overview,
        sections: sections
          // Mirrors `describeFor`: the panel must show what the assistant is actually given, and
          // showing a filtered list under the shared default would misreport the disclosure.
          .filter((section) => !options.scopeToReader || readable.includes(section.uid))
          .sort((a, b) => byBytes(a.uid, b.uid))
          .map((section) => ({
            uid: section.uid,
            text: section.text,
            sampledCount: section.sampledCount,
            totalCount: section.totalCount,
            generatedAt: section.generatedAt,
            stale: stale.includes(section.uid),
            // So an operator can tell the two kinds of section apart, and re-run one without the
            // other (FR-026).
            locale: section.locale,
            pageInformed: section.pageInformed,
            pageUrl: section.pageUrl,
          })),
      };
    },
  };

  return service;
};

export default contentBriefService;
