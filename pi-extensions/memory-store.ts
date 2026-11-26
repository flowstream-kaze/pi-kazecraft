/**
 * The agent's global memory: one Markdown file of facts and preferences (`MEMORY.md`) and a folder
 * of skills in Pi's own format (`skills/<name>/SKILL.md`), both in Pi's agent folder so every
 * session, new or old and in any project, shares them. Used by the memory extension (the agent's
 * tools and the per-message prompt section) and by kazecraft's Settings → Memory tab.
 */
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent')
}

export function memoryPath(dir = agentDir()): string {
  return join(dir, 'MEMORY.md')
}

export function skillsDir(dir = agentDir()): string {
  return join(dir, 'skills')
}

/** The memory sent with every message; a longer file is cut here with a note. */
export const maxPromptMemoryChars = 20_000
/** The whole file, as the Settings tab or a tool may write it. */
export const maxMemoryFileChars = 200_000

export const memoryTemplate = `# Memory

Facts and preferences that apply to every conversation. Pi reads this whole file with every message; keep entries short, correct and current. Procedures belong in skills instead.

## About the user

## Preferences

## Setup

## Notes
`

export async function readMemory(dir = agentDir()): Promise<string> {
  try {
    return await readFile(memoryPath(dir), 'utf8')
  } catch (error) {
    if (isNotFound(error)) return ''
    throw error
  }
}

/** Replaces the memory file, through a temporary file so an interrupted write never halves it. */
export async function writeMemory(content: string, dir = agentDir()): Promise<void> {
  if (content.length > maxMemoryFileChars)
    throw new Error(`Memory is limited to ${maxMemoryFileChars.toLocaleString()} characters`)
  await mkdir(dir, { recursive: true })
  const path = memoryPath(dir)
  const temporary = `${path}.tmp`
  await writeFile(temporary, content.endsWith('\n') ? content : `${content}\n`, 'utf8')
  await rename(temporary, path)
}

/**
 * Adds a bullet at the end of a `## section` of the memory (created when missing), starting the
 * file from the template when there is none yet. Returns the section it went into.
 */
export async function addMemoryNote(
  note: string,
  section = 'Notes',
  dir = agentDir(),
): Promise<string> {
  const text = note.trim().replace(/\s*\n\s*/g, ' ')
  if (!text) throw new Error('The note is empty')
  if (looksLikeSecret(text)) throw new Error(secretRefusal)
  const heading = section.trim().replace(/^#+\s*/, '') || 'Notes'
  const memory = (await readMemory(dir)) || memoryTemplate
  const lines = memory.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((line) =>
    line.trim().toLowerCase() === `## ${heading.toLowerCase()}`
  )
  if (start < 0) {
    while (lines.length && lines.at(-1) === '') lines.pop()
    lines.push('', `## ${heading}`, '', `- ${text}`, '')
  } else {
    let end = lines.findIndex((line, index) => index > start && /^#{1,2}\s/.test(line))
    if (end < 0) end = lines.length
    // After the section's last non-blank line, so bullets stay together.
    let insertAt = end
    while (insertAt - 1 > start && lines[insertAt - 1].trim() === '') insertAt -= 1
    const blankAfterHeading = insertAt === start + 1
    lines.splice(insertAt, 0, ...(blankAfterHeading ? ['', `- ${text}`] : [`- ${text}`]))
  }
  await writeMemory(lines.join('\n'), dir)
  return heading
}

/**
 * Replaces one exact passage of the memory; an empty replacement removes it (with its line when
 * the passage was a whole line). The passage must appear exactly once.
 */
export async function editMemory(
  oldText: string,
  newText: string,
  dir = agentDir(),
): Promise<void> {
  if (!oldText) throw new Error('Say which text to change')
  if (newText && looksLikeSecret(newText)) throw new Error(secretRefusal)
  const memory = await readMemory(dir)
  const first = memory.indexOf(oldText)
  if (first < 0)
    throw new Error('That text is not in the memory; read it again and copy it exactly')
  if (memory.indexOf(oldText, first + 1) >= 0)
    throw new Error('That text appears more than once; include more of it so it is unique')
  let start = first
  let end = first + oldText.length
  if (!newText) {
    // Removing a whole line (a bullet, usually) takes its line break with it.
    const lineStart = memory.lastIndexOf('\n', start - 1) + 1
    const lineEnd = memory.indexOf('\n', end)
    const before = memory.slice(lineStart, start)
    const after = memory.slice(end, lineEnd < 0 ? memory.length : lineEnd)
    if (/^[ \t]*(?:[-*][ \t]+)?$/.test(before) && /^[ \t]*$/.test(after)) {
      start = lineStart
      end = lineEnd < 0 ? memory.length : lineEnd + 1
    }
  }
  let next = memory.slice(0, start) + newText + memory.slice(end)
  // A removed section's last bullet leaves the blank lines around it; keep at most one.
  if (!newText) next = next.replace(/\n{3,}/g, '\n\n')
  await writeMemory(next, dir)
}

const secretRefusal =
  'This looks like a password, key or token. Secrets are not kept in memory: every chat reads it, and it is stored as plain text. Tell the user so.'

/**
 * A backstop for the tools' rule never to store secrets: a password or key given as a value, or a
 * string shaped like a well-known API key or token.
 */
export function looksLikeSecret(text: string): boolean {
  return /\b(password|passcode|passphrase|pin|api[ _-]?key|secret|access[ _-]?token|private key)\b[^.]{0,20}?(\bis\b|=|:)\s*\S/i
    .test(text)
    || /\b(sk|pk|rk)[-_][A-Za-z0-9_-]{16,}/.test(text) // OpenAI, Stripe and similar
    || /\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/.test(text) // GitHub
    || /\bAKIA[0-9A-Z]{16}\b/.test(text) // AWS
    || /\bxox[abpr]-[A-Za-z0-9-]{10,}/.test(text) // Slack
    || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)
}

/** What goes into the system prompt: the memory, cut to a size every model can carry. */
export function memoryForPrompt(memory: string): string {
  const text = memory.trim()
  if (text.length <= maxPromptMemoryChars) return text
  return `${
    text.slice(0, maxPromptMemoryChars)
  }\n\n[The memory continues; it is longer than ${maxPromptMemoryChars.toLocaleString()} characters. Read ${memoryPath()} for the rest, and suggest moving procedures into skills.]`
}

// ── Skills ──────────────────────────────────────────────────────────────

export interface SkillSummary {
  name: string
  description: string
  path: string
}

/** Skill names as the Agent Skills specification allows them. */
export function validSkillName(name: string): boolean {
  return name.length > 0 && name.length <= 64 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)
}

/** Writes `skills/<name>/SKILL.md`. Refuses to replace an existing skill unless told to. */
export async function saveSkill(
  skill: { name: string; description: string; instructions: string; overwrite?: boolean },
  dir = agentDir(),
): Promise<string> {
  const name = skill.name.trim()
  if (!validSkillName(name)) {
    throw new Error(
      'Skill names use lowercase letters, numbers and single hyphens, at most 64 characters (for example "monthly-budget-report")',
    )
  }
  const description = skill.description.trim().replace(/\s*\n\s*/g, ' ')
  if (!description || description.length > 1024)
    throw new Error(
      'The description must say what the skill does and when to use it, in at most 1,024 characters',
    )
  const instructions = skill.instructions.trim()
  if (!instructions) throw new Error('The skill needs instructions')
  const folder = join(skillsDir(dir), name)
  const path = join(folder, 'SKILL.md')
  if (!skill.overwrite && (await exists(path))) {
    throw new Error(
      `A skill named "${name}" exists already. Read ${path} first; to replace it, call again with overwrite: true.`,
    )
  }
  await mkdir(folder, { recursive: true })
  // JSON strings are valid YAML, so any punctuation in the description stays one value.
  const content = `---\nname: ${name}\ndescription: ${
    JSON.stringify(description)
  }\n---\n\n${instructions}\n`
  const temporary = `${path}.tmp`
  await writeFile(temporary, content, 'utf8')
  await rename(temporary, path)
  return path
}

/** Every skill folder with a readable SKILL.md, sorted by name. */
export async function listSkills(dir = agentDir()): Promise<SkillSummary[]> {
  let entries
  try {
    entries = await readdir(skillsDir(dir), { withFileTypes: true })
  } catch (error) {
    if (isNotFound(error)) return []
    throw error
  }
  const skills = await Promise.all(
    entries.filter((entry) => entry.isDirectory()).map(
      async (entry): Promise<SkillSummary | null> => {
        const path = join(skillsDir(dir), entry.name, 'SKILL.md')
        try {
          const front = frontmatter(await readFile(path, 'utf8'))
          return {
            name: front.name || entry.name,
            description: front.description ?? '',
            path,
          }
        } catch {
          return null
        }
      },
    ),
  )
  return skills
    .filter((skill): skill is SkillSummary => skill !== null)
    .sort((left, right) => left.name.localeCompare(right.name))
}

/** The `name` and `description` of a SKILL.md front matter (plain or JSON-quoted values). */
export function frontmatter(content: string): { name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (!match) return {}
  const fields: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^(name|description):\s*(.*)$/.exec(line)
    if (!field) continue
    let value = field[2].trim()
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value) as string
      } catch {
        value = value.slice(1, -1)
      }
    } else if (value.startsWith('\'') && value.endsWith('\'')) {
      value = value.slice(1, -1).replace(/''/g, '\'')
    }
    fields[field[1]] = value
  }
  return fields
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
