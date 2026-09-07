#!/usr/bin/env node
/**
 * SessionStart hook — injects this repository's standing rule about model identifiers, plus the
 * catalog as it exists on disk right now, before the first prompt of every session.
 *
 * Why this exists: model identifiers are the one class of string in this repo that cannot be
 * recalled correctly. Lineups change faster than any training cutoff, and a wrong id is not a
 * compile error — it is a dropdown entry that fails on every send, with the provider's error
 * redacted by design. CLAUDE.md states the rule durably; this hook restates it with the *live*
 * list attached, so it stays accurate as the catalog changes and stays near the point of use in a
 * long session.
 *
 * Design constraints:
 *  - Node built-ins only. No dependency resolution, no compile step — this must work in a fresh
 *    clone before `pnpm install`, and must not perceptibly delay session start.
 *  - The catalog is PARSED from admin/src/data/models.ts, never copied here. A second copy of the
 *    list would be a second thing to keep current, which is the drift this whole feature prevents.
 *  - It must NEVER fail a session. Any error — missing file, unparseable map, unexpected throw —
 *    exits 0 and emits the standing rule alone with a one-line note. A hook that throws on a
 *    malformed file would block every session in the repository: strictly worse than the drift it
 *    prevents. The rule is the load-bearing half; the catalog is the convenience half.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Hard cap on additionalContext. The catalog is truncated to fit; the rule never is. */
const MAX_CONTEXT_CHARS = 10000;

/** Resolved from this file's own location, so the hook works regardless of cwd. */
const CATALOG_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'admin', 'src', 'data', 'models.ts');
const CATALOG_REL = 'admin/src/data/models.ts';

/**
 * The standing rule. Deliberately contains NO model identifiers — enumerating them here would be
 * exactly the second copy the rule forbids.
 */
const STANDING_RULE = [
  '# Standing rule: model identifiers are never written from memory',
  '',
  'In this repository, a model identifier is only ever written after being verified against the',
  "provider's own current catalog **in this session** — its live model docs or its /models response.",
  'Not from memory, not from a previous session, not from this repo\'s git history. Model lineups',
  'change faster than any training cutoff, and a wrong id is not a compile error: it is a dropdown',
  "entry that fails on every send in a customer's admin panel, with the provider's error redacted by",
  'design. An identifier that cannot be verified does not ship.',
  '',
  `**${CATALOG_REL} is the single source of truth** for the curated list.`,
  'Do not copy identifiers into docs, prompts, tests, or instructions — point at that file instead.',
  'The list is curated and hardcoded by design; it is never fetched from a provider /models endpoint.',
  '',
  'A change to that file moves the README and the committed `dist/` **in the same commit**',
  '(`corepack pnpm@10 run build`), with `corepack pnpm@10 run typecheck` and',
  '`corepack pnpm@10 run test` clean. The suite covers pure functions only and never calls a',
  'provider, so it does NOT verify an identifier: that is still one live send per changed provider',
  'in a running Strapi admin panel.',
].join('\n');

/**
 * Extracts per-provider identifier groups from the MODELS object literal by reading the file as
 * text. Deliberately not a TypeScript parser — see the design constraints above. This couples the
 * hook to the file's formatting, which is why that formatting is written down as a contract in the
 * doc comment above MODELS.
 *
 * @returns {Array<{provider: string, models: Array<{id: string, label: string}>}>}
 * @throws if the MODELS literal cannot be found or yields no entries.
 */
function parseCatalog(source) {
  const start = source.indexOf('export const MODELS');
  if (start === -1) {
    throw new Error('MODELS literal not found');
  }

  const groups = [];
  let current = null;

  for (const line of source.slice(start).split('\n')) {
    // A bare provider key opening an array: `anthropic: [`
    const providerMatch = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*\[/);
    if (providerMatch) {
      current = { provider: providerMatch[1], models: [] };
      groups.push(current);
      continue;
    }
    // A single-line entry: `{ id: '…', label: '…' },`
    const entryMatch = line.match(/\{\s*id:\s*'([^']+)'\s*,\s*label:\s*'([^']*)'\s*\}/);
    if (entryMatch && current) {
      current.models.push({ id: entryMatch[1], label: entryMatch[2] });
    }
  }

  const populated = groups.filter((g) => g.models.length > 0);
  if (populated.length === 0) {
    throw new Error('MODELS literal parsed to zero entries');
  }
  return populated;
}

function renderCatalog(groups) {
  const lines = [`# Curated model catalog (read from ${CATALOG_REL} just now)`, ''];
  for (const { provider, models } of groups) {
    lines.push(`## ${provider}`);
    for (const { id, label } of models) {
      lines.push(`- ${id} — ${label}`);
    }
    lines.push('');
  }
  lines.push('This is the list as it exists on disk at session start, not a remembered one. It is the');
  lines.push('set an administrator can choose from — a saved install may legitimately hold any other id');
  lines.push('the provider accepts, so never treat this as an allow-list.');
  return lines.join('\n');
}

/** Emits the payload and exits 0. Never throws. */
function emit(additionalContext) {
  const capped =
    additionalContext.length <= MAX_CONTEXT_CHARS
      ? additionalContext
      : `${additionalContext.slice(0, MAX_CONTEXT_CHARS - 80).trimEnd()}\n\n[catalog truncated to fit the context budget — read ${CATALOG_REL}]`;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: capped,
      },
    })
  );
}

try {
  let catalogSection;
  try {
    const source = readFileSync(CATALOG_PATH, 'utf8');
    catalogSection = renderCatalog(parseCatalog(source));
  } catch {
    // Missing file, unparseable map — the rule still stands, and the session still starts.
    catalogSection = `_Note: the current catalog could not be read from ${CATALOG_REL}, so it is omitted here. The rule above still applies — verify every identifier against the provider's live catalog, and read that file directly for the current list._`;
  }

  // The rule is assembled first and never truncated; only the catalog is allowed to lose bytes.
  const room = MAX_CONTEXT_CHARS - STANDING_RULE.length - 2;
  const fittedCatalog =
    catalogSection.length <= room
      ? catalogSection
      : `${catalogSection.slice(0, Math.max(0, room - 80)).trimEnd()}\n\n[catalog truncated — read ${CATALOG_REL}]`;

  emit(`${STANDING_RULE}\n\n${fittedCatalog}`);
} catch {
  // Last resort: never let this hook fail a session.
  try {
    emit(STANDING_RULE);
  } catch {
    /* give up silently — a missing reminder is survivable, a blocked session is not */
  }
}

process.exit(0);
