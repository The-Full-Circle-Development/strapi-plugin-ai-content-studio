import * as React from 'react';
import { Field, SingleSelect, SingleSelectOption } from '@strapi/design-system';
import type { ChatMode } from '../hooks/useThreads';

/**
 * The conversation's mode (FR-027, FR-028). Content Editing is the default for a new thread; the
 * choice is visible, persists with the thread, and constrains what the assistant can do.
 *
 * Built from `@strapi/design-system` v2 — no new UI dependency.
 */

export const MODE_LABELS: Record<ChatMode, string> = {
  content: 'Content Editing',
  layout: 'Layout Mapping',
  audit: 'Code Audit',
};

const MODE_HINTS: Record<ChatMode, string> = {
  content: 'Propose text, media and publish changes for your approval.',
  layout: 'Map page sections and place media into the slots that exist.',
  audit: 'Read-only. QA and security findings; no content change is possible.',
};

export interface ModeSelectProps {
  mode: ChatMode;
  onChange: (mode: ChatMode) => void;
  disabled?: boolean;
}

export const ModeSelect = ({ mode, onChange, disabled = false }: ModeSelectProps) => (
  <Field.Root hint={MODE_HINTS[mode]}>
    <Field.Label>Mode</Field.Label>
    <SingleSelect
      value={mode}
      disabled={disabled}
      onChange={(value: string | number) => onChange(String(value) as ChatMode)}
    >
      {(Object.keys(MODE_LABELS) as ChatMode[]).map((value) => (
        <SingleSelectOption key={value} value={value}>
          {MODE_LABELS[value]}
        </SingleSelectOption>
      ))}
    </SingleSelect>
    <Field.Hint />
  </Field.Root>
);

export default ModeSelect;
