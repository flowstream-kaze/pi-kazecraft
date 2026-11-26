import assert from 'node:assert/strict'
import { mkdtemp, realpath, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { isProjectFolder, projectDirectory, validProjectName } from '../server/project-directory.ts'

test('only folders inside the projects root count as deletable project folders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kazecraft-projects-'))
  const outside = await mkdtemp(join(tmpdir(), 'kazecraft-outside-'))
  try {
    const project = await projectDirectory('Essay', root)
    assert.equal(await isProjectFolder(project, root), true)
    assert.equal(await isProjectFolder(root, root), false, 'the root itself')
    assert.equal(await isProjectFolder(outside, root), false, 'a folder added from elsewhere')
    assert.equal(await isProjectFolder(join(root, 'missing'), root), false, 'a missing folder')
    await rmdir(project)
  } finally {
    await rmdir(root)
    await rmdir(outside)
  }
})

test('sessions with the same project name reuse its working folder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kazecraft-project-'))
  try {
    const project = await projectDirectory('Project One', root)
    assert.equal(project, join(await realpath(root), 'Project One'))
    assert.equal(await projectDirectory('Project One', root), project)
    await rmdir(project)
  } finally {
    await rmdir(root)
  }
})

test('a project name is a single valid folder name', () => {
  for (const name of ['', '.', '..', '../escape', 'bad\\name', 'CON.txt', 'D:drive', 'end.']) {
    assert.equal(validProjectName(name), false, name)
  }
  assert.equal(validProjectName('Design notes'), true)
})
