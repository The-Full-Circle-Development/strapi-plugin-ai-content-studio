import * as React from 'react';
import { Paperclip, ArrowUp, Stop, Cross } from '@strapi/icons';
import { styled } from 'styled-components';
import { Column, IconButton } from './styles';

/** The input surface: text, held attachments, attach / send / stop. Owns no chat state. */

const ComposerWrap = styled.div`
  padding: 0.5rem 1.5rem 1.5rem;
`;

const Box = styled.div`
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  background: ${({ theme }) => theme.colors.neutral0};
  border-radius: 1.6rem;
  padding: 0.8rem 0.8rem 0.6rem;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  transition: border-color 120ms ease, box-shadow 120ms ease;
  &:focus-within {
    border-color: ${({ theme }) => theme.colors.primary600};
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.1);
  }
`;

const Thumbs = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  padding: 0.2rem 0.4rem 0.6rem;
`;

const Chip = styled.div<{ $invalid?: boolean }>`
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  max-width: 22rem;
  padding: 0.4rem 2rem 0.4rem 0.4rem;
  border-radius: 0.6rem;
  border: 1px solid
    ${({ theme, $invalid }) => ($invalid ? theme.colors.danger500 : theme.colors.neutral200)};
  background: ${({ theme, $invalid }) =>
    $invalid ? theme.colors.danger100 : theme.colors.neutral100};
`;

const Thumb = styled.div`
  flex: 0 0 auto;
  width: 3.2rem;
  height: 3.2rem;
  border-radius: 0.4rem;
  overflow: hidden;
  background: ${({ theme }) => theme.colors.neutral150};
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
`;

const FileGlyph = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
  font-weight: 600;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.neutral600};
`;

const ChipText = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
`;

const ChipName = styled.span`
  font-size: 1.15rem;
  color: ${({ theme }) => theme.colors.neutral800};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ChipMeta = styled.span<{ $invalid?: boolean }>`
  font-size: 1.05rem;
  color: ${({ theme, $invalid }) => ($invalid ? theme.colors.danger600 : theme.colors.neutral600)};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const extensionOf = (filename: string): string => {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).slice(0, 4) : 'file';
};

const ThumbRemove = styled.button`
  position: absolute;
  top: 0.2rem;
  right: 0.2rem;
  width: 1.7rem;
  height: 1.7rem;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  svg {
    width: 0.9rem;
    height: 0.9rem;
  }
  svg path {
    fill: #fff;
  }
`;

const Editor = styled.textarea`
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: ${({ theme }) => theme.colors.neutral800};
  font-family: inherit;
  font-size: 1.4rem;
  line-height: 1.5;
  padding: 0.6rem 0.6rem 0.2rem;
  max-height: 18rem;
  &::placeholder {
    color: ${({ theme }) => theme.colors.neutral500};
  }
`;

const Bar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.2rem 0.2rem 0;
`;

const SendButton = styled(IconButton)`
  border: none;
  background: ${({ theme }) => theme.colors.primary600};
  color: #fff;
  svg path {
    fill: #fff;
  }
  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.primary700};
  }
  &:disabled {
    background: ${({ theme }) => theme.colors.neutral200};
  }
`;

const Hint = styled.div`
  text-align: center;
  font-size: 1.1rem;
  color: ${({ theme }) => theme.colors.neutral500};
  margin-top: 0.6rem;
`;

export interface ComposerAttachment {
  ordinal: number;
  file: File;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  validation: 'ok' | 'too-large' | 'over-budget' | 'rejected';
  validationMessage?: string;
}

export interface ComposerProps {
  input: string;
  onInputChange: (value: string) => void;
  attachments: ComposerAttachment[];
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (ordinal: number) => void;
  busy: boolean;
  disabled?: boolean;
  canSend: boolean;
  onSend: () => void;
  onStop: () => void;
  hint?: React.ReactNode;
}

export const Composer = ({
  input,
  onInputChange,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  busy,
  disabled = false,
  canSend,
  onSend,
  onStop,
  hint,
}: ComposerProps) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const editorRef = React.useRef<HTMLTextAreaElement>(null);

  // Object-URL thumbnails for image chips (revoked on change/unmount). Non-images get no preview,
  // which is fine — a PDF is identified by its ordinal and name, which is what placement uses.
  const [previews, setPreviews] = React.useState<Record<number, string>>({});
  React.useEffect(() => {
    const urls: Record<number, string> = {};
    for (const attachment of attachments) {
      if (attachment.mimeType.startsWith('image/')) {
        urls[attachment.ordinal] = URL.createObjectURL(attachment.file);
      }
    }
    setPreviews(urls);
    return () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
  }, [attachments]);

  const autoGrow = React.useCallback(() => {
    const el = editorRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 288)}px`;
    }
  }, []);
  React.useEffect(() => {
    autoGrow();
  }, [input, autoGrow]);

  const onPasteImages = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items;
    if (!items) {
      return;
    }
    const images: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const ext = (file.type.split('/')[1] || 'png').replace('+xml', '');
          images.push(
            file.name && file.name !== 'image.png'
              ? file
              : new File([file], `pasted-${images.length + 1}.${ext}`, { type: file.type })
          );
        }
      }
    }
    if (images.length > 0) {
      event.preventDefault();
      onAddFiles(images);
    }
  };

  return (
    <ComposerWrap>
      <Column>
        <Box>
          {/*
            Held files, with the ordinal, the filename and any rejection reason shown BEFORE the
            message is sent (FR-032). Nothing is uploaded here: the bytes stay in the browser until
            the user approves a plan that ingests them (FR-033).
          */}
          {attachments.length > 0 ? (
            <Thumbs>
              {attachments.map((attachment) => (
                <Chip key={attachment.ordinal} $invalid={attachment.validation !== 'ok'}>
                  <Thumb>
                    {previews[attachment.ordinal] ? (
                      <img src={previews[attachment.ordinal]} alt={attachment.filename} />
                    ) : (
                      <FileGlyph>{extensionOf(attachment.filename)}</FileGlyph>
                    )}
                  </Thumb>
                  <ChipText>
                    <ChipName title={attachment.filename}>
                      #{attachment.ordinal} {attachment.filename}
                    </ChipName>
                    <ChipMeta $invalid={attachment.validation !== 'ok'}>
                      {attachment.validation === 'ok'
                        ? `${Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB · not uploaded yet`
                        : (attachment.validationMessage ?? 'This file cannot be attached.')}
                    </ChipMeta>
                  </ChipText>
                  <ThumbRemove
                    type="button"
                    aria-label={`Remove ${attachment.filename}`}
                    onClick={() => onRemoveAttachment(attachment.ordinal)}
                  >
                    <Cross />
                  </ThumbRemove>
                </Chip>
              ))}
            </Thumbs>
          ) : null}

          <Editor
            ref={editorRef}
            rows={1}
            value={input}
            placeholder="How can I help with your content?"
            onChange={(e) => onInputChange(e.target.value)}
            onInput={autoGrow}
            onPaste={onPasteImages}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
          />

          <Bar>
            <IconButton
              type="button"
              aria-label="Attach file"
              title="Attach a file — it is held here, not uploaded"
              disabled={busy || disabled}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip />
            </IconButton>

            {busy ? (
              <IconButton type="button" aria-label="Stop" title="Stop" onClick={onStop}>
                <Stop />
              </IconButton>
            ) : (
              <SendButton
                type="button"
                aria-label="Send"
                title="Send"
                disabled={!canSend}
                onClick={onSend}
              >
                <ArrowUp />
              </SendButton>
            )}
          </Bar>

          {/* Any type the host's Media Library accepts (FR-032) — not just images. */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(event) => {
              const list = event.target.files;
              if (list && list.length > 0) {
                onAddFiles(Array.from(list));
              }
              event.target.value = '';
            }}
          />
        </Box>
        <Hint>{hint ?? 'AI Content Studio can edit live content — review important changes.'}</Hint>
      </Column>
    </ComposerWrap>
  );
};

export default Composer;
