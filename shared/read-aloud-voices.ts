export const voices = [
  { value: 'af_heart', label: 'Heart', description: 'American English' },
  { value: 'bf_isabella', label: 'Isabella', description: 'British English' },
  { value: 'am_puck', label: 'Puck', description: 'American English' },
  { value: 'bm_fable', label: 'Fable', description: 'British English' },
] as const

export type ReadAloudVoice = typeof voices[number]['value']
export const defaultVoice = voices[0].value
export function isReadAloudVoice(value: unknown): value is ReadAloudVoice {
  return voices.some(voice => voice.value === value)
}
