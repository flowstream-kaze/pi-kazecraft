/** Drops Markdown punctuation and code bodies that read badly when spoken. */
export function speakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' code block. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Keep the first request short and cap even a single unbroken identifier. */
export function* speechPassages(markdown: string): Generator<string> {
  const sentences = new Intl.Segmenter('en', { granularity: 'sentence' })
  for (const { segment } of sentences.segment(speakableText(markdown))) {
    let rest = segment.trim()
    while (rest.length > 400) {
      const space = rest.lastIndexOf(' ', 400)
      let cut = space > 0 ? space : 400
      if (/[\uD800-\uDBFF]/u.test(rest[cut - 1])) cut--
      yield rest.slice(0, cut)
      rest = rest.slice(cut).trimStart()
    }
    if (rest) yield rest
  }
}
