import { useSyncExternalStore } from 'react'
import { voices } from '../../../../shared/read-aloud-voices.ts'
import { readVoice, selectVoice, subscribeVoice } from '../../conversation/voice-preference.ts'
import { ComposerSelect } from './ComposerSelect.tsx'

export function VoiceSelect() {
  const voice = useSyncExternalStore(subscribeVoice, readVoice)
  const name = voices.find(option => option.value === voice)?.label
  return (
    <ComposerSelect
      ariaLabel={`Read aloud voice · ${name}`}
      heading='Read aloud voice'
      tone='voice'
      value={voice}
      options={voices}
      onValueChange={selectVoice}
    />
  )
}
