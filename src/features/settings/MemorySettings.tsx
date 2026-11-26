import { useCallback, useEffect, useState } from 'react'
import {
  type AgentMemory,
  getAgentMemory,
  openExplorer,
  openWorkspaceFile,
  revealWorkspaceFile,
  saveAgentMemory,
} from '../../api.ts'

function folderOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, '')
}

/**
 * Settings → Memory: the agent's long-term memory, which every session reads with every message,
 * and the skills it has learned. Pi adds to both when asked ("remember that…", "save this as a
 * skill"); here the user can read, correct and extend them by hand.
 */
export function MemorySettings() {
  const [memory, setMemory] = useState<AgentMemory | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const dirty = memory !== null && draft !== memory.content

  const load = useCallback(async (keepDraft: boolean): Promise<void> => {
    const next = await getAgentMemory()
    setMemory(next)
    if (!keepDraft) setDraft(next.content)
  }, [])

  useEffect(() => {
    load(false).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause))
    )
  }, [load])

  async function act(action: () => Promise<void>, done = ''): Promise<void> {
    setError('')
    setNotice('')
    try {
      await action()
      if (done) setNotice(done)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function save(): Promise<void> {
    if (!memory) return
    setSaving(true)
    await act(async () => {
      // Pi may have added to the memory while this was open; never overwrite that unseen.
      // The version this edit started from stays the reference, so Save keeps refusing until the
      // user reloads and sees what Pi wrote.
      const current = await getAgentMemory()
      if (current.content !== memory.content) {
        throw new Error(
          'Pi changed the memory while you were editing, so nothing was saved. Your text is still here: copy what you need, then press Reload to load Pi\'s version and add your changes again.',
        )
      }
      await saveAgentMemory(draft)
      await load(false)
    }, 'Saved. Every chat uses it from its next message.')
    setSaving(false)
  }

  if (!memory) {
    return (
      <section className='memory-settings'>
        <p>{error || 'Reading the memory…'}</p>
      </section>
    )
  }

  return (
    <section className='memory-settings'>
      <p>
        Pi's long-term memory is shared by every chat, new and old, in every project, and is read
        with every message. Ask in any chat: “Remember that I prefer short answers”, or after a
        task: “Save how we did this as a skill.” You can also edit it here.
      </p>
      {(notice || error) && (
        <p className={error ? 'model-settings-error' : 'model-settings-notice'} role='status'>
          {error || notice}
        </p>
      )}

      <h3>Memory</h3>
      <p className='settings-hint memory-path'>
        <code>{memory.path}</code>
      </p>
      <textarea
        aria-label='Memory'
        className='memory-editor'
        onChange={(event) => setDraft(event.target.value)}
        placeholder={memory.template}
        spellCheck
        value={draft}
      />
      <div className='model-actions'>
        <button
          className='primary'
          disabled={!dirty || saving}
          onClick={() => void save()}
          type='button'
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button disabled={!dirty} onClick={() => setDraft(memory.content)} type='button'>
          Undo changes
        </button>
        <button
          onClick={() => {
            if (dirty && !window.confirm('Discard your unsaved changes and load the saved memory?'))
              return
            void act(() => load(false))
          }}
          title='Load the saved memory, including anything Pi added since this tab opened'
          type='button'
        >
          Reload
        </button>
        {!memory.content && !draft && (
          <button onClick={() => setDraft(memory.template)} type='button'>
            Start from the template
          </button>
        )}
      </div>

      <h3>Skills</h3>
      <p className='settings-hint'>
        Procedures Pi can follow again, each a <code>SKILL.md</code> in{' '}
        <code>{memory.skillsPath}</code>. Every chat sees a new skill from its next message, and can
        run one directly as <code>/skill:name</code> after Reload.
      </p>
      {memory.skills.length === 0
        ? <p className='memory-empty'>No skills yet.</p>
        : (
          <ul className='memory-skills'>
            {memory.skills.map((skill) => (
              <li key={skill.path}>
                <div>
                  <strong>{skill.name}</strong>
                  <span>{skill.description}</span>
                </div>
                <div className='model-actions'>
                  <button
                    onClick={() =>
                      void act(() => openWorkspaceFile(folderOf(skill.path), skill.path))}
                    type='button'
                  >
                    Open
                  </button>
                  <button
                    onClick={() =>
                      void act(() => revealWorkspaceFile(folderOf(skill.path), skill.path))}
                    type='button'
                  >
                    Show in folder
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      <div className='model-actions'>
        <button
          onClick={() => void act(() => openExplorer(memory.skillsPath))}
          type='button'
        >
          Open skills folder
        </button>
      </div>
    </section>
  )
}
