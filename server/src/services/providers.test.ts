import { PROVIDER_DESCRIPTORS, PROVIDER_IDS, getDescriptor } from './providers';

/**
 * The declared image-input rules (FR-006, contracts/provider-layer.md §3).
 *
 * THIS IS THE SUITE THAT MAKES FINDING U1 IMPOSSIBLE TO REINTRODUCE. A descriptor silently
 * reverted to bare default-deny passes every NEGATIVE check — the images are just quietly withheld
 * from models that could have read them — so only the POSITIVE cases below catch it. That is why
 * each rule asserts both directions.
 *
 * NO REAL MODEL IDENTIFIER APPEARS HERE, deliberately. The rules are prefixes and shapes, so the
 * fixtures are synthetic strings exercising those shapes. Asserting against real identifiers would
 * make this suite rot every time a provider's catalog moved, and would put a second copy of the
 * curated list here — which CLAUDE.md forbids.
 */

const vision = (id: string, model: string): boolean => {
  const descriptor = getDescriptor(id);
  if (!descriptor) {
    throw new Error(`no descriptor for "${id}"`);
  }
  return descriptor.supportsVision(model);
};

describe('the provider table', () => {
  it('ships exactly the four documented providers, ids unique', () => {
    expect(PROVIDER_IDS).toEqual(['anthropic', 'openai', 'google', 'openai-compatible']);
    expect(new Set(PROVIDER_IDS).size).toBe(PROVIDER_IDS.length);
  });

  it('requires a base URL for the compatible endpoint and for nothing else', () => {
    const requiring = PROVIDER_DESCRIPTORS.filter((p) => p.requiresBaseUrl).map((p) => p.id);
    expect(requiring).toEqual(['openai-compatible']);
  });

  it('gives every descriptor an English label and a constructor', () => {
    for (const descriptor of PROVIDER_DESCRIPTORS) {
      expect(typeof descriptor.label).toBe('string');
      expect(descriptor.label.trim()).not.toBe('');
      expect(typeof descriptor.create).toBe('function');
    }
  });

  it('returns null for an id the distribution does not carry (FR-011)', () => {
    expect(getDescriptor('not-a-shipped-provider')).toBeNull();
    expect(getDescriptor(null)).toBeNull();
    expect(getDescriptor(undefined)).toBeNull();
  });
});

describe('supportsVision — rule 1: anthropic accepts the claude- prefix', () => {
  it.each(['claude-a', 'claude-b-1', 'CLAUDE-UPPERCASE'])('accepts %s', (model) => {
    expect(vision('anthropic', model)).toBe(true);
  });

  it.each(['claude', 'notclaude-a', 'gemini-a', 'gpt-4a', ''])('denies %s', (model) => {
    expect(vision('anthropic', model)).toBe(false);
  });
});

describe('supportsVision — rule 2: google accepts the gemini- prefix', () => {
  it.each(['gemini-a', 'gemini-b-lite', 'GEMINI-UPPERCASE'])('accepts %s', (model) => {
    expect(vision('google', model)).toBe(true);
  });

  it.each(['gemini', 'notgemini-a', 'claude-a', 'gpt-5a', ''])('denies %s', (model) => {
    expect(vision('google', model)).toBe(false);
  });
});

describe('supportsVision — rule 3: openai families minus its two exclusions', () => {
  it.each(['gpt-4a', 'gpt-4', 'gpt-5a', 'gpt-5', 'o1', 'o3-x', 'o9z', 'GPT-4-UPPERCASE'])(
    'accepts %s',
    (model) => {
      expect(vision('openai', model)).toBe(true);
    }
  );

  // Exclusion A: the older 3.5 line, even though it shares the gpt- stem.
  it.each(['gpt-3.5', 'gpt-3.5-x', 'GPT-3.5-UPPERCASE'])('denies the 3.5 line: %s', (model) => {
    expect(vision('openai', model)).toBe(false);
  });

  // Exclusion B: the non-text families. Each must be denied even when it carries an accepted
  // family prefix, which is why the exclusions are tested BEFORE the positive rule in the code.
  it.each([
    'embedding-x',
    'gpt-4-embedding',
    'tts-x',
    'gpt-4-tts',
    'whisper-x',
    'gpt-4-whisper',
    'moderation-x',
    'gpt-4-moderation',
    'audio-x',
    'gpt-4-audio',
    'realtime-x',
    'gpt-4-realtime',
    'o1-audio',
  ])('denies the non-text family: %s', (model) => {
    expect(vision('openai', model)).toBe(false);
  });

  it.each(['gpt-2', 'davinci', 'claude-a', 'gemini-a', 'o', 'ox', ''])(
    'denies unrelated shape %s',
    (model) => {
      expect(vision('openai', model)).toBe(false);
    }
  );
});

describe('supportsVision — rule 4: openai-compatible never claims vision', () => {
  it.each([
    'claude-a',
    'gemini-a',
    'gpt-4a',
    'gpt-5a',
    'o1',
    'anything',
    '',
    'a-model-that-really-does-see-images',
  ])('denies %s', (model) => {
    // The plugin cannot know what an arbitrary endpoint accepts, and a wrong `true` sends image
    // bytes to a model that rejects them and fails the WHOLE request. Placement by filename still
    // works, which is the graceful degradation Principle III requires.
    expect(vision('openai-compatible', model)).toBe(false);
  });
});

describe('supportsVision — every descriptor answers without throwing', () => {
  it('returns a boolean for every provider and every shape, including junk', () => {
    for (const descriptor of PROVIDER_DESCRIPTORS) {
      for (const model of ['', 'x', 'claude-a', 'gpt-4a', 'gemini-a', '../../etc', '🙂']) {
        expect(typeof descriptor.supportsVision(model)).toBe('boolean');
      }
    }
  });
});
