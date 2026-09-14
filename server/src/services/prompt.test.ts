import {
  composeInstructions,
  deriveVersion,
  INSTRUCTION_VERSION,
  type InstructionInputs,
} from './prompt';
import { INSTRUCTION_SECTION_IDS, type InstructionSectionId } from '../types';

/**
 * The instruction composer (FR-018, FR-020, FR-021, FR-025, FR-026, SC-004).
 *
 * `prompt.build` is a PURE FUNCTION BY CONTRACT, so this is a test of the requirement itself rather
 * than of a model. No Strapi runtime, no provider, no clock.
 *
 * This is deliberately NOT a snapshot of the prompt text. A snapshot would turn every legitimate
 * edit red and train everyone to update it blindly, which is the opposite of a useful gate.
 */

/**
 * The version the behavioural sections derived to BEFORE feature 005 added `language` and
 * `attribution` (T002, recorded by running the pre-feature suite rather than recalled).
 *
 * It exists so "the version changed" is an assertion against a real measured baseline rather than
 * against a remembered one. `INSTRUCTION_VERSION` is DERIVED from the section text, so this constant
 * is never hand-synchronised with it: when a future change edits a behavioural section, the version
 * moves away from this value and the assertion below still holds. The one thing that would make this
 * constant wrong is reverting all of 005's instruction text, which is exactly what it should catch.
 */
const PRE_FEATURE_INSTRUCTION_VERSION = 'v1-f876fd89';

const baseInputs = (overrides: Partial<InstructionInputs> = {}): InstructionInputs => ({
  supportsVision: true,
  hasAttachments: false,
  groundingEnabled: false,
  readableUids: [],
  schemaFingerprint: 'fp-schema',
  contextSummary: null,
  install: null,
  briefOverview: null,
  briefIndex: null,
  ...overrides,
});

/**
 * The stored project overview — the ONE part of the briefing that is still ambient (005 FR-036).
 */
const OVERVIEW = {
  text: 'A marketing site for a bathroom fitter, built from pages, posts and a team directory.',
  generatedAt: '2026-09-12T10:00:00.000Z',
};

/**
 * Section PROSE, as it was carried ambiently before 005 and as `getContentBriefing` now returns it.
 *
 * It exists in this suite ONLY so the load-bearing assertion can look for it and fail to find it:
 * no part of this string may appear in the composed instructions when a briefing exists.
 */
const SECTION_PROSE =
  'Holds the things. Most entries fill only the title, and the hero image is usually empty.';

/**
 * Index lines as `content-brief.renderIndexLine` produces them: names and numbers, no prose.
 *
 * The uids here are deliberately NOT `api::`-prefixed, matching the `install` fixture above and for
 * the same reason: the prohibition suite asserts that no `api::` identifier appears ANYWHERE in the
 * composed text, which is a statement about the composer's own static text. A fixture carrying a
 * realistic uid would make that assertion fail on the fixture rather than on a real defect, and the
 * usual repair — exempting the generated blocks — would quietly stop checking them.
 */
const INDEX_LINES = [
  'some::uid - "Thing" - 50 of 60 entries - uk - 2026-09-12 - current',
  'other::uid - "Event" - 4 of 9000 entries - uk - 2026-03-02 - OUT OF DATE',
];

/** A situation block as `situation.ts` composes one. Its own text is asserted in that suite. */
const SITUATION_TEXT =
  '## The current situation\n\n<situation>\neditor interface language: uk\n</situation>';

/** Every combination of the flags that can vary the composition. */
const allCombinations = (): InstructionInputs[] => {
  const out: InstructionInputs[] = [];
  for (const supportsVision of [true, false]) {
    for (const hasAttachments of [true, false]) {
      for (const groundingEnabled of [true, false]) {
        for (const contextSummary of [null, 'Earlier the editor asked about a landing page.']) {
          for (const install of [
            null,
            { text: '#### Content types\n- some::uid — "Thing" (collection)', partial: false },
            { text: '#### Content types\n- some::uid — "Thing" (collection)', partial: true },
          ]) {
            // The briefing is varied alongside `install` rather than in its own suite, so the
            // determinism, ordering and prohibition tests below all exercise it for free — the
            // three selections an administrator can make (schema / brief / both) are exactly the
            // three shapes of this pair.
            for (const [briefOverview, briefIndex] of [
              [null, null],
              [OVERVIEW, null],
              [null, INDEX_LINES],
              [OVERVIEW, INDEX_LINES],
            ] as const) {
              // The situation block is varied here too, so the ordering and prohibition tests
              // below exercise it for free rather than needing their own matrix.
              for (const situation of [null, SITUATION_TEXT]) {
                out.push(
                  baseInputs({
                    supportsVision,
                    hasAttachments,
                    groundingEnabled,
                    readableUids: groundingEnabled ? ['some::uid'] : [],
                    contextSummary,
                    install,
                    briefOverview,
                    briefIndex,
                    situation,
                  })
                );
              }
            }
          }
        }
      }
    }
  }
  return out;
};

describe('byte-identical composition (FR-018, SC-004)', () => {
  it('composes TEN consecutive times to ten identical strings', () => {
    // This is the check quickstart C1 asks a human to perform ten times, which no human will.
    const inputs = baseInputs({
      hasAttachments: true,
      supportsVision: false,
      groundingEnabled: true,
      readableUids: ['b::b', 'a::a'],
      contextSummary: 'Some earlier context.',
      install: { text: '#### Content types\n- a::a — "A" (collection)', partial: true },
      // EVERY new section included, so the determinism check covers what 005 added rather than
      // only what it inherited (005 contracts/language.md §6).
      briefOverview: OVERVIEW,
      briefIndex: INDEX_LINES,
      situation: '## The current situation\n\n<situation>\neditor interface language: uk\n</situation>',
    });

    const runs = Array.from({ length: 10 }, () => composeInstructions(inputs).text);
    for (const run of runs) {
      expect(run).toBe(runs[0]);
    }
    expect(new Set(runs).size).toBe(1);
  });

  it('is identical across every input combination, composed twice', () => {
    for (const inputs of allCombinations()) {
      expect(composeInstructions(inputs).text).toBe(composeInstructions(inputs).text);
    }
  });

  it('does not vary with the ORDER the caller collected readable uids in', () => {
    // `build` sorts before use, so two callers with the same access compose identically.
    const a = composeInstructions(baseInputs({ readableUids: ['a::a', 'b::b'] }));
    const b = composeInstructions(baseInputs({ readableUids: ['b::b', 'a::a'] }));
    expect(a.text).toBe(b.text);
  });
});

describe('declared section order (contracts/instructions.md §1)', () => {
  const DECLARED_ORDER = INSTRUCTION_SECTION_IDS;

  it('always emits the behavioural sections, in order, first', () => {
    const { sections } = composeInstructions(baseInputs());
    expect(sections).toEqual([
      'role',
      // `language` sits immediately after `role` (005 contracts/language.md §1): which language to
      // answer in is a property of being the assistant, not a rule about one of its activities.
      'language',
      'discovery',
      'permissions',
      'ambiguity',
      'proposing',
      'tool-honesty',
      // `attribution` extends `tool-honesty`: that governs how a result is REPORTED, this governs
      // what may be asserted when there is no result at all (005 FR-008).
      'attribution',
      'retired',
      'style',
    ]);
  });

  it('never emits a section out of the declared order, under any input', () => {
    for (const inputs of allCombinations()) {
      const { sections } = composeInstructions(inputs);
      const positions = sections.map((id) => DECLARED_ORDER.indexOf(id));
      const ascending = [...positions].sort((x, y) => x - y);
      expect(positions).toEqual(ascending);
    }
  });

  it('emits each conditional section only under its stated condition', () => {
    const has = (sections: readonly InstructionSectionId[], id: InstructionSectionId) =>
      sections.includes(id);

    // 9 — only when the turn carries held files.
    expect(has(composeInstructions(baseInputs({ hasAttachments: false })).sections, 'attachments')).toBe(false);
    expect(has(composeInstructions(baseInputs({ hasAttachments: true })).sections, 'attachments')).toBe(true);

    // 9a — only when 9 applies AND the model is not vision-capable.
    expect(
      has(
        composeInstructions(baseInputs({ hasAttachments: true, supportsVision: true })).sections,
        'attachments-blind'
      )
    ).toBe(false);
    expect(
      has(
        composeInstructions(baseInputs({ hasAttachments: true, supportsVision: false })).sections,
        'attachments-blind'
      )
    ).toBe(true);
    // Never without 9 — a blind note with no attachments would be nonsense.
    expect(
      has(
        composeInstructions(baseInputs({ hasAttachments: false, supportsVision: false })).sections,
        'attachments-blind'
      )
    ).toBe(false);

    // 10a — the overview, only when one was stored and not withheld.
    expect(has(composeInstructions(baseInputs({ briefOverview: null })).sections, 'brief-overview')).toBe(false);
    expect(has(composeInstructions(baseInputs({ briefOverview: OVERVIEW })).sections, 'brief-overview')).toBe(true);
    // An empty or whitespace-only overview is the same as none: an empty delimiter block would tell
    // the model this project has no content, which is a different and false claim.
    expect(
      has(
        composeInstructions(baseInputs({ briefOverview: { text: '  \n ', generatedAt: null } })).sections,
        'brief-overview'
      )
    ).toBe(false);

    // 10b — the index, only when at least one section is stored.
    expect(has(composeInstructions(baseInputs({ briefIndex: null })).sections, 'brief-index')).toBe(false);
    expect(has(composeInstructions(baseInputs({ briefIndex: [] })).sections, 'brief-index')).toBe(false);
    expect(has(composeInstructions(baseInputs({ briefIndex: INDEX_LINES })).sections, 'brief-index')).toBe(true);

    // Absent and null are the same input, so every caller written before these existed composes
    // byte-identically.
    const withoutKeys = baseInputs();
    delete (withoutKeys as { briefOverview?: unknown }).briefOverview;
    delete (withoutKeys as { briefIndex?: unknown }).briefIndex;
    expect(composeInstructions(withoutKeys).text).toBe(
      composeInstructions(baseInputs({ briefOverview: null, briefIndex: null })).text
    );

    // 11 — only when the thread has a condensed summary.
    expect(has(composeInstructions(baseInputs({ contextSummary: null })).sections, 'condensed')).toBe(false);
    expect(has(composeInstructions(baseInputs({ contextSummary: 'x' })).sections, 'condensed')).toBe(true);
  });
});

/**
 * The briefing after 005 split it in two (contracts/briefing-retrieval.md §8).
 *
 * The per-content-type sections LEFT the instructions. What remains ambient is the project overview,
 * bounded away from any claim about a specific entry, and an index of names and numbers.
 */
describe('the briefing sections (005 FR-031, FR-032, FR-036)', () => {
  const install = { text: '#### Content types\n- a::a — "A" (collection)', partial: false };

  /**
   * THE LOAD-BEARING ASSERTION OF USER STORY 2.
   *
   * FR-031 is not a wording change: it is the claim that a section-derived statement must have been
   * preceded by a retrieval, and the only thing that MAKES that true is that the prose is no longer
   * reachable any other way. If section prose leaks back into the composition — through the index,
   * through the overview, through a helpful future addition — the requirement is silently false and
   * nothing else in the suite would notice.
   */
  it('carries NO section prose, under ANY input combination', () => {
    for (const inputs of allCombinations()) {
      expect(composeInstructions(inputs).text).not.toContain(SECTION_PROSE);
    }
    // And the composer has no way to be handed it: `briefIndex` is strings that have already been
    // reduced to names and numbers, and `briefOverview` is the overview alone.
    const withIndex = composeInstructions(baseInputs({ briefIndex: INDEX_LINES })).text;
    expect(withIndex).not.toContain(SECTION_PROSE);
    expect(withIndex).toContain('some::uid');
    expect(withIndex).toContain('4 of 9000 entries');
  });

  it('tells the model the briefing is NOT in the instructions and must be retrieved (FR-031)', () => {
    const { text } = composeInstructions(baseInputs({ briefIndex: INDEX_LINES }));
    expect(text).toMatch(/It is NOT in these instructions/);
    expect(text).toMatch(/call getContentBriefing/);
    expect(text).toMatch(/IN THIS TURN/);
  });

  it('delimits the index, and says what the coverage numbers are for', () => {
    const { text } = composeInstructions(baseInputs({ briefIndex: INDEX_LINES }));
    expect(text).toContain('<briefing-index>');
    expect(text).toContain('</briefing-index>');
    expect(text).toMatch(/worth\s+retrieving before you spend the call/);
  });

  describe('the overview stays ambient, and is bounded (FR-036, SC-015)', () => {
    it('is delimited and carries its date, so its age is visible', () => {
      const { text } = composeInstructions(baseInputs({ briefOverview: OVERVIEW }));
      expect(text).toContain('<project-overview>');
      expect(text).toContain('</project-overview>');
      expect(text).toContain(OVERVIEW.text);
      expect(text).toContain('written 2026-09-12');
    });

    it('bars itself from supporting ANY claim about a specific entry, field or identifier', () => {
      /*
       * This is the one path 005 knowingly leaves open for an unretrieved claim, and the bound is
       * what makes that acceptable. SC-015 measures it over real replies — zero statements about a
       * specific entry, field value or identifier may trace to the overview — but the obligation
       * has to be in the text or there is nothing for the model to obey.
       */
      const { text } = composeInstructions(baseInputs({ briefOverview: OVERVIEW }));
      expect(text).toMatch(/MUST NOT be the basis for ANY statement about a specific entry/);
      expect(text).toMatch(/For those, RETRIEVE/);
      expect(text).toMatch(/NEVER take a field name/);
      expect(text).toMatch(/THE TOOL RESULT WINS/);
      expect(text).toMatch(/GRANTS NO PERMISSION/);
    });

    it('composes without a date when the run never recorded one', () => {
      const { text } = composeInstructions(
        baseInputs({ briefOverview: { text: OVERVIEW.text, generatedAt: null } })
      );
      expect(text).toContain('## What this project is\n');
      expect(text).toContain(OVERVIEW.text);
    });
  });

  it('places the schema facts BEFORE the briefing, and the overview before the index', () => {
    const { text, sections } = composeInstructions(
      baseInputs({
        groundingEnabled: true,
        readableUids: ['a::a'],
        install,
        briefOverview: OVERVIEW,
        briefIndex: INDEX_LINES,
      })
    );
    expect(sections.indexOf('install')).toBeLessThan(sections.indexOf('brief-overview'));
    expect(sections.indexOf('brief-overview')).toBeLessThan(sections.indexOf('brief-index'));
    expect(text.indexOf('<install-structure>')).toBeLessThan(text.indexOf('<project-overview>'));
    expect(text.indexOf('<project-overview>')).toBeLessThan(text.indexOf('<briefing-index>'));
  });

  it('carries the briefing alone when no description was rendered — the `brief` selection', () => {
    const { sections } = composeInstructions(
      baseInputs({
        groundingEnabled: true,
        readableUids: ['a::a'],
        install: null,
        briefOverview: OVERVIEW,
        briefIndex: INDEX_LINES,
      })
    );
    expect(sections).toContain('brief-overview');
    expect(sections).toContain('brief-index');
    expect(sections).not.toContain('install');
  });

  /**
   * `scopeToReader` withholds the overview and FILTERS the index (FR-037) — decided in
   * `content-brief`, which is the only place that can see the caller's permissions. What the
   * composer must guarantee is that it faithfully carries whichever of the two it was handed, so
   * a withheld overview cannot reappear because an index was present.
   */
  it('emits the index alone when the overview was withheld under scopeToReader', () => {
    const { sections, text } = composeInstructions(
      baseInputs({ briefOverview: null, briefIndex: [INDEX_LINES[0] as string] })
    );
    expect(sections).toContain('brief-index');
    expect(sections).not.toContain('brief-overview');
    expect(text).not.toContain('<project-overview>');
    expect(text).not.toContain(OVERVIEW.text);
  });

  it('does NOT change the instruction version — both are per-install fact, not rules', () => {
    // The same reason the install description is excluded from the hash (research D10): a version
    // that differed between two installs running identical rules would identify nothing.
    expect(
      composeInstructions(baseInputs({ briefOverview: OVERVIEW, briefIndex: INDEX_LINES })).version
    ).toBe(composeInstructions(baseInputs({ briefOverview: null, briefIndex: null })).version);
  });

  /**
   * SC-009, and the assertion an upgrade actually rests on.
   *
   * `schema` is the DEFAULT, so this is the composition almost every existing install gets. On it
   * the briefing must contribute NOTHING: no overview block, no index block, and — in the
   * controller, not here — no tool definition, which is what keeps the token cost of an install
   * that opted into nothing exactly where it was.
   *
   * WHAT THIS DELIBERATELY DOES NOT ASSERT, because it would be false: that the whole composition
   * is byte-identical to the pre-feature one. It is not, and it is not meant to be — `language` and
   * `attribution` are behavioural sections that apply to EVERY install, which is SC-010's stated
   * exception ("the product returns to its current behaviour except the language rule and the
   * briefing's move to retrieval"). Writing the stronger assertion would have meant making a
   * behavioural section conditional on a per-install setting, which would break the one property
   * `INSTRUCTION_VERSION` depends on: that two installs running identical rules report the same
   * version.
   *
   * `attribution` therefore names `getContentBriefing` on every install. On `schema` that clause is
   * inert rather than misleading — its antecedent is "anything you take from the stored briefing",
   * and on `schema` there is no briefing in the model's context to take anything from.
   */
  it('on the `schema` selection, the briefing contributes nothing to the composition (SC-009)', () => {
    const asSchemaSelection = baseInputs({
      groundingEnabled: true,
      readableUids: ['a::a'],
      install,
      briefOverview: null,
      briefIndex: null,
    });
    const { text, sections } = composeInstructions(asSchemaSelection);
    expect(sections).not.toContain('brief-overview');
    expect(sections).not.toContain('brief-index');
    expect(text).not.toContain('briefing-index');
    expect(text).not.toContain('project-overview');
    expect(text).not.toContain(SECTION_PROSE);
    expect(text).not.toContain(OVERVIEW.text);

    // And nothing of the briefing's own text is in scope: composing with the keys absent entirely
    // produces the same bytes, so an install that never opted in pays for none of it.
    const withoutKeys = baseInputs({ groundingEnabled: true, readableUids: ['a::a'], install });
    delete (withoutKeys as { briefOverview?: unknown }).briefOverview;
    delete (withoutKeys as { briefIndex?: unknown }).briefIndex;
    expect(composeInstructions(withoutKeys).text).toBe(text);
  });
});

/**
 * The reply-language obligations (005 contracts/language.md §6).
 *
 * WHAT THESE CAN AND CANNOT PROVE. That the rule is PRESENT is checkable here; that a model OBEYS
 * it is model behaviour, never asserted in a test (Principle V), and is the ten-turn Ukrainian
 * conversation in quickstart §2. These assertions exist so the rule cannot be deleted or reworded
 * past its own requirements without a red test.
 */
describe('the language section (005 FR-001..FR-007)', () => {
  const texts = () => allCombinations().map((inputs) => composeInstructions(inputs).text);

  it('is always present — there is no input that composes without it', () => {
    for (const inputs of allCombinations()) {
      expect(composeInstructions(inputs).sections).toContain('language');
    }
  });

  it('names Ukrainian and Russian as distinct and non-substitutable (FR-002)', () => {
    /*
     * The load-bearing assertion of this whole feature's first story. The REPORTED DEFECT is a
     * model answering a Ukrainian message in Russian, which a general "reply in the user's
     * language" rule did not prevent — the two are close enough that a model can treat one as an
     * acceptable rendering of the other. Naming them is the fix, so a reword that drops either name
     * must fail here.
     */
    for (const text of texts()) {
      expect(text).toMatch(/Ukrainian/);
      expect(text).toMatch(/Russian/);
      expect(text).toMatch(/DISTINCT languages/);
      expect(text).toMatch(/NEVER substitutes/);
    }
  });

  it('requires the reply to follow the MOST RECENT message, and a mid-thread switch (FR-001, SC-002)', () => {
    const text = composeInstructions(baseInputs()).text;
    expect(text).toMatch(/MOST RECENT MESSAGE/);
    expect(text).toMatch(/switch with them from your very next reply/i);
  });

  it('states the fallback order — interface language, then English (FR-003)', () => {
    const text = composeInstructions(baseInputs()).text;
    expect(text).toMatch(/interface language/i);
    expect(text).toMatch(/English only when you have neither/i);
  });

  it('lets an explicit request for a named language override both (FR-004)', () => {
    expect(composeInstructions(baseInputs()).text).toMatch(/explicit request for a named language/i);
  });

  it('forbids translating a quoted value or an identifier, ever (FR-005, SC-003)', () => {
    // SC-003 is measured over real replies, but the obligation behind it has to be in the text.
    const text = composeInstructions(baseInputs()).text;
    expect(text).toMatch(/EXACTLY AS STORED/);
    expect(text).toMatch(/Never translate a value you are quoting/i);
    expect(text).toMatch(/Never translate an identifier/i);
  });

  it('requires a tool’s English reason to be RELAYED in the editor’s language (FR-006, US1-3)', () => {
    // Tool results stay English deliberately — their payloads carry identifiers, and FR-005 forbids
    // translating an identifier under any circumstances. So the relay is the assistant's job.
    const text = composeInstructions(baseInputs()).text;
    expect(text).toMatch(/Tools answer you in English/);
    expect(text).toMatch(/IN THE EDITOR'S LANGUAGE/);
  });

  it('sits immediately after `role`, before any rule about an activity', () => {
    const { sections } = composeInstructions(baseInputs());
    expect(sections.indexOf('language')).toBe(sections.indexOf('role') + 1);
  });

  it('stays English ASCII, so naming two languages costs the prohibition nothing (FR-007)', () => {
    // "Ukrainian" and "Russian" are ASCII words. This is the same assertion the prohibitions block
    // makes, repeated here because it is the specific risk of a section that names languages.
    for (const text of texts()) {
      const foreignLetters = text.replace(/[ -⁯←-⇿─-╿]/g, '').match(/[^\x00-\x7F]/g);
      expect(foreignLetters).toBeNull();
    }
  });
});

/**
 * The per-request situation block, as the COMPOSER sees it (005 contracts/situation-and-focus.md).
 * The block's own text is asserted in `situation.test.ts`; this is about how it is carried.
 */
describe('the situation section (005 FR-016, FR-029)', () => {
  const SITUATION = '## The current situation\n\n<situation>\neditor interface language: uk\n</situation>';

  it('is carried verbatim when there is something to say', () => {
    const { text, sections } = composeInstructions(baseInputs({ situation: SITUATION }));
    expect(sections).toContain('situation');
    expect(text).toContain(SITUATION);
  });

  it.each([
    ['null', null],
    ['absent', undefined],
    ['empty', ''],
    ['whitespace only', '  \n '],
  ])('emits no section when the block is %s', (_label, situation) => {
    expect(composeInstructions(baseInputs({ situation })).sections).not.toContain('situation');
  });

  it('composes byte-identically whether the key is absent or null', () => {
    // So every caller written before the situation block existed composes unchanged.
    const withoutKey = baseInputs();
    delete (withoutKey as { situation?: unknown }).situation;
    expect(composeInstructions(withoutKey).text).toBe(
      composeInstructions(baseInputs({ situation: null })).text
    );
  });

  it('sits AFTER every generated fact and BEFORE the condensed history', () => {
    // Order is the contract: the situation is read against the rules and the generated facts above
    // it, rather than framing them.
    const { sections } = composeInstructions(
      baseInputs({
        groundingEnabled: true,
        readableUids: ['a::a'],
        install: { text: 'x', partial: false },
        briefOverview: OVERVIEW,
        briefIndex: INDEX_LINES,
        situation: SITUATION,
        contextSummary: 'Earlier context.',
      })
    );
    expect(sections.indexOf('install')).toBeLessThan(sections.indexOf('situation'));
    expect(sections.indexOf('brief-overview')).toBeLessThan(sections.indexOf('situation'));
    expect(sections.indexOf('brief-index')).toBeLessThan(sections.indexOf('situation'));
    expect(sections.indexOf('situation')).toBeLessThan(sections.indexOf('condensed'));
  });

  it('does NOT change the instruction version — it is per-request fact, not a rule', () => {
    expect(composeInstructions(baseInputs({ situation: SITUATION })).version).toBe(
      composeInstructions(baseInputs({ situation: null })).version
    );
  });
});

describe('the install section is included only when it should be (FR-036)', () => {
  const install = { text: '#### Content types\n- a::a — "A" (collection)', partial: false };

  it('is absent when grounding is off, even with a description in hand', () => {
    const result = composeInstructions(
      baseInputs({ groundingEnabled: false, readableUids: ['a::a'], install })
    );
    expect(result.sections).not.toContain('install');
    expect(result.groundingIncluded).toBe(false);
    expect(result.text).not.toContain('install-structure');
  });

  it('is absent when the caller can read nothing', () => {
    const result = composeInstructions(
      baseInputs({ groundingEnabled: true, readableUids: [], install })
    );
    expect(result.sections).not.toContain('install');
    expect(result.groundingIncluded).toBe(false);
  });

  it('is present, delimited, and subordinate when grounding is on', () => {
    const result = composeInstructions(
      baseInputs({ groundingEnabled: true, readableUids: ['a::a'], install })
    );
    expect(result.groundingIncluded).toBe(true);
    expect(result.sections).toContain('install');
    // Delimited, so the model can tell generated facts from rules.
    expect(result.text).toContain('<install-structure>');
    expect(result.text).toContain('</install-structure>');
    // All three things §3 requires the preamble to state.
    expect(result.text).toContain('FACTS ABOUT THIS INSTALL');
    expect(result.text).toMatch(/GRANT NO PERMISSION/);
    expect(result.text).toMatch(/THE RULE ABOVE WINS/);
  });

  it('says so, and says to use the tools, when the description is partial (FR-032)', () => {
    const partial = composeInstructions(
      baseInputs({ groundingEnabled: true, readableUids: ['a::a'], install: { text: 'x', partial: true } })
    );
    expect(partial.groundingPartial).toBe(true);
    expect(partial.text).toContain('PARTIAL');
    expect(partial.text).toMatch(/read tools/);

    const full = composeInstructions(
      baseInputs({ groundingEnabled: true, readableUids: ['a::a'], install })
    );
    expect(full.groundingPartial).toBe(false);
    expect(full.text).not.toContain('PARTIAL');
  });

  it('reports groundingPartial false whenever the section is not included at all', () => {
    const off = composeInstructions(
      baseInputs({ groundingEnabled: false, install: { text: 'x', partial: true } })
    );
    expect(off.groundingPartial).toBe(false);
  });
});

describe('prohibitions the text may never break (contracts/instructions.md §5)', () => {
  /**
   * Checked across EVERY input combination, because a prohibition that holds only in the default
   * composition is not a prohibition.
   *
   * Note these are necessary but not sufficient: a paraphrase survives a regex, which is why the
   * verification pass also requires reading the composed text end to end (quickstart C1, T096).
   */
  const texts = () => allCombinations().map((inputs) => composeInstructions(inputs).text);

  it('never claims the assistant can approve, apply, preview or publish (FR-021)', () => {
    for (const text of texts()) {
      // Only the NEGATED forms may appear. Any first-person claim of the capability is a defect.
      expect(text).not.toMatch(/\bI (?:can|will) (?:approve|apply|preview|publish)\b/i);
      expect(text).not.toMatch(/\byou can (?:approve|apply|publish) (?:the|this) plan\b/i);
    }
  });

  it('never refers to modes, mode switching, or a mode’s limitations (FR-017)', () => {
    for (const text of texts()) {
      expect(text).not.toMatch(/\bmodes?\b/i);
      expect(text).not.toMatch(/mode selector|switch to|read-only mode/i);
      expect(text).not.toMatch(/Content Editing|Layout Mapping|Code Audit/i);
    }
  });

  it('never hard-codes a content-type identifier or a field name (FR-020)', () => {
    for (const text of texts()) {
      // No `api::*` uid, and none of the field names the previous prompt shipped.
      expect(text).not.toMatch(/api::/);
      expect(text).not.toMatch(/featuredImage|blog-post|homepage|hero\.(?:slides|headline)/i);
    }
  });

  it('never names a consuming project (FR-020)', () => {
    for (const text of texts()) {
      expect(text).not.toMatch(/Concept Bath/i);
    }
  });

  it('never contains a model identifier (CLAUDE.md)', () => {
    for (const text of texts()) {
      expect(text).not.toMatch(/claude-[a-z0-9]/i);
      expect(text).not.toMatch(/gpt-[0-9]/i);
      expect(text).not.toMatch(/gemini-[0-9]/i);
      expect(text).not.toMatch(/\bo[0-9]-(?:mini|preview)\b/i);
    }
  });

  it('is English only, with no non-ASCII letters (FR-025, SC-012)', () => {
    for (const text of texts()) {
      // Typographic punctuation is fine; letters outside ASCII are not.
      const foreignLetters = text.replace(/[ -⁯←-⇿─-╿]/g, '').match(/[^\x00-\x7F]/g);
      expect(foreignLetters).toBeNull();
    }
  });

  it('states the retirement of the QA scan and the security audit (FR-016, US2-5)', () => {
    for (const text of texts()) {
      expect(text).toMatch(/QA scan/i);
      expect(text).toMatch(/security audit/i);
      expect(text).toMatch(/no longer offered/i);
    }
  });
});

describe('the version is derived from the text, not maintained (FR-026)', () => {
  it('has the declared shape', () => {
    expect(INSTRUCTION_VERSION).toMatch(/^v1-[0-9a-f]{8}$/);
  });

  it('DIFFERS from the pre-feature value, because 005 added behavioural sections (005 FR-028)', () => {
    /*
     * FR-028 satisfied STRUCTURALLY rather than by discipline. No task in this feature bumps the
     * version: adding `language` (and `attribution`) to `BEHAVIOURAL` changes it automatically,
     * because it is a hash of the section text. This asserts the mechanism actually fired — a
     * change that added the rules but somehow left the version alone would mean stored turns claim
     * rules they were not run under, which is undetectable by reading either file.
     */
    expect(INSTRUCTION_VERSION).not.toBe(PRE_FEATURE_INSTRUCTION_VERSION);
    expect(INSTRUCTION_VERSION).toMatch(/^v1-[0-9a-f]{8}$/);
  });

  it('is stable across calls and across input combinations', () => {
    expect(composeInstructions(baseInputs()).version).toBe(INSTRUCTION_VERSION);
    for (const inputs of allCombinations()) {
      // The install description is EXCLUDED from the hash, so a per-install fact cannot churn it.
      expect(composeInstructions(inputs).version).toBe(INSTRUCTION_VERSION);
    }
  });

  it('DIFFERS when a single character of a section text changes', () => {
    const a = deriveVersion([['role', 'You are the content assistant.']]);
    const b = deriveVersion([['role', 'You are the content assistant!']]);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1-[0-9a-f]{8}$/);
    expect(b).toMatch(/^v1-[0-9a-f]{8}$/);
  });

  it('DIFFERS when two sections are reordered, because order is part of the contract', () => {
    const a = deriveVersion([
      ['role', 'one'],
      ['discovery', 'two'],
    ]);
    const b = deriveVersion([
      ['discovery', 'two'],
      ['role', 'one'],
    ]);
    expect(a).not.toBe(b);
  });
});
