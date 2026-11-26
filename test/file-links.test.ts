import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { findMentionedFiles } from '../server/features/file-links/file-links.ts'
import { isRunnableFile } from '../server/system-integration.ts'
import { looksLikeFileMention } from '../src/features/conversation/file-mentions.ts'

test('inline code that could name a file', () => {
  for (
    const text of [
      'thanos_empire.md',
      'docs/notes.txt',
      'C:\\Users\\Kat\\report.docx',
      ' a b.xlsx ',
    ]
  ) {
    assert.equal(looksLikeFileMention(text), true, text)
  }
  for (
    const text of [
      'npm run dev',
      'https://example.com/file.md',
      '\\\\server\\share\\file.txt',
      'multi\nline.md',
      'no-extension',
      '',
    ]
  ) assert.equal(looksLikeFileMention(text), false, JSON.stringify(text))
})

test('only mentioned files that exist are returned, relative to the chat folder or absolute', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'kazecraft-files-'))
  await writeFile(join(cwd, 'thanos_empire.md'), '# story')
  await mkdir(join(cwd, 'docs'))
  await writeFile(join(cwd, 'docs', 'notes.txt'), 'notes')
  const absolute = join(cwd, 'docs', 'notes.txt')
  const found = await findMentionedFiles(cwd, [
    'thanos_empire.md',
    'docs/notes.txt',
    absolute,
    'missing.md',
    'docs',
    '\\\\server\\share\\file.txt',
  ])
  assert.deepEqual(found.map((file) => file.text), ['thanos_empire.md', 'docs/notes.txt', absolute])
  assert.equal(found[0].path, join(cwd, 'thanos_empire.md'))
})

test('programs and scripts are recognised so a click never runs them', () => {
  for (const path of ['C:\\a\\setup.exe', 'run.BAT', 'x.ps1', 'y.vbs', 'z.lnk']) {
    assert.equal(isRunnableFile(path), true, path)
  }
  for (const path of ['story.md', 'sheet.xlsx', 'C:\\folder.exe\\notes.txt', 'noext']) {
    assert.equal(isRunnableFile(path), false, path)
  }
})
