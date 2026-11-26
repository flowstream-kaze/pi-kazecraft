/**
 * Read aloud voices, all from Kokoro-82M. Each value names its engine and speaker
 * ("kokoro:af_heart"), which keeps saved choices valid if another engine is added again.
 */
export const engines = {
  kokoro: 'Kokoro-82M',
} as const

export type ReadAloudEngine = keyof typeof engines

const speakers = [
  { id: 'af_heart', label: 'Heart', accent: 'American English' },
  { id: 'bf_isabella', label: 'Isabella', accent: 'British English' },
  { id: 'am_puck', label: 'Puck', accent: 'American English' },
  { id: 'bm_fable', label: 'Fable', accent: 'British English' },
] as const

export type ReadAloudVoice = `${ReadAloudEngine}:${string}`

/**
 * Kate: Kokoro's bf_emma and bf_lily style banks averaged 50/50, the blend from the lucia-voice
 * repo. Only the name shown is different; the value stays, so saved choices still match.
 */
export const kateVoice = 'kokoro:bf_emma50_lily50' satisfies ReadAloudVoice

export const voices: readonly { value: ReadAloudVoice; label: string; description: string }[] = [
  { value: kateVoice, label: 'Kate', description: 'British English · Emma and Lily blend' },
  ...speakers.map((speaker) => ({
    value: `kokoro:${speaker.id}` as const,
    label: speaker.label,
    description: speaker.accent,
  })),
]

export const defaultVoice: ReadAloudVoice = kateVoice

export function isReadAloudVoice(value: unknown): value is ReadAloudVoice {
  return voices.some((voice) => voice.value === value)
}

/** Splits "kokoro:af_heart" into its engine and speaker. */
export function voiceParts(voice: ReadAloudVoice): { engine: ReadAloudEngine; speaker: string } {
  const [engine, speaker] = voice.split(':') as [ReadAloudEngine, string]
  return { engine, speaker }
}
