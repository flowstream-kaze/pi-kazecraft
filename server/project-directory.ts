import { mkdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Named projects use one portable directory segment beneath the configured project root. */
export function validProjectName(name: string): boolean {
  return name.length > 0 && name.length <= 100 && name === name.trim()
    && !/[<>:"/\\|?*\p{Cc}]/u.test(name) && !name.endsWith('.')
    && !/^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(name)
}

export async function projectDirectory(
  name: string,
  root = process.env.PI_PROJECTS_DIR
    ?? (process.platform === 'win32' ? 'D:\\AI' : join(homedir(), 'AI')),
): Promise<string> {
  if (!validProjectName(name)) throw new Error('Choose a valid project folder name')
  const path = join(root, name)
  await mkdir(path, { recursive: true })
  return realpath(path)
}
