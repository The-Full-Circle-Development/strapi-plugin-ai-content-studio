import { parse } from 'node-html-parser';
import type { Core } from '@strapi/strapi';
import type { PageReading, PageReadingFailure, PageRegion } from '../types';

/**
 * Rendered-page grounding for the briefing (005 contracts/page-reading.md).
 *
 * The briefing and the read tools both read stored JSON. A schema says a `page` has a `hero` with an
 * `image`; a sample of entries says that image is usually populated. Neither can say the page is a
 * marketing landing page, that the hero is the page's LEAD region, or that the component named
 * `block-c` is the testimonial carousel. That meaning exists only in the rendered output — and the
 * plugin already knows where to find it, because preview configuration resolves a front-end URL per
 * content type.
 *
 * PAGES ARE READ, NOT SEEN. No headless browser, no screenshot, no vision requirement. The
 * capability therefore behaves identically across the whole provider catalogue, which is Principle
 * III satisfied by construction rather than by a degradation path — a screenshot-based design would
 * have forced a vision-capable-only capability and a branch on provider identity.
 *
 * The accepted cost, stated so nobody is surprised by it: presentation facts are INFERRED FROM
 * DOCUMENT STRUCTURE, not observed. The briefing can learn that a region is the page's lead and what
 * it contains; it cannot learn that it renders full-bleed. A front end that ships no readable markup
 * gets no benefit at all and is treated exactly as unreachable.
 *
 * NOTHING FETCHED IS EVER PERSISTED. The reading is input to one model call and is then discarded;
 * only the model's prose reaches a row. That — not a filter — is the mechanism behind FR-025, and it
 * is the same guarantee feature 004 already relies on for entry values.
 *
 * THE PARSER WAS CHOSEN AGAINST RESEARCH D10'S CRITERIA, IN ORDER, and verified against the
 * installed package before a line was written against it (standing rule 6). `node-html-parser@9.0.4`
 * is pure JavaScript with no native binding (so it bundles into the committed `dist/`), MIT, and has
 * a two-package closure — against `cheerio`'s eleven, which include an HTTP client this feature must
 * not use, and `parse5`, which ships a spec AST but no text extraction, leaving the tree walking to
 * be hand-rolled. `parse`, `querySelectorAll`, `getAttribute`, `structuredText` and the
 * `blockTextElements` option were all verified in `dist/nodes/html.d.ts` and by running them.
 */

/* ------------------------------------------------------------------ the pure core */

/**
 * ⚠ THE WHOLE GUARD (FR-021). The resolved URL's origin must EQUAL the configured `preview.baseUrl`
 * origin — not start with it, not be a subdomain of it, not merely share a host.
 *
 * THERE IS NO PRIVATE-ADDRESS BLOCKLIST, AND THAT IS DELIBERATE RATHER THAN AN OVERSIGHT.
 * `preview.baseUrl` is set by the host application's developer in `config/plugins.ts` at deploy
 * time. It is never user-supplied, never model-supplied, and never derived from content — so there
 * is no server-side request forgery vector for a blocklist to close. What a blocklist WOULD do is
 * break `http://localhost:1337` and `http://web:3000`, which is the normal development and
 * docker-compose case. Origin equality against an operator-chosen value buys the whole guarantee;
 * adding more would cost working setups to buy nothing.
 *
 * Total: an unparseable URL on either side is not same-origin.
 */
export const isSameOrigin = (candidate: string, baseUrl: string | null): boolean => {
  if (!baseUrl) {
    return false;
  }
  try {
    return new URL(candidate).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
};

/**
 * Landmark elements, in the order they are looked for. A heading is a region too — many real front
 * ends use no landmarks at all, and a page of `<h2>`s is still a page with structure.
 */
const REGION_SELECTOR = 'header,nav,main,article,section,aside,footer,h1,h2,h3';

/**
 * Drop `mailto:` hrefs and email-shaped tokens from extracted text.
 *
 * BELT AND BRACES, NOT THE GUARANTEE. The guarantee is that nothing fetched is persisted (see the
 * file header). This exists because an email address is the one piece of personal data that most
 * reliably appears in a page's readable text, and keeping it out of the model call is cheap.
 */
const stripEmails = (text: string): string =>
  text.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '');

/** Collapse runs of whitespace; the readable text is prose, not layout. */
const flatten = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * Turn HTML into a `PageReading` — or say why it could not.
 *
 * PURE, so the suite can drive it across its whole range from string fixtures with no socket and no
 * filesystem. The fetch below is the only part that needs the network, and it is deliberately thin.
 */
export const extractReading = (
  html: string,
  { url, locale, maxChars }: { url: string; locale: string | null; maxChars: number }
): { ok: true; reading: PageReading } | { ok: false; reason: PageReadingFailure } => {
  let root;
  try {
    root = parse(html, {
      /*
       * ⚠ LOAD-BEARING, AND THE DEFAULT IS THE WRONG WAY ROUND. Verified by running the installed
       * parser: with the default options, `<script>` and `<style>` CONTENT IS INCLUDED in `.text`.
       * A single-page app's bundle would arrive as "readable text", which would spend the model
       * budget on JavaScript and could carry anything a script literal happens to hold.
       */
      blockTextElements: { script: false, style: false, noscript: false, pre: true, code: true },
      // Comments are excluded from text by default; stated explicitly so it survives an upgrade.
      comment: false,
    });
  } catch {
    // A parser that cannot parse it is indistinguishable, for this feature, from a page with
    // nothing to read.
    return { ok: false, reason: 'no_readable_text' };
  }

  const titleNode = root.querySelector('title');
  const title = titleNode ? flatten(titleNode.text) : null;

  const body = root.querySelector('body') ?? root;

  const regions: PageRegion[] = [];
  let order = 0;
  for (const node of body.querySelectorAll(REGION_SELECTOR)) {
    const text = flatten(stripEmails(node.structuredText ?? ''));
    const role = (node.rawTagName ?? '').toLowerCase();
    if (role === '') {
      continue;
    }
    const heading = /^h[1-6]$/.test(role) ? null : node.querySelector('h1,h2,h3,h4,h5,h6');
    const label =
      flatten(heading?.text ?? '') ||
      flatten(node.getAttribute('aria-label') ?? '') ||
      (/^h[1-6]$/.test(role) ? text : '') ||
      null;

    // A landmark with nothing readable in it describes nothing; it is structure without content.
    if (text === '' && !label) {
      continue;
    }

    regions.push({
      role,
      label: label || null,
      // Each region is bounded too, so one enormous `<main>` cannot consume the whole ceiling
      // before the regions after it are seen.
      text: text.slice(0, maxChars),
      order: order++,
    });
  }

  const full = flatten(stripEmails(body.structuredText ?? ''));

  /*
   * A SCRIPT SHELL — a front end that assembles everything in the browser — yields nothing here,
   * and is treated EXACTLY as unreachable (US4-4, FR-023). It is reported as its own reason so the
   * operator can tell the two apart in the settings page: "your front end renders client-side" and
   * "your front end is down" call for different responses.
   */
  if (full === '' && regions.length === 0) {
    return { ok: false, reason: 'no_readable_text' };
  }

  return {
    ok: true,
    reading: {
      url,
      locale,
      title: title || null,
      regions,
      text: full.slice(0, maxChars),
      truncated: full.length > maxChars,
    },
  };
};

/**
 * Render a reading for the section prompt. Bounded, structural, and never a verbatim passage of any
 * length that could be mistaken for a quote.
 */
export const renderReading = (reading: PageReading): string => {
  const lines = [
    `Rendered page: ${reading.url}`,
    reading.locale ? `Language version read: ${reading.locale}` : 'Language version: could not be determined from the page.',
    reading.title ? `Page title: ${reading.title}` : null,
    '',
    'Regions, in document order:',
    ...reading.regions.map(
      (region) =>
        `${region.order + 1}. <${region.role}>${region.label ? ` "${region.label}"` : ''} — ${region.text.slice(0, 400)}`
    ),
    '',
    'Readable text:',
    reading.text,
    reading.truncated ? '… [page text truncated to fit]' : null,
  ];
  return lines.filter((line) => line !== null).join('\n');
};

/* ---------------------------------------------------------------- the service */

/** At most two hops, and only while the origin still matches (FR-021). */
const MAX_REDIRECTS = 2;

const pageReadingService = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ai-content-studio');
  const configSvc = () => plugin().service('config');

  const service = {
    isSameOrigin,
    extractReading,
    renderReading,

    /**
     * Fetch one page, with every bound applied.
     *
     * NO CREDENTIALS ON ANY PATH: no cookies, no `Authorization`, no preview token, no `credentials`
     * option. This reads a PUBLISHED page as an anonymous visitor would, and sending a credential
     * would both widen what it can see and risk leaking one to a front end that logs its headers.
     *
     * LINKS ARE NEVER FOLLOWED. This is not a crawler, and host application source is never read —
     * the prohibition carried since feature 003 stands unchanged (FR-022).
     */
    async fetchPage(
      url: string
    ): Promise<{ ok: true; html: string } | { ok: false; reason: PageReadingFailure }> {
      const { pageReading } = configSvc().getContentBriefOptions();
      const baseUrl = configSvc().getPreviewOptions().baseUrl;

      if (!isSameOrigin(url, baseUrl)) {
        return { ok: false, reason: 'origin_mismatch' };
      }

      let current = url;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        let response: Response;
        try {
          response = await fetch(current, {
            // Followed MANUALLY, so each hop's origin can be checked before it is taken. `follow`
            // would take them all and only let us see where it landed.
            redirect: 'manual',
            signal: AbortSignal.timeout(pageReading.timeoutMs),
            headers: { Accept: 'text/html' },
          });
        } catch (err) {
          return {
            ok: false,
            reason: (err as { name?: string })?.name === 'TimeoutError' ? 'timeout' : 'unreachable',
          };
        }

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location || hop === MAX_REDIRECTS) {
            return { ok: false, reason: 'unreachable' };
          }
          let next: string;
          try {
            next = new URL(location, current).toString();
          } catch {
            return { ok: false, reason: 'unreachable' };
          }
          // An off-origin redirect target is refused rather than followed — the guard applies to
          // every hop, not only the first.
          if (!isSameOrigin(next, baseUrl)) {
            return { ok: false, reason: 'origin_mismatch' };
          }
          current = next;
          continue;
        }

        if (!response.ok) {
          return { ok: false, reason: 'unreachable' };
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.toLowerCase().includes('text/html')) {
          return { ok: false, reason: 'not_html' };
        }

        /*
         * The body is read through a BYTE COUNTER and abandoned past the ceiling, rather than
         * trusting `content-length` — which a chunked response does not send, and which a
         * misconfigured front end can understate. Abandoning mid-stream is the only bound that
         * actually holds.
         */
        try {
          const reader = response.body?.getReader();
          if (!reader) {
            return { ok: false, reason: 'unreachable' };
          }
          const chunks: Uint8Array[] = [];
          let bytes = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            bytes += value.byteLength;
            if (bytes > pageReading.maxBytes) {
              await reader.cancel();
              return { ok: false, reason: 'too_large' };
            }
            chunks.push(value);
          }
          return { ok: true, html: Buffer.concat(chunks).toString('utf8') };
        } catch (err) {
          return {
            ok: false,
            reason: (err as { name?: string })?.name === 'TimeoutError' ? 'timeout' : 'unreachable',
          };
        }
      }

      return { ok: false, reason: 'unreachable' };
    },

    /**
     * Read one sample entry's published page for a content type, or say why not.
     *
     * URLs COME ONLY FROM THE EXISTING `preview.resolvePreviewUrl` (FR-022). There is no second
     * resolver, no pattern of this feature's own, and no way for a model or an editor to name a URL:
     * the only reachable pages are ones an operator already configured a preview target for.
     *
     * FR-041 needs no new configuration. Path patterns already fill `:token` segments from the
     * target document's own fields, so a project serving a page per language writes `/:locale/:slug`
     * and the localized document fills it. Where the front end serves every version at one URL and
     * decides the language in the browser, the reading records that it COULD NOT TELL which version
     * it read, and the section says that instead of claiming one.
     */
    async read(
      uid: string,
      doc: Record<string, unknown> | null,
      locale: string | null
    ): Promise<{ ok: true; reading: PageReading } | { ok: false; reason: PageReadingFailure }> {
      const { pageReading } = configSvc().getContentBriefOptions();
      if (!pageReading.enabled) {
        return { ok: false, reason: 'not_configured' };
      }

      const resolved = plugin().service('preview').resolvePreviewUrl(uid, doc);
      if (!resolved.ok) {
        // Preview off, no path pattern for this content type, or a pattern this entry cannot fill.
        // The capability is simply unavailable here, and the run does not fail (FR-023, US4-2).
        return { ok: false, reason: 'not_configured' };
      }

      const fetched = await service.fetchPage(resolved.url);
      if (!fetched.ok) {
        return fetched;
      }

      return extractReading(fetched.html, {
        url: resolved.url,
        /*
         * The locale the RUN read, not one parsed out of the page. Where the run sampled a language
         * version, the URL was filled from that version's own fields, so this is what was fetched.
         * Null says "could not be determined", which is the honest answer for a front end that
         * decides the language in the browser.
         */
        locale,
        maxChars: pageReading.maxChars,
      });
    },
  };

  return service;
};

export default pageReadingService;
