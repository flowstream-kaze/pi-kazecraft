import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  addMemoryNote,
  editMemory,
  frontmatter,
  listSkills,
  looksLikeSecret,
  maxPromptMemoryChars,
  memoryForPrompt,
  readMemory,
  saveSkill,
  validSkillName,
  writeMemory,
} from '../pi-extensions/memory-store.ts'

const temporaryAgentDir = () => mkdtemp(join(tmpdir(), 'kazecraft-memory-'))

test('the first note starts the memory from the template, under its section', async () => {
  const dir = await temporaryAgentDir()
  assert.equal(await readMemory(dir), '')
  await addMemoryNote('Prefers British spelling.', 'Preferences', dir)
  await addMemoryNote('Uses an RTX 3080 10 GB.', 'Setup', dir)
  await addMemoryNote('Likes short answers.', 'preferences', dir)
  const memory = await readMemory(dir)
  assert.match(memory, /^# Memory/)
  const preferences = memory.split('## Preferences')[1].split('## Setup')[0]
  assert.equal(preferences.trim(), '- Prefers British spelling.\n- Likes short answers.')
  assert.match(memory.split('## Setup')[1], /^\n\n- Uses an RTX 3080 10 GB\.\n/)
})

test('a note for a new section adds that section at the end', async () => {
  const dir = await temporaryAgentDir()
  await writeMemory('# Memory\n\n## Notes\n\n- one\n', dir)
  await addMemoryNote('Kokoro voice is Kate.', 'Voice', dir)
  assert.equal(
    await readMemory(dir),
    '# Memory\n\n## Notes\n\n- one\n\n## Voice\n\n- Kokoro voice is Kate.\n',
  )
})

test('edit_memory replaces one exact passage and removes whole lines cleanly', async () => {
  const dir = await temporaryAgentDir()
  await writeMemory('# Memory\n\n## Notes\n\n- keep this\n- drop this\n- and this\n', dir)
  await editMemory('keep this', 'keep that', dir)
  await editMemory('drop this', '', dir)
  assert.equal(await readMemory(dir), '# Memory\n\n## Notes\n\n- keep that\n- and this\n')
  await assert.rejects(editMemory('missing', 'x', dir), /not in the memory/)
  await writeMemory('## A\n\n- only entry\n\n## B\n', dir)
  await editMemory('only entry', '', dir)
  assert.equal(await readMemory(dir), '## A\n\n## B\n', 'no blank lines pile up')
  await writeMemory('- same\n- same\n', dir)
  await assert.rejects(editMemory('same', 'x', dir), /more than once/)
})

test('skills are saved in Pi format, listed, and never replaced by accident', async () => {
  const dir = await temporaryAgentDir()
  const path = await saveSkill({
    name: 'weekly-report',
    description: 'Builds the weekly report: "sales" and costs. Use every Monday.',
    instructions: '1. Read the sheet.\n2. Write the report.',
  }, dir)
  const content = await readFile(path, 'utf8')
  assert.deepEqual(frontmatter(content), {
    name: 'weekly-report',
    description: 'Builds the weekly report: "sales" and costs. Use every Monday.',
  })
  assert.match(content, /\n\n1\. Read the sheet\.\n2\. Write the report\.\n$/)
  await assert.rejects(
    saveSkill({ name: 'weekly-report', description: 'x', instructions: 'y' }, dir),
    /exists already/,
  )
  await saveSkill(
    { name: 'weekly-report', description: 'New', instructions: 'z', overwrite: true },
    dir,
  )
  assert.deepEqual((await listSkills(dir)).map((skill) => [skill.name, skill.description]), [
    ['weekly-report', 'New'],
  ])
  for (const name of ['Weekly', 'a--b', '-a', 'a_b', '', 'x'.repeat(65)]) {
    assert.equal(validSkillName(name), false, name)
  }
})

test('secrets are refused, ordinary notes about passwords are not', async () => {
  const dir = await temporaryAgentDir()
  for (
    const secret of [
      'The Wi-Fi password is hunter22',
      'API key: abc123def456',
      'Token = sk-proj-ABCDEFGHIJKLMNOPQRSTUV',
      'GitHub token ghp_ABCDEFGHIJKLMNOPQRSTUVWX123456',
      'AWS key AKIAABCDEFGHIJKLMNOP',
    ]
  ) {
    assert.equal(looksLikeSecret(secret), true, secret)
    await assert.rejects(addMemoryNote(secret, 'Notes', dir), /Secrets are not kept/)
  }
  for (
    const fine of [
      'The user keeps passwords in a password manager.',
      'The user prefers short answers.',
      'Skills are stored in ~/.pi/agent/skills.',
    ]
  ) assert.equal(looksLikeSecret(fine), false, fine)
})

test('a very long memory is cut for the prompt with a note', () => {
  const long = 'x'.repeat(maxPromptMemoryChars + 10)
  const prompt = memoryForPrompt(long)
  assert.ok(prompt.startsWith('x'.repeat(maxPromptMemoryChars)))
  assert.match(prompt, /The memory continues/)
  assert.equal(memoryForPrompt('  short  '), 'short')
})
