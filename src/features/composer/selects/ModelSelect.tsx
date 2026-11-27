import { memo, useState, type RefObject } from 'react'
import type { JsonObject } from '../../../../shared/types.ts'
import { ComposerSelect } from './ComposerSelect.tsx'

/** Selects the active LLM model from Pi's available models, issuing a set_model command on change. */
export const ModelSelect = memo(function ModelSelect(
  { models, currentModel, onCommand, onError, open, onOpenChange, triggerRef }: {
    models: JsonObject[]
    currentModel: string
    onCommand: (command: JsonObject) => Promise<JsonObject>
    onError: (cause: unknown) => void
    open: boolean
    onOpenChange: (open: boolean) => void
    triggerRef: RefObject<HTMLButtonElement | null>
  },
) {
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(
        window.localStorage.getItem('pi-kazecraft.favorite-models') ?? '[]',
      ) as string[]
    } catch {
      return []
    }
  })
  const toggleFavorite = (value: string) => {
    const next = favorites.includes(value)
      ? favorites.filter((favorite) => favorite !== value)
      : [...favorites, value]
    setFavorites(next)
    window.localStorage.setItem('pi-kazecraft.favorite-models', JSON.stringify(next))
  }
  const orderedModels = [...models].sort((a, b) => {
    const aId = `${a.provider}/${a.id}`
    const bId = `${b.provider}/${b.id}`
    return Number(bId === currentModel) - Number(aId === currentModel)
      || Number(favorites.includes(bId)) - Number(favorites.includes(aId))
  })

  return (
    <ComposerSelect
      ariaLabel='Model'
      onOpenChange={onOpenChange}
      open={open}
      onValueChange={(value) => {
        const selected = models.find((item) => `${item.provider}/${item.id}` === value)
        if (selected)
          void onCommand({
            type: 'set_model',
            provider: selected.provider,
            modelId: selected.id,
          })
            .catch(onError)
      }}
      onToggleFavorite={toggleFavorite}
      options={orderedModels.map((item) => ({
        // Several providers resell the same model IDs, so the name alone cannot
        // identify the endpoint that will bill the request.
        description: String(item.provider),
        favorite: favorites.includes(`${item.provider}/${item.id}`),
        label: String(item.name ?? item.id),
        value: `${item.provider}/${item.id}`,
      }))}
      placeholder='Choose a model'
      tone='model'
      triggerRef={triggerRef}
      value={currentModel}
    />
  )
})
