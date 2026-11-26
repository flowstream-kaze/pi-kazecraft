import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { AttachmentError, saveAttachment } from '../server/features/attachments/attachments.ts'
import {
  isDocumentAttachment,
  isImageAttachment,
  messageWithAttachments,
  safeAttachmentName,
} from '../shared/attachments.ts'

test('tells images and readable documents apart', () => {
  assert.equal(isImageAttachment({ name: 'a.png', type: 'image/png' }), true)
  assert.equal(isImageAttachment({ name: 'a.svg', type: 'image/svg+xml' }), false)
  assert.equal(isDocumentAttachment('Report.PDF'), true)
  assert.equal(isDocumentAttachment('notes.docx'), true)
  assert.equal(isDocumentAttachment('budget.xlsx'), true)
  assert.equal(isDocumentAttachment('old.doc'), false)
  assert.equal(isDocumentAttachment('setup.exe'), false)
})

test('makes uploaded names safe for any file system', () => {
  assert.equal(safeAttachmentName('..\\..\\evil.pdf'), 'evil.pdf')
  assert.equal(safeAttachmentName('a/b/c.docx'), 'c.docx')
  assert.equal(safeAttachmentName('what?<now>.csv'), 'what__now_.csv')
  assert.equal(safeAttachmentName('CON.txt'), 'attachment-CON.txt')
  assert.equal(safeAttachmentName(''), 'attachment')
  assert.equal(
    isDocumentAttachment('.pdf'),
    false,
    'a bare ".pdf" is a hidden file with no type, so it is refused first',
  )
  assert.equal(safeAttachmentName('trailing. '), 'trailing')
})

test('adds the saved paths under the message', () => {
  assert.equal(messageWithAttachments('Summarize this', []), 'Summarize this')
  assert.equal(
    messageWithAttachments('Summarize this', ['C:\\w\\a.pdf']),
    'Summarize this\n\nAttached file:\n- C:\\w\\a.pdf',
  )
  assert.equal(
    messageWithAttachments('', ['/w/a.pdf', '/w/b.xlsx']),
    'Attached files:\n- /w/a.pdf\n- /w/b.xlsx',
  )
})

test('saves into the attachment folder without overwriting an earlier upload', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'attachments-'))
  const first = await saveAttachment(workspace, 'report.pdf', Readable.from([Buffer.from('one')]))
  const second = await saveAttachment(workspace, 'report.pdf', Readable.from([Buffer.from('two')]))
  assert.equal(first, join(workspace, '.pi-attachments', 'report.pdf'))
  assert.equal(second, join(workspace, '.pi-attachments', 'report (2).pdf'))
  assert.equal(await readFile(first, 'utf8'), 'one')
  assert.equal(await readFile(second, 'utf8'), 'two')
  assert.equal(await readFile(join(workspace, '.pi-attachments', '.gitignore'), 'utf8'), '*\n')
})

test('refuses unreadable types, empty files and oversized uploads, leaving nothing behind', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'attachments-'))
  await assert.rejects(
    saveAttachment(workspace, 'tool.exe', Readable.from([Buffer.from('x')])),
    (error) => error instanceof AttachmentError && error.status === 415,
  )
  await assert.rejects(
    saveAttachment(workspace, 'empty.txt', Readable.from([])),
    (error) => error instanceof AttachmentError && error.status === 400,
  )
  await assert.rejects(
    saveAttachment(workspace, 'big.pdf', Readable.from([Buffer.from('x')]), 26 * 1024 * 1024),
    (error) => error instanceof AttachmentError && error.status === 413,
  )
  const chunk = Buffer.alloc(1024 * 1024)
  await assert.rejects(
    saveAttachment(
      workspace,
      'streamed.pdf',
      Readable.from(Array.from({ length: 26 }, () => chunk)),
    ),
    (error) => error instanceof AttachmentError && error.status === 413,
  )
  assert.deepEqual((await readdir(join(workspace, '.pi-attachments'))).sort(), ['.gitignore'])
})
