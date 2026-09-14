import { isOverBudget, isWrapUpCall, WRAP_UP_NOTE } from './turn-budget';
import { MODEL_CALL_LIMIT, RECURSION_LIMIT_BACKSTOP } from './agent';

/**
 * The per-turn work budget (005 contracts/turn-budget.md §5).
 *
 * WHAT A TEST CAN AND CANNOT CARRY HERE. Whether the wrap-up READS WELL is model behaviour, and
 * model behaviour is never asserted in a test (Principle V) — that is a panel check. WHICH CALL gets
 * the note, and whether the two limits are consistent, are arithmetic, and arithmetic is exactly
 * what belongs here.
 */

describe('the invariant that catches the FR-045 regression', () => {
  /**
   * This is the one-line test the contract singles out, and it is worth saying why so plainly.
   *
   * `recursionLimit` counts LangGraph SUPER-STEPS: one ReAct iteration is a model node plus a tool
   * node, so preserving N model calls needs more than `2N + 1` super-steps. If the two constants
   * drift apart — someone raises the model-call ceiling and leaves the backstop where it was — the
   * BACKSTOP becomes the thing that cuts a turn short, which is the precise failure FR-045's second
   * sentence names. Nothing else in the suite would notice, because both numbers are individually
   * plausible.
   */
  it('RECURSION_LIMIT_BACKSTOP exceeds 2 x MODEL_CALL_LIMIT + 1', () => {
    expect(RECURSION_LIMIT_BACKSTOP).toBeGreaterThan(2 * MODEL_CALL_LIMIT + 1);
  });

  it('both limits are positive integers', () => {
    for (const value of [MODEL_CALL_LIMIT, RECURSION_LIMIT_BACKSTOP]) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });

  it('leaves room for the turn FR-045 names, plus a clarifying exchange', () => {
    // discover, retrieve a briefing section, search, read, describe structure, propose, reply —
    // seven calls with no ambiguity, no permission denial and no retry. The ceiling must exceed
    // that, or the requirement that prompted raising it is not actually met.
    const MINIMUM_TURN = 7;
    expect(MODEL_CALL_LIMIT).toBeGreaterThan(MINIMUM_TURN);
  });
});

describe('the wrap-up predicate over a matrix of counts and limits', () => {
  it('reserves EXACTLY the last allowed call, at every limit', () => {
    for (let limit = 1; limit <= 20; limit += 1) {
      for (let calls = 0; calls <= limit + 3; calls += 1) {
        expect(isWrapUpCall(calls, limit)).toBe(calls === limit - 1);
      }
    }
  });

  it('reserves exactly ONE call per turn, never two', () => {
    for (let limit = 1; limit <= 20; limit += 1) {
      const reserved = Array.from({ length: limit + 4 }, (_, calls) => isWrapUpCall(calls, limit));
      expect(reserved.filter(Boolean)).toHaveLength(1);
    }
  });

  it('at the shipped limit, reserves the twelfth call and no earlier one', () => {
    expect(isWrapUpCall(MODEL_CALL_LIMIT - 1, MODEL_CALL_LIMIT)).toBe(true);
    for (let calls = 0; calls < MODEL_CALL_LIMIT - 1; calls += 1) {
      expect(isWrapUpCall(calls, MODEL_CALL_LIMIT)).toBe(false);
    }
  });

  it('is total over nonsense, rather than reserving a call that does not exist', () => {
    for (const limit of [0, -1, NaN, Infinity]) {
      for (const calls of [0, 1, NaN, Infinity, -1]) {
        expect(isWrapUpCall(calls, limit)).toBe(false);
      }
    }
  });
});

describe('the hard stop', () => {
  it('holds at and beyond the limit, never before it', () => {
    for (let limit = 1; limit <= 20; limit += 1) {
      for (let calls = 0; calls <= limit + 3; calls += 1) {
        expect(isOverBudget(calls, limit)).toBe(calls >= limit);
      }
    }
  });

  it('catches a count that overshot, rather than letting the turn run on', () => {
    // `>=`, not `===`. A predicate that only matched the exact value would let an overshoot through.
    expect(isOverBudget(MODEL_CALL_LIMIT + 5, MODEL_CALL_LIMIT)).toBe(true);
  });

  it('never fires on the call the wrap-up is reserved for', () => {
    // The two predicates must not overlap, or the reserved wrap-up would be cut off before it ran —
    // and the whole mechanism for FR-046 would be dead code.
    for (let limit = 1; limit <= 20; limit += 1) {
      for (let calls = 0; calls <= limit + 3; calls += 1) {
        expect(isWrapUpCall(calls, limit) && isOverBudget(calls, limit)).toBe(false);
      }
    }
  });

  it('is total over nonsense', () => {
    for (const limit of [0, -1, NaN, Infinity]) {
      expect(isOverBudget(5, limit)).toBe(false);
    }
    expect(isOverBudget(NaN, 12)).toBe(false);
  });
});

describe('WRAP_UP_NOTE — the same rules every instruction text follows', () => {
  it('is English, with no non-ASCII letters (FR-007)', () => {
    const foreignLetters = WRAP_UP_NOTE.replace(/[ -⁯]/g, '').match(/[^\x00-\x7F]/g);
    expect(foreignLetters).toBeNull();
  });

  it('contains no model identifier (CLAUDE.md)', () => {
    expect(WRAP_UP_NOTE).not.toMatch(/claude-[a-z0-9]/i);
    expect(WRAP_UP_NOTE).not.toMatch(/gpt-[0-9]/i);
    expect(WRAP_UP_NOTE).not.toMatch(/gemini-[0-9]/i);
    expect(WRAP_UP_NOTE).not.toMatch(/\bo[0-9]-(?:mini|preview)\b/i);
  });

  it('asks for what was completed AND what was not — not a bare limit notice (FR-046)', () => {
    // FR-046 is explicit that "a bare statement that a limit was reached is not sufficient". The
    // note is the only thing standing between this path and exactly that.
    expect(WRAP_UP_NOTE).toMatch(/what you completed/i);
    expect(WRAP_UP_NOTE).toMatch(/did NOT finish/i);
    expect(WRAP_UP_NOTE).toMatch(/ask for next/i);
  });

  it('tells the model it has no tools left, so it answers rather than reaching for another step', () => {
    expect(WRAP_UP_NOTE).toMatch(/NO FURTHER TOOL CALLS/);
  });

  it('never lets the wrap-up claim something was applied', () => {
    // The plugin's whole guarantee is that nothing is written until the editor approves. A turn
    // ending under pressure is exactly where a model is most likely to round that off.
    expect(WRAP_UP_NOTE).toMatch(/Do not claim anything was applied/i);
  });

  it('names no content type, field or consuming project', () => {
    expect(WRAP_UP_NOTE).not.toMatch(/api::/);
    expect(WRAP_UP_NOTE).not.toMatch(/Concept Bath/i);
  });

  it('does not say which language to answer in — that is the `language` section’s job', () => {
    // Deliberate: the note says "in their language" and stops. Restating the precedence rules here
    // would be a second copy of the language section, in a file that would never be updated with it.
    expect(WRAP_UP_NOTE).not.toMatch(/Ukrainian|Russian|English only/);
  });
});
