import { extractReading, isSameOrigin, renderReading } from './page-reading';
import { normalizeBriefRun } from './config';

/**
 * Rendered-page grounding (005 contracts/page-reading.md §7).
 *
 * ⚠ NO SOCKET IS OPENED HERE, AND THE HTML FIXTURES ARE STRINGS IN THIS FILE — not files on disk.
 * Both are constitutional requirements (Principle V): no test may open a network connection or
 * touch the filesystem outside its own fixtures. The fetch itself is deliberately thin for exactly
 * this reason; everything with a rule in it — the origin guard, the extraction — is pure.
 */

const read = (html: string, maxChars = 8000) =>
  extractReading(html, { url: 'https://site.example/page', locale: 'uk', maxChars });

/* ------------------------------------------------------------------- fixtures */

const LANDMARK_PAGE = `<!doctype html>
<html lang="uk">
  <head><title>Bathroom renovation</title></head>
  <body>
    <header><h1>Concept</h1><nav>Home Services</nav></header>
    <main>
      <h2>Renovation service</h2>
      <p>We refit bathrooms end to end.</p>
    </main>
    <aside><h3>Related</h3><p>Kitchen fitting</p></aside>
    <footer>Copyright</footer>
  </body>
</html>`;

const SCRIPT_SHELL = `<!doctype html>
<html>
  <head><title>App</title><script src="/bundle.js"></script></head>
  <body><div id="root"></div><script>window.__DATA__={secret:"LEAK"};</script></body>
</html>`;

const NOISY_PAGE = `<!doctype html>
<html>
  <head>
    <title>Contact</title>
    <style>.hero { color: rebeccapurple; }</style>
  </head>
  <body>
    <!-- an internal note nobody should read -->
    <main>
      <h1>Contact us</h1>
      <p>Write to jane.doe@example.com or sales@example.co.uk.</p>
      <a href="mailto:jane.doe@example.com">Email Jane</a>
    </main>
    <script>var apiKey = "sk-do-not-leak-this";</script>
  </body>
</html>`;

const HEADINGS_ONLY = `<!doctype html>
<html><body>
  <h1>Top</h1><p>Intro text.</p>
  <h2>Second</h2><p>More text.</p>
</body></html>`;

/* -------------------------------------------------------------- the origin guard */

describe('the origin-equality predicate (FR-021)', () => {
  const BASE = 'https://site.example';

  it('accepts the same origin, at any path', () => {
    expect(isSameOrigin('https://site.example/page', BASE)).toBe(true);
    expect(isSameOrigin('https://site.example/a/b/c?x=1#y', BASE)).toBe(true);
    expect(isSameOrigin('https://site.example', BASE)).toBe(true);
  });

  it('accepts a base URL that itself carries a sub-path', () => {
    // Origin equality ignores the path on BOTH sides, which is the intended reading: an operator
    // who configured `https://site.example/en` is naming a site, not a directory to be confined to.
    expect(isSameOrigin('https://site.example/other', 'https://site.example/en')).toBe(true);
  });

  it.each([
    ['a different port', 'https://site.example:8443/page'],
    ['a different scheme', 'http://site.example/page'],
    ['a different host', 'https://other.example/page'],
    ['a subdomain', 'https://www.site.example/page'],
    ['a host that merely starts the same', 'https://site.example.attacker.test/page'],
    ['a userinfo trick', 'https://site.example@attacker.test/page'],
  ])('refuses %s', (_label, candidate) => {
    expect(isSameOrigin(candidate, BASE)).toBe(false);
  });

  it('refuses everything when no base URL is configured', () => {
    // Preview not configured is not a licence to fetch anything.
    expect(isSameOrigin('https://site.example/page', null)).toBe(false);
    expect(isSameOrigin('https://site.example/page', '')).toBe(false);
  });

  it('is total over unparseable input on either side', () => {
    expect(isSameOrigin('not a url', BASE)).toBe(false);
    expect(isSameOrigin('https://site.example', 'not a url')).toBe(false);
    expect(isSameOrigin('', '')).toBe(false);
  });

  it('accepts the development and docker-compose cases a blocklist would have broken', () => {
    /*
     * The reason there is deliberately NO private-address blocklist. `preview.baseUrl` is set by
     * the host developer at deploy time — never user-supplied, never model-supplied, never derived
     * from content — so there is no SSRF vector for a blocklist to close, and one would break
     * exactly these.
     */
    expect(isSameOrigin('http://localhost:1337/page', 'http://localhost:1337')).toBe(true);
    expect(isSameOrigin('http://web:3000/page', 'http://web:3000')).toBe(true);
    expect(isSameOrigin('http://127.0.0.1:3000/x', 'http://127.0.0.1:3000')).toBe(true);
  });
});

/* ------------------------------------------------------------------ extraction */

describe('HTML to PageReading — landmarks and headings', () => {
  it('reports landmark regions IN DOCUMENT ORDER', () => {
    const result = read(LANDMARK_PAGE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const roles = result.reading.regions.map((r) => r.role);
    expect(roles.indexOf('header')).toBeLessThan(roles.indexOf('main'));
    expect(roles.indexOf('main')).toBeLessThan(roles.indexOf('aside'));
    expect(roles.indexOf('aside')).toBeLessThan(roles.indexOf('footer'));
    expect(result.reading.regions.map((r) => r.order)).toEqual(
      result.reading.regions.map((_, index) => index)
    );
  });

  it('labels a region from its own heading, which is what makes a region identifiable', () => {
    const result = read(LANDMARK_PAGE);
    if (!result.ok) throw new Error('expected a reading');
    const main = result.reading.regions.find((r) => r.role === 'main');
    expect(main?.label).toBe('Renovation service');
    expect(main?.text).toContain('We refit bathrooms end to end.');
  });

  it('reads the page title', () => {
    const result = read(LANDMARK_PAGE);
    if (!result.ok) throw new Error('expected a reading');
    expect(result.reading.title).toBe('Bathroom renovation');
  });

  it('treats headings as regions, for a front end that uses no landmarks', () => {
    const result = read(HEADINGS_ONLY);
    if (!result.ok) throw new Error('expected a reading');
    const roles = result.reading.regions.map((r) => r.role);
    expect(roles).toContain('h1');
    expect(roles).toContain('h2');
  });

  it('records the language version the run read, rather than parsing one out of the page', () => {
    const result = read(LANDMARK_PAGE);
    if (!result.ok) throw new Error('expected a reading');
    expect(result.reading.locale).toBe('uk');

    const undetermined = extractReading(LANDMARK_PAGE, {
      url: 'https://site.example/page',
      locale: null,
      maxChars: 8000,
    });
    if (!undetermined.ok) throw new Error('expected a reading');
    // Null means "could not be determined" — the honest answer for a front end that decides the
    // language in the browser (FR-041).
    expect(undetermined.reading.locale).toBeNull();
  });
});

describe('what must never reach the model', () => {
  it('excludes <script> content — the default parser option would have included it', () => {
    /*
     * ⚠ VERIFIED AGAINST THE INSTALLED PARSER, and the default is the wrong way round: with default
     * options `node-html-parser` DOES include script and style text. A single-page app's bundle
     * would arrive as "readable text", spending the model budget on JavaScript and carrying
     * whatever a script literal happens to hold.
     */
    const result = read(NOISY_PAGE);
    if (!result.ok) throw new Error('expected a reading');
    expect(result.reading.text).not.toContain('sk-do-not-leak-this');
    expect(result.reading.text).not.toContain('apiKey');
    expect(JSON.stringify(result.reading)).not.toContain('sk-do-not-leak-this');
  });

  it('excludes <style> content', () => {
    const result = read(NOISY_PAGE);
    if (!result.ok) throw new Error('expected a reading');
    expect(result.reading.text).not.toContain('rebeccapurple');
  });

  it('excludes comments', () => {
    const result = read(NOISY_PAGE);
    if (!result.ok) throw new Error('expected a reading');
    expect(result.reading.text).not.toContain('an internal note');
  });

  it('drops email-shaped tokens and mailto addresses (belt and braces, not the guarantee)', () => {
    /*
     * The real guarantee is that NOTHING FETCHED IS PERSISTED — the reading is input to one model
     * call and is then gone. This is cheap insurance on the one piece of personal data that most
     * reliably appears in a page's readable text.
     */
    const result = read(NOISY_PAGE);
    if (!result.ok) throw new Error('expected a reading');
    const serialized = JSON.stringify(result.reading);
    expect(serialized).not.toContain('jane.doe@example.com');
    expect(serialized).not.toContain('sales@example.co.uk');
    expect(serialized).not.toMatch(/@example\./);
    // The surrounding prose survives — this removes an address, not a sentence.
    expect(result.reading.text).toContain('Write to');
  });
});

describe('degradation', () => {
  it('a script shell yields no_readable_text, and is treated exactly as unreachable (US4-4)', () => {
    const result = read(SCRIPT_SHELL);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_readable_text');
  });

  it('an empty document yields no_readable_text rather than an empty reading', () => {
    for (const html of ['', '<html></html>', '<html><body></body></html>', '   ']) {
      const result = extractReading(html, { url: 'u', locale: null, maxChars: 8000 });
      expect(result.ok).toBe(false);
    }
  });

  it('is total over malformed markup rather than throwing into a briefing run', () => {
    // A failure here must degrade the section to entry-only, never fail the section, the run, or a
    // chat turn (FR-023).
    for (const html of ['<html><body><p>Unclosed', '<<>><p>x</p>', '<body><div><span></body>']) {
      expect(() => extractReading(html, { url: 'u', locale: null, maxChars: 8000 })).not.toThrow();
    }
  });
});

describe('the character ceiling', () => {
  const LONG = `<html><body><main><h1>Long</h1><p>${'word '.repeat(4000)}</p></main></body></html>`;

  it('bounds the text and says so', () => {
    const result = extractReading(LONG, { url: 'u', locale: null, maxChars: 500 });
    if (!result.ok) throw new Error('expected a reading');
    expect(result.reading.text.length).toBeLessThanOrEqual(500);
    expect(result.reading.truncated).toBe(true);
  });

  it('does not claim truncation when the page fits', () => {
    const result = read(LANDMARK_PAGE);
    if (!result.ok) throw new Error('expected a reading');
    expect(result.reading.truncated).toBe(false);
  });

  it('bounds each region too, so one huge region cannot crowd out the ones after it', () => {
    const result = extractReading(LONG, { url: 'u', locale: null, maxChars: 500 });
    if (!result.ok) throw new Error('expected a reading');
    for (const region of result.reading.regions) {
      expect(region.text.length).toBeLessThanOrEqual(500);
    }
  });
});

describe('renderReading — what the section prompt actually receives', () => {
  it('states the URL and the language version, or says it could not be determined', () => {
    const withLocale = read(LANDMARK_PAGE);
    if (!withLocale.ok) throw new Error('expected a reading');
    expect(renderReading(withLocale.reading)).toContain('Language version read: uk');

    const withoutLocale = extractReading(LANDMARK_PAGE, {
      url: 'https://site.example/page',
      locale: null,
      maxChars: 8000,
    });
    if (!withoutLocale.ok) throw new Error('expected a reading');
    expect(renderReading(withoutLocale.reading)).toMatch(/could not be determined/);
  });

  it('lists the regions in order, with their roles', () => {
    const result = read(LANDMARK_PAGE);
    if (!result.ok) throw new Error('expected a reading');
    const rendered = renderReading(result.reading);
    expect(rendered).toContain('<header>');
    expect(rendered).toContain('<main>');
    expect(rendered.indexOf('<header>')).toBeLessThan(rendered.indexOf('<main>'));
  });
});

/* -------------------------------------------------------------- upgrade safety */

describe('normalizeBriefRun defaults pageReadingFailures (FR-023)', () => {
  it('reads a run record written by an older build as an empty list', () => {
    const older = {
      state: 'ready' as const,
      depth: 'deep' as const,
      overview: 'A site.',
      startedAt: '2026-09-12T10:00:00.000Z',
      completedAt: '2026-09-12T10:10:00.000Z',
      currentUid: null,
      doneCount: 3,
      totalCount: 3,
      error: null,
      lastRunByUserId: 1,
      lastAutoRefreshAt: null,
    };
    expect(normalizeBriefRun(older).pageReadingFailures).toEqual([]);
  });

  it('defaults for a record that is missing entirely', () => {
    expect(normalizeBriefRun(null).pageReadingFailures).toEqual([]);
    expect(normalizeBriefRun(undefined).pageReadingFailures).toEqual([]);
  });

  it('carries real failures through, so the operator can see which types fell back (SC-012)', () => {
    const run = normalizeBriefRun({
      pageReadingFailures: [
        { uid: 'api::page.page', reason: 'unreachable' },
        { uid: 'api::event.event', reason: 'no_readable_text' },
      ],
    });
    expect(run.pageReadingFailures).toHaveLength(2);
    expect(run.pageReadingFailures[0]).toEqual({ uid: 'api::page.page', reason: 'unreachable' });
  });

  it('drops malformed entries rather than rendering them in the settings page', () => {
    // The run record comes back from the plugin store, where a half-written run from a process that
    // died mid-run is a real state.
    const run = normalizeBriefRun({
      pageReadingFailures: [
        { uid: 'api::page.page', reason: 'timeout' },
        null,
        'nonsense',
        { uid: 42, reason: 'timeout' },
        { uid: 'api::x.x' },
      ] as never,
    });
    expect(run.pageReadingFailures).toEqual([{ uid: 'api::page.page', reason: 'timeout' }]);
  });

  it('defaults when the stored value is not an array at all', () => {
    expect(normalizeBriefRun({ pageReadingFailures: 'oops' as never }).pageReadingFailures).toEqual([]);
  });
});
