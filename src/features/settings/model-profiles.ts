/**
 * What each local model is and what it is good at, for Settings → Models. Keyed by
 * "provider/model id" as in Pi's models.json. Speeds were measured on this PC (RTX 3080 10 GB,
 * i9-9900K, 32 GB RAM) on 2026-11-26; a model added later shows its basics without a profile.
 */
export interface ModelProfile {
  /** One line under the name. */
  summary: string
  bestFor: string[]
  details: { label: string; value: string }[]
}

export const modelProfiles: Readonly<Record<string, ModelProfile>> = {
  'polystrata/gemma-4-26b-a4b-ud-q4_k_m': {
    summary:
      'Google\'s Gemma 4: a mixture-of-experts model with 26 billion parameters, of which about 4 billion work on each word. The everyday chat model.',
    bestFor: [
      'Conversation, writing and rewriting',
      'Explaining and summarizing long documents',
      'Looking at pictures you attach',
      'Thinking a problem through before answering',
    ],
    details: [
      {
        label: 'Engine',
        value: 'PolyStrata (strata-poly), experts split between the card and RAM',
      },
      { label: 'Speed', value: 'about 80 to 100 tok/s on short replies, 40 to 60 in long chats' },
      { label: 'Reading a prompt', value: 'about 1,700 tokens per second' },
      { label: 'Loading', value: 'about 15 to 25 s when switched in' },
      { label: 'Pictures', value: 'yes, read by an image encoder on the CPU' },
    ],
  },
  'bonsai/bonsai-2.5-27b': {
    summary:
      'PrismML\'s Ternary Bonsai 2.5: a 27-billion-parameter model stored in under 2 bits per weight (ternary), so all of it fits on the graphics card. The coding model.',
    bestFor: [
      'Writing, fixing and explaining code',
      'Agent work in Pi: reading files, running commands, editing projects',
      'Fast, steady replies',
      'Looking at screenshots you attach',
    ],
    details: [
      { label: 'Engine', value: 'llama.cpp (PrismML build) with MTP drafting, all on the card' },
      { label: 'Speed', value: 'about 100 to 130 tok/s on short replies' },
      { label: 'Reading a prompt', value: 'about 1,000 to 1,200 tokens per second' },
      { label: 'Loading', value: 'about 10 s when switched in' },
      { label: 'Pictures', value: 'yes, through a vision projector on the CPU' },
    ],
  },
}
