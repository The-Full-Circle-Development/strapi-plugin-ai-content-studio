import { createAgent } from 'langchain';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import type { ClientTool, ServerTool } from '@langchain/core/tools';
import type { Core } from '@strapi/strapi';
import { createTurnBudget } from './turn-budget';

/**
 * Builds and runs the per-request agent (contracts/chat-stream.md §5).
 *
 * WHY AN INSTANCE AND NOT A STRING: `createAgent`'s `model` option accepts either a string
 * identifier or a chat-model instance, and only the STRING branch resolves through
 * `initChatModel`, whose runtime dynamic import esbuild cannot bundle (research D2). Passing the
 * instance the provider table built keeps every provider inside the committed `dist/`, which is
 * Principle IV. So the instance branch is a hard requirement here, not a style choice.
 *
 * CORRECTED AGAINST THE INSTALLED PACKAGE. `plan.md` and research D1 specify
 * `createAgent({ llm, tools, prompt })`, quoting an `options.llm` / `options.prompt` pair. Neither
 * option exists in `langchain@1.5.10` as installed: `CreateAgentParams` declares
 * `model: string | AgentLanguageModelLike` (types.d.ts:422) and `systemPrompt?: string |
 * SystemMessage` (types.d.ts:514), and a grep for `llm?:` / `prompt?:` across
 * `dist/agents/*.d.ts` returns nothing. The design intent is unchanged — an instance still bypasses
 * `initChatModel` — but the call shape is the installed one. This is exactly what T015's
 * "re-read after the install" instruction was for.
 *
 * LangChain's `tool-approval-request` / `tool-approval-response` human-in-the-loop mechanism is
 * DELIBERATELY UNUSED. Approval in this plugin is structural: the model can only record a pending
 * plan, and the sole write path is the editor's click on `POST /change-sets/:id/apply`. Routing
 * approval through the model's own loop would move a guarantee out of deterministic server code and
 * into model behaviour.
 */

/**
 * The ceiling on model calls (005 FR-045, contracts/turn-budget.md §1).
 *
 * RAISED FROM 8 TO 12, because requiring a briefing retrieval before any briefing-derived claim
 * added a round trip to ordinary turns. The turn FR-045 names — discover, retrieve a briefing
 * section, read an entry, propose a change — is at minimum `listContentTypes`,
 * `getContentBriefing`, `searchEntries`, `getEntry`, `describePageStructure`, `proposeChanges` and a
 * closing reply: seven model calls with no ambiguity, no permission denial and no retry. Eight left
 * no room at all. Twelve leaves room for one clarifying exchange and still bounds spend at a number
 * an operator can reason about.
 *
 * EXPORTED so the suite can assert its invariant against the backstop below. The two numbers
 * drifting apart is exactly how a turn gets cut short by the wrong limit, and that is a one-line
 * test rather than a thing to remember.
 *
 * CORRECTION TO THIS FILE'S OWN HISTORY. The previous comment here recorded the shipped
 * `modelCallLimitMiddleware`'s synthetic English `AIMessage` as intended behaviour — "it is why the
 * limit reads as an explanation rather than as a truncation". Feature 005 makes that a defect: the
 * message is hard-coded English an editor working in another language cannot read, and it says only
 * that a limit was reached, never what the turn completed. See `turn-budget.ts`, which replaces it.
 */
export const MODEL_CALL_LIMIT = 12;

/**
 * A BACKSTOP, not the mechanism — and it MOVES WITH the ceiling above (FR-045).
 *
 * `recursionLimit` counts LangGraph super-steps, so one ReAct iteration is a model node plus a tool
 * node: preserving twelve model calls needs more than `2 x 12 + 1 = 25`. Leaving this at 25 while
 * raising the ceiling would have made the BACKSTOP the thing that cuts a turn short, which is
 * precisely the failure FR-045's second sentence names — "where more than one such limit exists,
 * they MUST be raised together, so that none of them cuts a turn short ahead of the one intended to
 * bound it."
 *
 * Its original job is unchanged: guard a loop that never reaches a model node. It can still never
 * burn provider tokens past `MODEL_CALL_LIMIT`.
 */
export const RECURSION_LIMIT_BACKSTOP = 40;

/**
 * The LangGraph stream mode this plugin uses, and the contract names it rather than leaving it to
 * whichever call shape lands first (research D17, contracts/chat-stream.md §6).
 *
 * `['values', 'messages']` is what makes the bridge emit the FULL tool lifecycle —
 * `tool-input-start`, `tool-input-delta`, `tool-input-available`, `tool-output-available`,
 * `tool-output-error`. Consumed through `agent.streamEvents()` instead, the bridge emits only
 * `tool-input-start` and `tool-output-available`, so tool INPUTS would never reach the UI or
 * storage: the change-plan card keys on `output.changeSetId` and would survive, but every tool pill
 * would lose its arguments. (`streamEvents` is additionally documented in the installed package as
 * legacy and "should not be used for new user-facing agent streaming".)
 */
const STREAM_MODE = ['values', 'messages'] as const;

export interface RunTurnOptions {
  /** The chat-model instance from `registry.getActiveModel()`. */
  model: BaseChatModel;
  /** The per-request tool set, rebuilt from the caller's live ability. */
  tools: (ClientTool | ServerTool)[];
  /** The composed instruction text from `prompt.build()`. */
  systemPrompt: string;
  messages: BaseMessage[];
  /** Wired to the Koa request lifecycle, so a stop releases the SERVER's work (FR-025). */
  signal: AbortSignal;
}

const agentService = ({ strapi: _strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Build and run the agent for one turn, returning the LangGraph stream the bridge converts into
   * UI message chunks, alongside the turn-budget's hard-stop signal.
   *
   * Building and running are one method on purpose: the agent is per-request — it closes over the
   * caller's live ability through its tools — so nothing should hold one across requests or users,
   * and there is no reason to hand one out.
   */
  async run({ model, tools, systemPrompt, messages, signal }: RunTurnOptions) {
    /**
     * The plugin's own budget, built PER REQUEST so its hard-stop signal belongs to this turn
     * (contracts/turn-budget.md §3). It replaces `modelCallLimitMiddleware`, whose English synthetic
     * message no configuration could reach — the reasoning is in `turn-budget.ts`.
     */
    const budget = createTurnBudget({ runLimit: MODEL_CALL_LIMIT });

    const agent = createAgent({
      model,
      tools,
      systemPrompt,
      middleware: [budget.middleware],
    });

    // `agent.stream()` returns a Promise, so it is awaited before the stream is merged.
    const stream = await agent.stream(
      { messages },
      {
        signal,
        streamMode: [...STREAM_MODE],
        recursionLimit: RECURSION_LIMIT_BACKSTOP,
      }
    );

    /**
     * The stop signal travels back with the stream rather than being returned from it, because the
     * middleware runs inside the graph and the only place that reliably runs after it is the
     * controller's stream-transform flush — the same seam `data-interrupted` already uses.
     */
    return { stream, turnLimitStop: budget.stopped };
  },
});

export default agentService;
