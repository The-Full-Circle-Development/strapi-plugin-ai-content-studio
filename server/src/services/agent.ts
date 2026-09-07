import { createAgent, modelCallLimitMiddleware } from 'langchain';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import type { ClientTool, ServerTool } from '@langchain/core/tools';
import type { Core } from '@strapi/strapi';

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
 * The ceiling on model calls, unchanged in effect from the `stopWhen: stepCountIs(8)` it replaces.
 *
 * `modelCallLimitMiddleware` counts MODEL CALLS — the same thing `stepCountIs(8)` counted — so
 * there is no super-step arithmetic to get wrong, and `exitBehavior: 'end'` ends the turn cleanly
 * instead of raising a `GraphRecursionError` mid-stream that the editor would see.
 *
 * Verified against `node_modules/langchain/dist/agents/middleware/modelCallLimit.d.ts` after the
 * install: `{ threadLimit?, runLimit?, exitBehavior?: 'error' | 'end' }`, exported from the package
 * root. Note the `'end'` path appends a synthetic English `AIMessage` naming the limit, which
 * streams to the client and is persisted — that is intended, and it is why the limit reads as an
 * explanation rather than as a truncation.
 */
const MODEL_CALL_LIMIT = 8;

/**
 * A BACKSTOP, not the mechanism.
 *
 * `recursionLimit` counts LangGraph super-steps, so one ReAct iteration is a model node plus a tool
 * node and preserving 8 model calls would have meant `2 x 8 + 1 = 17`. That arithmetic is exactly
 * what made the old number fragile. With the middleware carrying the real ceiling, this only has to
 * guard a loop that never reaches a model node, so it is set generously above 17: it can never burn
 * provider tokens past `MODEL_CALL_LIMIT`, and it will not silently truncate a turn that needed
 * several discovery calls before proposing.
 */
const RECURSION_LIMIT_BACKSTOP = 25;

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
   * UI message chunks.
   *
   * Building and running are one method on purpose: the agent is per-request — it closes over the
   * caller's live ability through its tools — so nothing should hold one across requests or users,
   * and there is no reason to hand one out.
   */
  async run({ model, tools, systemPrompt, messages, signal }: RunTurnOptions) {
    const agent = createAgent({
      model,
      tools,
      systemPrompt,
      middleware: [
        modelCallLimitMiddleware({ runLimit: MODEL_CALL_LIMIT, exitBehavior: 'end' }),
      ],
    });

    // `agent.stream()` returns a Promise, so it is awaited before the stream is merged.
    return agent.stream(
      { messages },
      {
        signal,
        streamMode: [...STREAM_MODE],
        recursionLimit: RECURSION_LIMIT_BACKSTOP,
      }
    );
  },
});

export default agentService;
