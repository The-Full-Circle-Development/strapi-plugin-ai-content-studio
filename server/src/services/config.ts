import { z } from 'zod';
import type { Core } from '@strapi/strapi';
import { PROVIDER_IDS } from './providers';
import { BRIEF_DEPTH_SAMPLE, type BriefDepth, type BriefRun, type GroundingSource } from '../types';

/**
 * Plugin configuration persisted in the Strapi plugin store.
 *
 * Raw settings (including encrypted keys) NEVER leave the server. The only client-facing
 * shape is produced by `getMaskedConfig()`.
 *
 * The `providers` map is EXTENSIBLE (data-model §3): an unknown key is carried through untouched on
 * read and on write, so downgrading and re-upgrading does not silently discard a configuration.
 * Only ids in the provider table are ever offered for selection.
 */

/**
 * A saved provider id. Deliberately `string` rather than a literal union: the table in
 * `providers.ts` is the allow-list (FR-002), and widening this is what lets an install hold a
 * configuration for a provider this build does not offer without losing it.
 */
export type ProviderId = string;

export interface ProviderState {
  /** AES-256-GCM payload "iv:authTag:ciphertext" (base64), or null when unset. */
  apiKeyEnc: string | null;
  /** Derived on read from `apiKeyEnc != null` — never persisted as truth. */
  isSet: boolean;
  enabled: boolean;
  /**
   * Its OWN field, never merged into or rendered beside the credential (FR-008). That separation
   * is the point: a base URL can be shown, checked and corrected without ever risking the key.
   */
  baseUrl: string | null;
}

export interface StudioSettings {
  activeProvider: ProviderId;
  activeModel: string;
  providers: Record<string, ProviderState>;
  /** The RUNTIME grounding switch. Narrowed by, and never able to override, the plugin-config
   *  hard off-switch — see `isGroundingEnabled()`. */
  grounding: { enabled: boolean };
  /**
   * Which generated context the instructions carry, and how deep a brief run reads
   * (contracts/content-brief.md §2). Both are administrator choices made in Settings, so they live
   * beside the provider selection rather than in deploy-time plugin config.
   *
   * `source` defaults to `schema`: an install that upgrades into this feature keeps exactly the
   * behaviour it had, and gains nothing it did not ask for — there is no brief until someone runs
   * one, and selecting `brief` before then would silently empty the prompt's structural section.
   */
  contentBrief: { source: GroundingSource; depth: BriefDepth };
}

export interface MaskedProviderState {
  isSet: boolean;
  enabled: boolean;
  masked: string | null;
  /** Returned IN FULL: it is configuration, not a secret (FR-008). */
  baseUrl: string | null;
}

export interface MaskedStudioConfig {
  activeProvider: ProviderId;
  activeModel: string;
  providers: Record<string, MaskedProviderState>;
  grounding: { enabled: boolean };
  contentBrief: { source: GroundingSource; depth: BriefDepth };
}

/* --------------------------------------------------- static plugin options (config/index.ts) */

export interface PreviewOptions {
  enabled: boolean;
  baseUrl: string | null;
  paths: Record<string, string>;
  ttlMinutes: number;
}

export interface AttachmentOptions {
  totalBudgetMb: number;
  totalBudgetBytes: number;
}

export interface GroundingOptions {
  /** The HARD off-switch, set by the host application's developer at deploy time. No runtime
   *  toggle can re-enable it (contracts/install-description.md §7). */
  enabled: boolean;
  /** Declared character budget, clamped 2,000..80,000. */
  maxChars: number;
}

export interface ContentBriefOptions {
  /** The HARD off-switch for the whole feature, set at deploy time. No runtime control lifts it. */
  enabled: boolean;
  /** Declared character budget for the assembled brief, clamped 2,000..80,000. */
  maxChars: number;
  /** Per-section output ceiling, so one verbose section cannot consume the whole budget. */
  maxSectionChars: number;
  /** Whether a stale section may be regenerated without anyone pressing Run. */
  autoRefresh: boolean;
  /** Floor between two automatic refreshes. A human pressing Run is never throttled. */
  refreshThrottleMinutes: number;
  /** Hard ceiling on sections one AUTOMATIC pass may regenerate — the unattended-spend bound. */
  maxAutoRefreshSections: number;
  /**
   * OFF by default: one brief, the same for every account, overview included.
   *
   * Turned on, each reader is served only the sections their own live `can.read()` allows, and the
   * overview is withheld entirely because it is synthesized across every content type and so cannot
   * be filtered. For installs where the shared default is not acceptable — multi-tenant, or a
   * content type only one team may know exists.
   */
  scopeToReader: boolean;
  /** Rendered-page grounding (005 FR-024). OFF by default — see the interface below. */
  pageReading: PageReadingOptions;
}

/**
 * Rendered-page grounding for the briefing (005 contracts/page-reading.md §6).
 *
 * ⚠ OFF BY DEFAULT, and every other key defaults to the behaviour the plugin has today. An install
 * that changes nothing costs nothing and behaves identically (FR-024, FR-027, SC-009) — this is the
 * only part of feature 005 that spends anything new, and it spends it only on request.
 *
 * BOUNDED INSIDE THE BRIEFING'S EXISTING BUDGETS, not alongside them: the sampling depth, the
 * per-section and total character ceilings, the throttle and the per-pass section cap all continue
 * to govern spend unchanged. `maxChars` here is a ceiling WITHIN the sample budget handed to the
 * model, not an addition to it — which is what makes the stated cost checkable (SC-011).
 */
export interface PageReadingOptions {
  enabled: boolean;
  /** Elapsed-time bound on one fetch, clamped. */
  timeoutMs: number;
  /** Byte bound on one response body, clamped. */
  maxBytes: number;
  /** Ceiling on the reading handed to the model, clamped. */
  maxChars: number;
}

/** Seeded from the provider table so there is no second copy of the shipped id list. */
export const PROVIDERS: ProviderId[] = [...PROVIDER_IDS];

const STORE_PARAMS = { type: 'plugin', name: 'ai-content-studio', key: 'settings' } as const;

/**
 * The brief RUN state lives under its own store key, not inside `settings`.
 *
 * Two reasons, and the first is the load-bearing one: a run writes progress every few seconds from a
 * background task, while `settings` is written by an administrator saving a form — sharing one key
 * would make a save during a run clobber the run, or the run clobber the save. The second is that a
 * settings read happens on every chat turn and has no use for run progress.
 */
const RUN_STORE_PARAMS = { type: 'plugin', name: 'ai-content-studio', key: 'brief-run' } as const;

const GROUNDING_SOURCES: readonly GroundingSource[] = ['schema', 'brief', 'both'];
const BRIEF_DEPTHS = Object.keys(BRIEF_DEPTH_SAMPLE) as BriefDepth[];

/** The run state an install that has never generated a brief reads back. */
export const emptyBriefRun = (): BriefRun => ({
  state: 'never-run',
  depth: 'deep',
  overview: null,
  startedAt: null,
  completedAt: null,
  currentUid: null,
  doneCount: 0,
  totalCount: 0,
  error: null,
  lastRunByUserId: null,
  lastAutoRefreshAt: null,
  pageReadingFailures: [],
});

/**
 * Normalize a stored run record. Pure and exported so the suite can assert it with no Strapi
 * runtime, and total by construction: every field falls back to its default, so a record written by
 * an older build — or a half-written one from a process that died mid-run — still reads.
 */
export const normalizeBriefRun = (raw: Partial<BriefRun> | null | undefined): BriefRun => {
  const base = emptyBriefRun();
  if (!raw) {
    return base;
  }
  const state: BriefRun['state'] =
    raw.state === 'running' || raw.state === 'ready' || raw.state === 'failed'
      ? raw.state
      : 'never-run';
  return {
    state,
    depth: BRIEF_DEPTHS.includes(raw.depth as BriefDepth) ? (raw.depth as BriefDepth) : base.depth,
    overview: typeof raw.overview === 'string' && raw.overview.trim() !== '' ? raw.overview : null,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : null,
    currentUid: typeof raw.currentUid === 'string' ? raw.currentUid : null,
    doneCount: Number.isInteger(raw.doneCount) ? (raw.doneCount as number) : 0,
    totalCount: Number.isInteger(raw.totalCount) ? (raw.totalCount as number) : 0,
    error: typeof raw.error === 'string' ? raw.error : null,
    lastRunByUserId: Number.isInteger(raw.lastRunByUserId) ? (raw.lastRunByUserId as number) : null,
    lastAutoRefreshAt: typeof raw.lastAutoRefreshAt === 'string' ? raw.lastAutoRefreshAt : null,
    /*
     * Defaulted to `[]` for a record written by an older build (005 FR-023, page-reading §7).
     *
     * Each entry is validated rather than trusted: this record is read back from the plugin store,
     * where a half-written run from a process that died mid-run is a real state, and the settings
     * page renders these directly.
     */
    pageReadingFailures: Array.isArray(raw.pageReadingFailures)
      ? raw.pageReadingFailures.filter(
          (entry): entry is BriefRun['pageReadingFailures'][number] =>
            Boolean(entry) &&
            typeof (entry as { uid?: unknown }).uid === 'string' &&
            typeof (entry as { reason?: unknown }).reason === 'string'
        )
      : [],
  };
};

/* --------------------------------------------------------------- base URL validation */

/**
 * An administrator-supplied endpoint (FR-008).
 *
 * `z.url({ protocol: /^https?$/ })` is deliberate and `z.httpUrl()` is deliberately NOT used.
 * `z.httpUrl()` pins zod's `domain` regex, which was verified against the installed zod 4.4.3 to
 * REJECT `http://localhost:11434/v1`, `http://127.0.0.1:8080/v1` and `http://ollama:11434/v1` —
 * precisely the self-hosted `openai-compatible` endpoints this feature exists to serve. The
 * protocol form accepts those and still rejects `/v1`, `ftp://x.com` and `http:example.com`.
 *
 * Two rules stay ours, because `z.url()` does not cover them:
 *  - userinfo is REFUSED. `z.url()` accepts `https://user:pw@host`, and a credential smuggled into
 *    the endpoint field would sit outside the encrypted-key path entirely (Principle I).
 *  - trailing slashes are trimmed, reusing the idiom `getPreviewOptions()` already uses below, so
 *    one endpoint written two ways normalizes to one stored value.
 */
export const baseUrlSchema = z
  .url({ protocol: /^https?$/ })
  .refine((value) => !/^[a-z]+:\/\/[^/@]*@/i.test(value), {
    message: 'Base URL must not contain a username or password.',
  })
  .transform((value) => value.trim().replace(/\/+$/, ''));

/**
 * Parse one base-URL input into a stored value.
 *
 * `null` and `''` both CLEAR the field; anything else must validate. Returns a discriminated
 * result rather than throwing, so the controller can answer a `400` naming the field.
 */
export const parseBaseUrl = (
  input: unknown
): { ok: true; value: string | null } | { ok: false; message: string } => {
  if (input === null || input === undefined || (typeof input === 'string' && input.trim() === '')) {
    return { ok: true, value: null };
  }
  if (typeof input !== 'string') {
    return { ok: false, message: 'Base URL must be a string.' };
  }
  const parsed = baseUrlSchema.safeParse(input.trim());
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ??
        'Base URL must be an absolute http:// or https:// URL with no username or password.',
    };
  }
  return { ok: true, value: parsed.data };
};

/* ------------------------------------------------------------------- normalization */

const emptyProvider = (): ProviderState => ({
  apiKeyEnc: null,
  isSet: false,
  enabled: false,
  baseUrl: null,
});

const defaults = (): StudioSettings => ({
  activeProvider: PROVIDERS[0],
  activeModel: '',
  providers: Object.fromEntries(PROVIDERS.map((id) => [id, emptyProvider()])),
  grounding: { enabled: true },
  // `schema` by default — see the field's own comment: an upgrade must change no behaviour.
  contentBrief: { source: 'schema', depth: 'deep' },
});

/**
 * Fill defaults for any missing field, derive `isSet` from the stored ciphertext, and PRESERVE
 * unknown provider keys.
 *
 * Pure and exported so `config.test.ts` can assert it without a Strapi runtime. Every rule here is
 * an upgrade-safety rule: a missing field always takes its default, so an install written by an
 * older build never breaks on read (FR-036).
 */
export const normalizeSettings = (
  raw: Partial<StudioSettings> | null | undefined
): StudioSettings => {
  const base = defaults();
  if (!raw) {
    return base;
  }

  // Union of the shipped ids and whatever is actually stored, so a configuration for a provider
  // this build does not offer survives a read/write round trip.
  const keys = Array.from(new Set([...PROVIDERS, ...Object.keys(raw.providers ?? {})]));
  const providers: Record<string, ProviderState> = {};
  for (const id of keys) {
    const stored = raw.providers?.[id];
    if (!stored) {
      providers[id] = emptyProvider();
      continue;
    }
    const apiKeyEnc = stored.apiKeyEnc ?? null;
    providers[id] = {
      apiKeyEnc,
      // ALWAYS recomputed from the ciphertext, never trusted from input.
      isSet: apiKeyEnc != null,
      enabled: stored.enabled ?? false,
      baseUrl: typeof stored.baseUrl === 'string' && stored.baseUrl !== '' ? stored.baseUrl : null,
    };
  }

  return {
    activeProvider: raw.activeProvider ?? base.activeProvider,
    activeModel: raw.activeModel ?? base.activeModel,
    providers,
    // A missing `grounding` defaults to ON, so an existing install gains it on upgrade (FR-036).
    grounding: { enabled: raw.grounding?.enabled !== false },
    /*
     * An unrecognized value falls back to the DEFAULT rather than being preserved, which is the
     * opposite of the rule the `providers` map above follows — deliberately. A provider key this
     * build does not offer is configuration worth keeping through a downgrade; a grounding source
     * this build cannot assemble is a prompt this build cannot compose, so it must resolve to one
     * that works rather than to a stored string nothing honours.
     */
    contentBrief: {
      source: GROUNDING_SOURCES.includes(raw.contentBrief?.source as GroundingSource)
        ? (raw.contentBrief!.source as GroundingSource)
        : base.contentBrief.source,
      depth: BRIEF_DEPTHS.includes(raw.contentBrief?.depth as BriefDepth)
        ? (raw.contentBrief!.depth as BriefDepth)
        : base.contentBrief.depth,
    },
  };
};

/**
 * The two-switch precedence rule of contracts/install-description.md §7, computed in exactly ONE
 * place.
 *
 * Two flags with the rule re-derived at each call site is how they end up disagreeing, so every
 * caller — the prompt composer, the chat controller, the inspector — reads this.
 */
export const isGroundingEnabledFrom = (pluginEnabled: boolean, settingsEnabled: boolean): boolean =>
  pluginEnabled && settingsEnabled;

/** Clamp a config number into a sane range, falling back to the default for junk input. */
const num = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(n)));
};

const configService = ({ strapi }: { strapi: Core.Strapi }) => {
  const store = () => strapi.store(STORE_PARAMS);
  const runStore = () => strapi.store(RUN_STORE_PARAMS);
  const cryptoSvc = () => strapi.plugin('ai-content-studio').service('crypto');
  const option = <T>(key: string, fallback: T): T =>
    strapi.config.get(`plugin::ai-content-studio.${key}`, fallback) as T;

  const service = {
    /** Raw settings including encrypted keys. SERVER-INTERNAL ONLY — never send to the client. */
    async get(): Promise<StudioSettings> {
      const raw = (await store().get({})) as Partial<StudioSettings> | null;
      return normalizeSettings(raw);
    },

    async set(next: StudioSettings): Promise<void> {
      await store().set({ value: next });
    },

    /** Encrypts and persists a provider's key. Pass null to clear it. */
    async setProviderKey(provider: ProviderId, plaintextKey: string | null): Promise<void> {
      const current = await service.get();
      const apiKeyEnc = plaintextKey ? cryptoSvc().encrypt(plaintextKey) : null;
      current.providers[provider] = {
        ...(current.providers[provider] ?? emptyProvider()),
        apiKeyEnc,
        isSet: apiKeyEnc != null,
      };
      await service.set(current);
    },

    async setProviderEnabled(provider: ProviderId, enabled: boolean): Promise<void> {
      const current = await service.get();
      current.providers[provider] = {
        ...(current.providers[provider] ?? emptyProvider()),
        enabled,
      };
      await service.set(current);
    },

    /** Persists an already-validated base URL. Pass null to clear it. */
    async setProviderBaseUrl(provider: ProviderId, baseUrl: string | null): Promise<void> {
      const current = await service.get();
      current.providers[provider] = {
        ...(current.providers[provider] ?? emptyProvider()),
        baseUrl,
      };
      await service.set(current);
    },

    async setActive(activeProvider: ProviderId, activeModel: string): Promise<void> {
      const current = await service.get();
      current.activeProvider = activeProvider;
      // Stored VERBATIM — never validated against a curated list, normalized, lowercased or
      // date-suffixed (FR-004, FR-005).
      current.activeModel = activeModel;
      await service.set(current);
    },

    async setGroundingEnabled(enabled: boolean): Promise<void> {
      const current = await service.get();
      current.grounding = { enabled };
      await service.set(current);
    },

    /**
     * Patch the content-brief selection. Each field is applied only if present, so changing the
     * source never resets the depth an operator chose for their next run — and vice versa.
     */
    async setContentBrief(patch: {
      source?: GroundingSource;
      depth?: BriefDepth;
    }): Promise<void> {
      const current = await service.get();
      current.contentBrief = {
        source: patch.source ?? current.contentBrief.source,
        depth: patch.depth ?? current.contentBrief.depth,
      };
      await service.set(current);
    },

    /** Decrypts and returns a provider's raw key, or null. SERVER-INTERNAL ONLY. */
    async getDecryptedKey(provider: ProviderId): Promise<string | null> {
      const current = await service.get();
      // Only the REQUESTED provider's ciphertext is touched (data-model §3).
      const enc = current.providers[provider]?.apiKeyEnc;
      if (!enc) {
        return null;
      }
      return cryptoSvc().decrypt(enc);
    },

    /** Safe-for-client view. NEVER includes raw or encrypted keys — masked + flags only. */
    async getMaskedConfig(): Promise<MaskedStudioConfig> {
      const current = await service.get();
      const providers: Record<string, MaskedProviderState> = {};
      for (const [id, st] of Object.entries(current.providers)) {
        let masked: string | null = null;
        if (st.apiKeyEnc) {
          // Decrypt transiently only to mask — the plaintext never leaves this function.
          masked = cryptoSvc().maskKey(cryptoSvc().decrypt(st.apiKeyEnc));
        }
        providers[id] = {
          isSet: st.isSet,
          enabled: st.enabled,
          masked,
          baseUrl: st.baseUrl,
        };
      }
      return {
        activeProvider: current.activeProvider,
        activeModel: current.activeModel,
        providers,
        grounding: current.grounding,
        contentBrief: current.contentBrief,
      };
    },

    /**
     * The EFFECTIVE grounding switch — the AND of the deploy-time hard off-switch and the runtime
     * toggle (contracts/install-description.md §7). Every caller reads this, never one flag.
     */
    async isGroundingEnabled(): Promise<boolean> {
      const settings = await service.get();
      return isGroundingEnabledFrom(
        service.getGroundingOptions().enabled,
        settings.grounding.enabled
      );
    },

    /**
     * Which switch is holding grounding off, for the inspector's English hint (FR-035). `null`
     * when it is on. `'config'` wins, because it is the one a runtime toggle cannot lift.
     */
    async groundingDisabledBy(): Promise<'config' | 'settings' | null> {
      if (!service.getGroundingOptions().enabled) {
        return 'config';
      }
      const settings = await service.get();
      return settings.grounding.enabled ? null : 'settings';
    },

    /* ------------------------------------------------- static options, typed and defaulted */

    /**
     * Preview options. `enabled` is false unless a project opts in, and an enabled preview with
     * no `baseUrl` is treated as NOT configured, so the panel falls back to the field comparison
     * instead of producing a broken URL (FR-014).
     */
    getPreviewOptions(): PreviewOptions {
      const raw = option<Record<string, unknown>>('preview', {});
      const baseUrl = typeof raw.baseUrl === 'string' && raw.baseUrl.trim() !== '' ? raw.baseUrl.trim().replace(/\/+$/, '') : null;
      const paths =
        raw.paths && typeof raw.paths === 'object' && !Array.isArray(raw.paths)
          ? (raw.paths as Record<string, string>)
          : {};
      return {
        enabled: raw.enabled === true && baseUrl !== null,
        baseUrl,
        paths,
        ttlMinutes: num(raw.ttlMinutes, 30, 1, 1440),
      };
    },

    getAttachmentOptions(): AttachmentOptions {
      const raw = option<Record<string, unknown>>('attachments', {});
      const totalBudgetMb = num(raw.totalBudgetMb, 50, 1, 2048);
      return { totalBudgetMb, totalBudgetBytes: totalBudgetMb * 1024 * 1024 };
    },

    /**
     * Grounding options. `enabled` defaults to TRUE — the description is deterministic, bounded,
     * permission-filtered and inspectable, which are the four properties that make an
     * on-by-default generated prompt section safe for an existing install (FR-036).
     */
    getGroundingOptions(): GroundingOptions {
      const raw = option<Record<string, unknown>>('grounding', {});
      return {
        enabled: raw.enabled !== false,
        maxChars: num(raw.maxChars, 24000, 2000, 80000),
      };
    },

    /**
     * Content-brief options. `enabled` defaults to TRUE, but that grants nothing on its own: an
     * install has no brief until an administrator presses Run, and the stored source defaults to
     * `schema`, so an upgrade changes no prompt and spends no provider token.
     *
     * The automatic refresh is bounded by THREE independent limits, and every one of them is a
     * spend bound rather than a correctness one: only sections whose fingerprint actually moved are
     * eligible, `refreshThrottleMinutes` floors how often a pass may run at all, and
     * `maxAutoRefreshSections` caps how many sections any single pass may regenerate. A host that
     * wants none of it sets `autoRefresh: false` and keeps the manual button.
     */
    getContentBriefOptions(): ContentBriefOptions {
      const raw = option<Record<string, unknown>>('contentBrief', {});
      return {
        enabled: raw.enabled !== false,
        maxChars: num(raw.maxChars, 24000, 2000, 80000),
        maxSectionChars: num(raw.maxSectionChars, 1200, 200, 8000),
        autoRefresh: raw.autoRefresh !== false,
        refreshThrottleMinutes: num(raw.refreshThrottleMinutes, 60, 5, 10080),
        maxAutoRefreshSections: num(raw.maxAutoRefreshSections, 3, 1, 50),
        // Explicit `true` only — the shared brief is the stated default, so a typo never silently
        // narrows what every account sees.
        scopeToReader: raw.scopeToReader === true,
        pageReading: (() => {
          const page = (raw.pageReading ?? {}) as Record<string, unknown>;
          return {
            /*
             * Explicit `true` only, for the same reason `scopeToReader` requires one and the
             * OPPOSITE of how `enabled` above is read. This capability makes outbound HTTP requests
             * from the host, so a typo must leave it off rather than silently on.
             */
            enabled: page.enabled === true,
            timeoutMs: num(page.timeoutMs, 5000, 500, 30000),
            maxBytes: num(page.maxBytes, 1_000_000, 10_000, 20_000_000),
            maxChars: num(page.maxChars, 8000, 500, 40000),
          };
        })(),
      };
    },

    /** How many entries one run reads per content type, for the stored depth. */
    briefSampleSize(depth: BriefDepth): number {
      return BRIEF_DEPTH_SAMPLE[depth] ?? BRIEF_DEPTH_SAMPLE.deep;
    },

    /* ------------------------------------------------------- the brief run record */

    async getBriefRun(): Promise<BriefRun> {
      const raw = (await runStore().get({})) as Partial<BriefRun> | null;
      return normalizeBriefRun(raw);
    },

    /** Merge a patch into the run record. Callers only ever state the fields they changed. */
    async setBriefRun(patch: Partial<BriefRun>): Promise<BriefRun> {
      const current = await service.getBriefRun();
      const next = normalizeBriefRun({ ...current, ...patch });
      await runStore().set({ value: next });
      return next;
    },
  };

  return service;
};

export default configService;
