import { renderInstallDescription, type RenderInput } from './grounding';
import type { GroundingTier } from '../types';

/**
 * The install description (FR-029..FR-033, FR-032, SC-011).
 *
 * Run against a FIXTURE schema — no Strapi runtime, no Document Service, no model, no clock. That
 * is what makes quickstart D5 repeatable: a fixture large enough to blow any budget is one object,
 * where a real project large enough is a whole install.
 */

/** Two content types, a component graph including a self-reference, and one preview target. */
const fixture = (): Omit<RenderInput, 'maxChars'> => ({
  readable: {
    'api::page.page': {
      kind: 'collectionType',
      info: { displayName: 'Page' },
      options: { draftAndPublish: true },
      pluginOptions: { i18n: { localized: true } },
      attributes: {
        title: { type: 'string', required: true },
        slug: { type: 'uid' },
        status: { type: 'enumeration', enum: ['zebra', 'apple', 'mango'] },
        cover: { type: 'media' },
        author: { type: 'relation', relation: 'manyToOne', target: 'api::author.author' },
        hero: { type: 'component', component: 'blocks.hero' },
        sections: { type: 'dynamiczone', components: ['blocks.hero', 'blocks.gallery'] },
        secretInternal: { type: 'string', private: true },
        hiddenField: { type: 'string', visible: false },
        // Excluded by Strapi's own predicates, so they must never appear in the output.
        createdAt: { type: 'datetime' },
        updatedAt: { type: 'datetime' },
        publishedAt: { type: 'datetime' },
        createdBy: { type: 'relation', relation: 'oneToOne', target: 'admin::user' },
      },
    },
    'api::author.author': {
      kind: 'singleType',
      info: { displayName: 'Author' },
      options: { draftAndPublish: false },
      attributes: {
        name: { type: 'string', required: true },
        avatar: { type: 'media' },
      },
    },
  },
  components: {
    'blocks.hero': {
      attributes: {
        headline: { type: 'string' },
        image: { type: 'media' },
        // A self-reference: an unguarded walk would not terminate.
        nested: { type: 'component', component: 'blocks.hero' },
      },
    },
    'blocks.gallery': {
      attributes: {
        images: { type: 'media', multiple: true },
        caption: { type: 'string' },
      },
    },
    'blocks.unreferenced': {
      attributes: { unused: { type: 'string' } },
    },
  },
  previewPaths: { 'api::page.page': '/:slug' },
  schemaFingerprint: 'fp-schema',
  readableFingerprint: 'fp-readable',
});

const render = (overrides: Partial<RenderInput> = {}) =>
  renderInstallDescription({ ...fixture(), maxChars: 24000, ...overrides });

describe('determinism (FR-030)', () => {
  it('renders the same fixture to identical bytes, twice', () => {
    expect(render().text).toBe(render().text);
  });

  it('renders identically across ten runs', () => {
    const runs = Array.from({ length: 10 }, () => render().text);
    expect(new Set(runs).size).toBe(1);
  });

  it('does not depend on the key insertion order of the input', () => {
    const base = fixture();
    const reversedReadable = Object.fromEntries(Object.entries(base.readable).reverse());
    const reversedComponents = Object.fromEntries(Object.entries(base.components).reverse());
    const a = renderInstallDescription({ ...base, maxChars: 24000 });
    const b = renderInstallDescription({
      ...base,
      readable: reversedReadable,
      components: reversedComponents,
      maxChars: 24000,
    });
    expect(a.text).toBe(b.text);
  });

  it('carries no timestamp and no entry value (FR-029, FR-030)', () => {
    const { text } = render();
    // No ISO date, no clock-shaped string anywhere.
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(text).not.toMatch(/\bGMT\b|\bUTC\b/);
    // No counts of content, which would vary with content volume.
    expect(text).not.toMatch(/\b\d+ entries\b|\bentry count\b/i);
  });
});

describe('sorting (contracts/install-description.md §3)', () => {
  it('sorts content types by a fixed byte ordering', () => {
    const { text } = render();
    expect(text.indexOf('api::author.author')).toBeLessThan(text.indexOf('api::page.page'));
  });

  it('sorts attribute names, but keeps enum values in their DECLARED order', () => {
    const { text } = render();
    // Attributes sorted: author before cover before hero before slug before status before title.
    expect(text.indexOf('- author:')).toBeLessThan(text.indexOf('- cover:'));
    expect(text.indexOf('- cover:')).toBeLessThan(text.indexOf('- slug:'));
    expect(text.indexOf('- slug:')).toBeLessThan(text.indexOf('- title:'));
    // Enum order is information and is stable — it must NOT be sorted.
    expect(text).toContain('enum: zebra | apple | mango');
    expect(text).not.toContain('enum: apple | mango | zebra');
  });
});

describe('what is described, and what is excluded', () => {
  it('renders identity, kind, flags and preview target per content type (FR-027)', () => {
    const { text } = render();
    expect(text).toContain('- api::page.page — "Page" (collection)');
    expect(text).toContain('draft & publish: yes   localized: yes');
    expect(text).toContain('preview target: configured');
    expect(text).toContain('- api::author.author — "Author" (single)');
    expect(text).toContain('draft & publish: no   localized: no');
  });

  it('renders relation targets with cardinality, and component references with repeatability', () => {
    const { text } = render();
    expect(text).toContain('relation -> api::author.author (manyToOne)');
    expect(text).toContain('component: blocks.hero');
    expect(text).toContain('dynamic zone: blocks.gallery | blocks.hero');
  });

  it('lists media fields as dotted paths, including inside components (SC-006)', () => {
    const { text } = render();
    expect(text).toMatch(/media fields:.*\bcover\b/);
    expect(text).toMatch(/media fields:.*hero\.image/);
  });

  it('terminates on a self-referencing component graph', () => {
    // If the cycle guard failed this would not return at all.
    expect(render().text.length).toBeGreaterThan(0);
  });

  it('excludes id, timestamps, creator fields, private and non-visible attributes', () => {
    const { text } = render();
    for (const excluded of [
      'createdAt',
      'updatedAt',
      'publishedAt',
      'createdBy',
      'updatedBy',
      'secretInternal',
      'hiddenField',
    ]) {
      expect(text).not.toContain(excluded);
    }
  });

  it('describes only components a readable content type actually references (§4)', () => {
    const { text } = render();
    expect(text).toContain('blocks.hero');
    expect(text).toContain('blocks.gallery');
    expect(text).not.toContain('blocks.unreferenced');
  });

  it('describes only what the caller may read (FR-031)', () => {
    // The service filters by live `can.read()`; the renderer must describe nothing outside what it
    // was handed, and must not leak a denied type through components or preview paths.
    const base = fixture();
    const { text } = renderInstallDescription({
      ...base,
      readable: { 'api::author.author': base.readable['api::author.author'] },
      maxChars: 24000,
    });
    expect(text).toContain('api::author.author');
    expect(text).not.toContain('api::page.page');
    // `blocks.hero` is referenced only by the denied type, so it must be absent too.
    expect(text).not.toContain('blocks.hero');
    // The preview target belongs to the denied type, so no preview section may name it.
    expect(text).not.toContain('/:slug');
  });

  it('states plainly when the caller can read nothing', () => {
    const result = renderInstallDescription({ ...fixture(), readable: {}, maxChars: 24000 });
    expect(result.text).toContain('none readable by this account');
    expect(result.contentTypeCount).toBe(0);
  });
});

describe('fingerprints are the exact cache key (FR-033, §5)', () => {
  it('passes both fingerprints through unchanged', () => {
    const result = render();
    expect(result.schemaFingerprint).toBe('fp-schema');
    expect(result.readableFingerprint).toBe('fp-readable');
  });

  it('is keyed so a schema change and an access change are distinguishable', () => {
    const a = render({ schemaFingerprint: 'one' });
    const b = render({ schemaFingerprint: 'two' });
    expect(a.schemaFingerprint).not.toBe(b.schemaFingerprint);

    const c = render({ readableFingerprint: 'x' });
    const d = render({ readableFingerprint: 'y' });
    expect(c.readableFingerprint).not.toBe(d.readableFingerprint);
  });
});

describe('the tier ladder and the size budget (FR-032, SC-011)', () => {
  it('is `full` and not partial when it fits', () => {
    const result = render({ maxChars: 24000 });
    expect(result.tier).toBe('full');
    expect(result.partial).toBe(false);
    expect(result.omittedContentTypeCount).toBe(0);
  });

  it('enters full -> no-components -> names-only -> dropped, in that order, as the budget shrinks', () => {
    // Drive maxChars down across its whole range and record the tier sequence actually entered.
    const seen: Array<{ tier: GroundingTier; omitted: number }> = [];
    for (let maxChars = 4000; maxChars >= 60; maxChars -= 10) {
      const result = render({ maxChars });
      const last = seen[seen.length - 1];
      if (!last || last.tier !== result.tier || (last.omitted === 0) !== (result.omittedContentTypeCount === 0)) {
        seen.push({ tier: result.tier, omitted: result.omittedContentTypeCount });
      }
    }
    const stages = seen.map((s) => `${s.tier}${s.omitted > 0 ? '+dropped' : ''}`);
    expect(stages).toEqual(['full', 'no-components', 'names-only', 'names-only+dropped']);
  });

  it('drops the component section at `no-components` but still NAMES the references', () => {
    const full = render({ maxChars: 24000 });
    // Find a budget that forces exactly one step down.
    let noComponents = render({ maxChars: full.charCount - 1 });
    let budget = full.charCount - 1;
    while (noComponents.tier === 'full' && budget > 100) {
      budget -= 50;
      noComponents = render({ maxChars: budget });
    }
    expect(noComponents.tier).toBe('no-components');
    expect(noComponents.text).not.toContain('#### Components');
    // The reference is still named on the field line, just not expanded.
    expect(noComponents.text).toContain('component: blocks.hero');
  });

  it('keeps identity, flags, preview target and media paths at `names-only`, and no other detail', () => {
    let result = render({ maxChars: 1000 });
    let budget = 1000;
    while (result.tier !== 'names-only' && budget > 80) {
      budget -= 20;
      result = render({ maxChars: budget });
    }
    expect(result.tier).toBe('names-only');
    expect(result.text).toContain('api::author.author');
    expect(result.text).toMatch(/draft & publish:/);
    // No field-detail lines survive.
    expect(result.text).not.toContain('  fields:');
    expect(result.text).not.toContain('- title: string');
  });

  it('sets partial on every tier below full', () => {
    for (let maxChars = 4000; maxChars >= 80; maxChars -= 10) {
      const result = render({ maxChars });
      if (result.tier !== 'full') {
        expect(result.partial).toBe(true);
      }
    }
  });

  it('states the dropped count when content types are dropped, and drops from the END', () => {
    let result = render({ maxChars: 200 });
    let budget = 200;
    while (result.omittedContentTypeCount === 0 && budget > 60) {
      budget -= 10;
      result = render({ maxChars: budget });
    }
    expect(result.omittedContentTypeCount).toBeGreaterThan(0);
    expect(result.text).toMatch(/content type\(s\) omitted to fit the size budget/);
    expect(result.partial).toBe(true);
    // `api::author.author` sorts first, so the LAST one is what goes.
    if (result.contentTypeCount === 1) {
      expect(result.text).toContain('api::author.author');
      expect(result.text).not.toContain('api::page.page');
    }
  });

  it('NEVER exceeds maxChars, at any budget across the whole range (SC-011)', () => {
    for (let maxChars = 4000; maxChars >= 20; maxChars -= 7) {
      const result = render({ maxChars });
      expect(result.charCount).toBeLessThanOrEqual(maxChars);
      expect(result.text.length).toBe(result.charCount);
    }
  });

  it('never exceeds a budget even at the declared 2,000 floor', () => {
    const result = render({ maxChars: 2000 });
    expect(result.charCount).toBeLessThanOrEqual(2000);
  });
});
