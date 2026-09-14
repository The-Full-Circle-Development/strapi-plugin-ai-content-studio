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

const baseInputs = (overrides: Partial<InstructionInputs> = {}): InstructionInputs => ({
  supportsVision: true,
  hasAttachments: false,
  groundingEnabled: false,
  readableUids: [],
  schemaFingerprint: 'fp-schema',
  contextSummary: null,
  install: null,
  brief: null,
  ...overrides,
});

/** A brief as the content-brief service assembles one: prose, per content type. */
const BRIEF_TEXT = '- some::uid — "Thing"\n  Holds the things. Most entries fill only the title.';

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
            // The brief is varied alongside `install` rather than in its own suite, so the
            // determinism, ordering and prohibition tests below all exercise it for free — the
            // three selections an administrator can make (schema / brief / both) are exactly the
            // three shapes of this pair.
            for (const brief of [
              null,
              { text: BRIEF_TEXT, partial: false },
              { text: BRIEF_TEXT, partial: true },
            ]) {
              out.push(
                baseInputs({
                  supportsVision,
                  hasAttachments,
                  groundingEnabled,
                  readableUids: groundingEnabled ? ['some::uid'] : [],
                  contextSummary,
                  install,
                  brief,
                })
              );
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

  it('always emits the eight behavioural sections, in order, first', () => {
    const { sections } = composeInstructions(baseInputs());
    expect(sections).toEqual([
      'role',
      'discovery',
      'permissions',
      'ambiguity',
      'proposing',
      'tool-honesty',
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

    // 10a — only when a brief was assembled for this caller and it actually says something.
    expect(has(composeInstructions(baseInputs({ brief: null })).sections, 'brief')).toBe(false);
    expect(
      has(composeInstructions(baseInputs({ brief: { text: BRIEF_TEXT, partial: false } })).sections, 'brief')
    ).toBe(true);
    // An empty or whitespace-only brief is the same as none: an empty delimiter block would tell
    // the model this project has no content, which is a different and false claim.
    expect(
      has(composeInstructions(baseInputs({ brief: { text: '   \n ', partial: false } })).sections, 'brief')
    ).toBe(false);
    // Absent and null are the same input, so every caller written before the brief existed
    // composes byte-identically.
    const withoutKey = baseInputs();
    delete (withoutKey as { brief?: unknown }).brief;
    expect(composeInstructions(withoutKey).text).toBe(
      composeInstructions(baseInputs({ brief: null })).text
    );

    // 11 — only when the thread has a condensed summary.
    expect(has(composeInstructions(baseInputs({ contextSummary: null })).sections, 'condensed')).toBe(false);
    expect(has(composeInstructions(baseInputs({ contextSummary: 'x' })).sections, 'condensed')).toBe(true);
  });
});

/**
 * The brief is model-written prose about real content sitting in a prompt beside schema facts that
 * are true by construction. Everything asserted here is about keeping those two apart.
 */
describe('the content brief section (contracts/content-brief.md §3)', () => {
  const brief = { text: BRIEF_TEXT, partial: false };
  const install = { text: '#### Content types\n- a::a — "A" (collection)', partial: false };

  it('is delimited, so prose can never be mistaken for an instruction', () => {
    const { text } = composeInstructions(baseInputs({ brief }));
    expect(text).toContain('<content-brief>');
    expect(text).toContain('</content-brief>');
    expect(text).toContain(BRIEF_TEXT);
  });

  it('states that it is neither authoritative nor current, and that tools win', () => {
    const { text } = composeInstructions(baseInputs({ brief }));
    expect(text).toMatch(/NOT authoritative/);
    expect(text).toMatch(/THE TOOL RESULT WINS/);
    // The one mistake that would actually corrupt a proposal: taking a field name from prose.
    expect(text).toMatch(/NEVER take a field name/);
  });

  it('grants no permission, in its own words', () => {
    const { text } = composeInstructions(baseInputs({ brief }));
    expect(text).toMatch(/GRANTS NO PERMISSION/);
  });

  it('says so when it was shortened to fit its budget', () => {
    expect(composeInstructions(baseInputs({ brief: { text: BRIEF_TEXT, partial: true } })).text).toMatch(
      /briefing is PARTIAL/
    );
    expect(composeInstructions(baseInputs({ brief })).text).not.toMatch(/briefing is PARTIAL/);
  });

  it('places the schema facts BEFORE the prose when both are carried', () => {
    const { text, sections } = composeInstructions(
      baseInputs({ groundingEnabled: true, readableUids: ['a::a'], install, brief })
    );
    expect(sections.indexOf('install')).toBeLessThan(sections.indexOf('brief'));
    expect(text.indexOf('<install-structure>')).toBeLessThan(text.indexOf('<content-brief>'));
  });

  it('carries the brief alone when no description was rendered — the `brief` selection', () => {
    const { sections } = composeInstructions(
      baseInputs({ groundingEnabled: true, readableUids: ['a::a'], install: null, brief })
    );
    expect(sections).toContain('brief');
    expect(sections).not.toContain('install');
  });

  it('does NOT change the instruction version — it is per-install fact, not a rule', () => {
    // The same reason the install description is excluded from the hash (research D10): a version
    // that differed between two installs running identical rules would identify nothing.
    expect(composeInstructions(baseInputs({ brief })).version).toBe(
      composeInstructions(baseInputs({ brief: null })).version
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
