/** How much of Pi's tool activity the conversation shows. */
export const conversationViewDetails = {
  simple: { label: 'Simplified view', description: 'Messages only, without tool calls' },
  'semi-detailed': {
    label: 'Semi-detailed view',
    description: 'Tool headers only; click one to expand it',
  },
  detailed: { label: 'Detailed view', description: 'Visible calls with expandable preview' },
} as const

export type ConversationView = keyof typeof conversationViewDetails

export const conversationViews = Object.keys(conversationViewDetails) as ConversationView[]

/** Cycles simple → semi-detailed → detailed for the palette command and shortcut. */
export function nextConversationView(current: ConversationView): ConversationView {
  return conversationViews[(conversationViews.indexOf(current) + 1) % conversationViews.length]
}
