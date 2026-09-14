import { createMiddleware } from 'langchain';
import { z } from 'zod';

/**
 * The per-turn work budget (005 contracts/turn-budget.md).
 *
 * WHY THIS REPLACES A SHIPPED MIDDLEWARE, stated here because replacing library code is the kind of
 * decision that looks like reinvention until you read why.
 *
 * `modelCallLimitMiddleware`'s `exitBehavior: 'end'` path appends `new AIMessage(error.message)`,
 * where the message is built inside the middleware as
 * `Model call limits exceeded: run level call limit reached with <n> model calls` — hard-coded
 * English, with no option to supply a message and no detail about what the turn actually completed.
 * Its whole option surface is `{ threadLimit?, runLimit?, exitBehavior? }`. Both verified in the
 * installed `langchain@1.5.10` (`dist/agents/middleware/modelCallLimit.js`).
 *
 * FR-006 (every editor-visible product string in the editor's language) and FR-046 (a cut-short turn
 * says what it completed and what it did not) therefore cannot be met by configuring it. They are
 * met by RESERVING THE FINAL ALLOWED CALL for a wrap-up the MODEL writes — which obeys the
 * `language` instruction section and so arrives in the editor's language with no server-side
 * catalogue, in every language the active model writes.
 *
 * THIS IS STILL THE LIBRARY'S OWN FACTORY. `createMiddleware` is exported from the `langchain`
 * package root and is the documented way to write a middleware; nothing here is hand-rolled onto
 * LangGraph. The state schema, the `beforeModel` / `afterModel` / `afterAgent` shapes and the
 * `{ jumpTo: 'end' }` exit all mirror the shipped middleware, so the spend bound is unchanged in
 * kind — only the message at the end of it is ours.
 *
 * VERIFIED AGAINST THE INSTALLED PACKAGE before a line was written against it (standing rule 6).
 * In `langchain@1.5.10`:
 *   - `createMiddleware({ name, stateSchema, wrapModelCall, beforeModel, afterModel, afterAgent })`
 *     (`dist/agents/middleware.d.ts`);
 *   - `ModelRequest` declares `tools`, `toolChoice` and `systemMessage` as writable fields, and the
 *     package's own example for extending a system message is
 *     `systemMessage: request.systemMessage.concat("something")` — exactly the shape §3.1 uses
 *     (`dist/agents/nodes/types.d.ts`);
 *   - `BeforeModelHook` accepts `{ canJumpTo, hook }` and a hook may return
 *     `{ jumpTo: 'end' }` with no messages (`MiddlewareResult`, `dist/agents/middleware/types.d.ts`);
 *   - `stateSchema` accepts a zod v4 object (`InteropZodObject = ZodV3ObjectLike | ZodV4ObjectLike`
 *     in `@langchain/core@1.2.9`), so this uses the repository's one zod rather than a second copy.
 */

/* ------------------------------------------------------------- the pure predicates */

/**
 * Is this the call that must be spent wrapping up?
 *
 * TRUE ON THE LAST ALLOWED CALL — when the count of calls already made is one below the limit. That
 * call still happens and still costs what it was always going to cost; what changes is that it is
 * handed no tools, so the model answers instead of reaching for another step.
 *
 * Pure and exported so the suite can drive it across a matrix of counts and limits. Model behaviour
 * is never asserted in a test, but WHICH CALL gets the note is arithmetic, and arithmetic is exactly
 * what a test should carry.
 */
export const isWrapUpCall = (modelCalls: number, limit: number): boolean =>
  Number.isFinite(modelCalls) && Number.isFinite(limit) && limit > 0 && modelCalls === limit - 1;

/**
 * Has the budget been spent entirely?
 *
 * `>=` rather than `===` deliberately: a count that somehow overshot must still stop, and a
 * predicate that only catches the exact value would let it run on.
 */
export const isOverBudget = (modelCalls: number, limit: number): boolean =>
  Number.isFinite(modelCalls) && Number.isFinite(limit) && limit > 0 && modelCalls >= limit;

/**
 * What the model is told on the reserved final call.
 *
 * ENGLISH ASCII INSTRUCTION TEXT, like every other instruction this plugin writes (FR-007) — and it
 * names no model identifier, for the same reason `prompt.ts` names none. The REPLY it produces is
 * in the editor's language, because the `language` section governs everything the model writes;
 * that is the whole mechanism, and it is why no catalogue is needed here.
 *
 * It asks for three things, and the second is the one FR-046 turns on: a bare statement that a limit
 * was reached is explicitly not sufficient.
 */
export const WRAP_UP_NOTE = [
  'This turn has reached its limit on tool use, so NO FURTHER TOOL CALLS ARE AVAILABLE to you in',
  'this turn. Do not attempt one, and do not ask to.',
  'Answer now with what you already have. Tell the editor, in their language:',
  '1. what you completed in this turn, naming the specific things you found or proposed;',
  '2. what you had started or intended and did NOT finish;',
  '3. what they should ask for next to continue from here.',
  'Do not claim anything was applied, written or published. If you recorded a plan, it is still',
  'waiting for their approval in the panel.',
].join('\n');

/* ---------------------------------------------------------------- the middleware */

/**
 * Mirrors the shipped middleware's state exactly, so the counting semantics an operator may already
 * reason about are unchanged: `runModelCallCount` resets per agent run, `threadModelCallCount` does
 * not.
 */
const stateSchema = z.object({
  threadModelCallCount: z.number().default(0),
  runModelCallCount: z.number().default(0),
});

/** What the hard stop recorded, for the typed notice the admin renders (contracts/language.md §4). */
export interface TurnLimitStop {
  modelCalls: number;
  limit: number;
}

export interface TurnBudget {
  /** Hand to `createAgent({ middleware: [...] })`. */
  middleware: ReturnType<typeof createMiddleware>;
  /**
   * The hard stop, or null when the turn ended any other way.
   *
   * Read by the chat controller AFTER the stream has drained, which is why this is a mutable
   * signal rather than a return value: the middleware runs inside the graph, and the one place that
   * reliably runs after it is the stream transform's flush — the same seam `data-interrupted`
   * already uses.
   */
  stopped: () => TurnLimitStop | null;
}

/**
 * Build the budget for ONE REQUEST.
 *
 * Per-request like the agent that carries it: the middleware closes over a signal object belonging
 * to this turn, so nothing holds one across requests or users.
 */
export const createTurnBudget = ({ runLimit }: { runLimit: number }): TurnBudget => {
  let stop: TurnLimitStop | null = null;

  const middleware = createMiddleware({
    name: 'AiStudioTurnBudget',
    stateSchema,

    /**
     * §3.1 — the final allowed call is reserved for a wrap-up.
     *
     * What this buys, and it is the entire reason for the replacement:
     *   - the explanation is PROSE THE MODEL WRITES, so it obeys the `language` section and arrives
     *     in the editor's language with no server-side catalogue (FR-006, SC-001);
     *   - it can name what the turn actually completed, because the model has the turn's own tool
     *     results in front of it (FR-046);
     *   - it costs NOTHING EXTRA: the call was already inside the budget.
     *
     * `tools: []` with `toolChoice: 'none'` together, not either alone: an empty tool list is what
     * removes the option, and `'none'` is what says so to a provider that would otherwise see the
     * change as an error.
     */
    wrapModelCall: async (request, handler) => {
      const modelCalls = Number(request.state?.runModelCallCount ?? 0);
      if (!isWrapUpCall(modelCalls, runLimit)) {
        return handler(request);
      }
      return handler({
        ...request,
        tools: [],
        toolChoice: 'none',
        systemMessage: request.systemMessage.concat(`\n\n${WRAP_UP_NOTE}`),
      });
    },

    /**
     * §3.2 — the hard stop, a backstop to the backstop.
     *
     * Reachable ONLY if the reserved wrap-up call above itself failed. It ends the turn the same way
     * the shipped middleware does, so the spend bound is unchanged — but it appends NO English
     * prose. The notice is emitted as a typed `data-turn-limit` part instead and rendered by the
     * admin in the admin's own locale (contracts/language.md §4), because product copy with no model
     * turn in front of it cannot be localized any other way.
     */
    beforeModel: {
      canJumpTo: ['end'],
      hook: (state) => {
        const modelCalls = Number(state?.runModelCallCount ?? 0);
        if (isOverBudget(modelCalls, runLimit)) {
          stop = { modelCalls, limit: runLimit };
          return { jumpTo: 'end' as const };
        }
        return undefined;
      },
    },

    afterModel: (state) => ({
      runModelCallCount: state.runModelCallCount + 1,
      threadModelCallCount: state.threadModelCallCount + 1,
    }),

    afterAgent: () => ({ runModelCallCount: 0 }),
  });

  return { middleware, stopped: () => stop };
};
