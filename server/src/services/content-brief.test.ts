import {
  deriveCoverage,
  isWeakCoverage,
  renderIndexLine,
  WEAK_COVERAGE_RATIO,
} from './content-brief';
import type { BriefIndexEntry, BriefSection } from '../types';

/**
 * Briefing coverage and the ambient index (005 contracts/briefing-retrieval.md §8).
 *
 * THE DEFECT ALL OF THIS EXISTS TO FIX. `sampledCount` and `totalCount` were stored and then
 * discarded before the assistant ever saw them, so a section written from 4 entries out of 9,000
 * arrived looking exactly like one written from a complete reading. Everything here is about making
 * that difference visible — and about the one invariant that keeps the index from quietly becoming
 * a second copy of the briefing.
 *
 * Pure functions only: no Strapi runtime, no database, no provider. `stale` is resolved by the
 * caller, because it is the one input that needs a query.
 */

/** A stored section as the service reads one back. Overridable per assertion. */
const section = (overrides: Partial<BriefSection> = {}): BriefSection => ({
  uid: 'some::uid',
  text: 'Holds the things. Most entries fill only the title.',
  schemaFingerprint: 'fp-schema',
  contentFingerprint: 'fp-content',
  sampledCount: 50,
  totalCount: 60,
  generatedAt: '2026-09-12T10:00:00.000Z',
  provider: 'some-provider',
  model: 'some-model',
  locale: 'uk',
  pageInformed: false,
  pageUrl: null,
  pageLocale: null,
  ...overrides,
});

describe('weak coverage over the matrix (FR-013)', () => {
  it('a well-sampled, current section is NOT weak', () => {
    expect(isWeakCoverage({ sampledCount: 50, totalCount: 60, stale: false })).toBe(false);
  });

  it('a STALE section is weak however well it was sampled', () => {
    // Complete coverage of content that has since changed is not coverage of the content now.
    expect(isWeakCoverage({ sampledCount: 60, totalCount: 60, stale: true })).toBe(true);
  });

  it('an EMPTY content type is weak — whatever the section says describes entries that are gone', () => {
    expect(isWeakCoverage({ sampledCount: 5, totalCount: 0, stale: false })).toBe(true);
    // And a negative count, which should be impossible, is treated the same rather than dividing.
    expect(isWeakCoverage({ sampledCount: 5, totalCount: -1, stale: false })).toBe(true);
  });

  it('a LOW RATIO is weak — the reported case, by three orders of magnitude', () => {
    expect(isWeakCoverage({ sampledCount: 4, totalCount: 9000, stale: false })).toBe(true);
  });

  it('sits exactly at the declared ratio, not near it', () => {
    // At the boundary the section is NOT weak: the constant is a floor the section must fall below.
    const total = 100;
    const atBoundary = total * WEAK_COVERAGE_RATIO;
    expect(isWeakCoverage({ sampledCount: atBoundary, totalCount: total, stale: false })).toBe(false);
    expect(isWeakCoverage({ sampledCount: atBoundary - 1, totalCount: total, stale: false })).toBe(true);
  });

  it('does not label an ordinary well-sampled run', () => {
    /*
     * The failure mode a warning has is being shown so often that everyone learns to ignore it. The
     * shipped sampling depths are 5 / 15 / 50 entries, so a `deep` run must stay unlabelled across
     * the range of content types it can actually cover.
     */
    for (const total of [1, 5, 10, 50, 100, 500]) {
      expect(isWeakCoverage({ sampledCount: Math.min(50, total), totalCount: total, stale: false })).toBe(
        false
      );
    }
  });

  it('a single entry read out of a single entry is complete, not weak', () => {
    expect(isWeakCoverage({ sampledCount: 1, totalCount: 1, stale: false })).toBe(false);
  });
});

describe('deriveCoverage', () => {
  it('carries the counts, the locale and the date through unchanged', () => {
    const coverage = deriveCoverage(section({ sampledCount: 4, totalCount: 9000 }), false);
    expect(coverage).toEqual({
      sampledCount: 4,
      totalCount: 9000,
      locale: 'uk',
      generatedAt: '2026-09-12T10:00:00.000Z',
      stale: false,
      weak: true,
      pageInformed: false,
    });
  });

  it('reports `locale: null` as null — "not tracked", never "all of them"', () => {
    /*
     * The distinction is the whole point of FR-040. Before this feature a run counted every
     * translation, so "4 of 9,000" on a three-language install was 4 of 3,000 entries. A null says
     * the number cannot be read that finely; flattening it to a claim of full coverage would be the
     * exact misreading the feature exists to remove.
     */
    expect(deriveCoverage(section({ locale: null }), false).locale).toBeNull();
  });

  it('takes `stale` from the caller, because it is the one input that needs a query', () => {
    expect(deriveCoverage(section(), true).stale).toBe(true);
    expect(deriveCoverage(section(), true).weak).toBe(true);
    expect(deriveCoverage(section(), false).stale).toBe(false);
  });
});

/**
 * UPGRADE SAFETY. A section written before 005 has no `locale` and no page fields. It must read back
 * and render — the four columns are nullable precisely so an install that upgrades and changes no
 * setting keeps exactly what it wrote (FR-033, SC-009).
 */
describe('a section written by an older build', () => {
  const older = section({ locale: null, pageInformed: false, pageUrl: null, pageLocale: null });

  it('derives coverage without throwing, and says honestly what it does not know', () => {
    const coverage = deriveCoverage(older, false);
    expect(coverage.locale).toBeNull();
    expect(coverage.pageInformed).toBe(false);
    expect(coverage.weak).toBe(false);
  });

  it('renders an index line with no language version and no page claim', () => {
    const line = renderIndexLine({ uid: older.uid, displayName: 'Thing', coverage: deriveCoverage(older, false) });
    expect(line).toContain('50 of 60 entries');
    expect(line).toContain('current');
    // No locale is stated at all, rather than a locale being invented or "all" being implied.
    expect(line).not.toMatch(/\buk\b/);
    expect(line).not.toContain('page-informed');
  });
});

describe('the index line is names and numbers only (FR-032)', () => {
  const entry = (overrides: Partial<BriefSection> = {}, stale = false): BriefIndexEntry => ({
    uid: 'some::uid',
    displayName: 'Thing',
    coverage: deriveCoverage(section(overrides), stale),
  });

  /**
   * THE INVARIANT THAT IS THE WHOLE ENTITY. A line of prose here would quietly restore the ambient
   * claims FR-031 removed, and the index would become a second copy of the briefing — reachable
   * without the retrieval that is supposed to be the only way to it.
   */
  it('carries NO section prose', () => {
    const prose = 'Holds the things. Most entries fill only the title.';
    expect(renderIndexLine(entry())).not.toContain(prose);
    expect(renderIndexLine(entry())).not.toContain('Holds');
  });

  it('states the identifier, the display name, the counts and the date', () => {
    const line = renderIndexLine(entry());
    expect(line).toContain('some::uid');
    expect(line).toContain('"Thing"');
    expect(line).toContain('50 of 60 entries');
    expect(line).toContain('2026-09-12');
  });

  it('marks an out-of-date section, and says so in preference to "weak"', () => {
    const line = renderIndexLine(entry({ sampledCount: 4, totalCount: 9000 }, true));
    expect(line).toContain('OUT OF DATE');
    // Both are true, but two labels on one line reads as two problems. Stale is the more actionable.
    expect(line).not.toContain('WEAK COVERAGE');
  });

  it('marks a current section that was written from very little of the content type', () => {
    const line = renderIndexLine(entry({ sampledCount: 4, totalCount: 9000 }, false));
    expect(line).toContain('WEAK COVERAGE');
    expect(line).toContain('current');
    expect(line).toContain('4 of 9000 entries');
  });

  it('marks a page-informed section, so an operator can tell the two kinds apart (FR-026)', () => {
    expect(renderIndexLine(entry({ pageInformed: true }))).toContain('page-informed');
    expect(renderIndexLine(entry({ pageInformed: false }))).not.toContain('page-informed');
  });

  it('states the language version only when one was recorded', () => {
    expect(renderIndexLine(entry({ locale: 'uk' }))).toContain('uk');
    expect(renderIndexLine(entry({ locale: null }))).not.toMatch(/\buk\b/);
  });

  it('is one line — an index entry can never introduce its own structure', () => {
    // The index is a line-delimited block. A value carrying a newline would forge an entry.
    for (const overrides of [{}, { locale: null }, { pageInformed: true }, { totalCount: 0 }]) {
      expect(renderIndexLine(entry(overrides)).split('\n')).toHaveLength(1);
    }
  });
});
