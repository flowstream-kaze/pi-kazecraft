# Conversation

`useConversationRuntime` owns state for the selected Pi conversation: snapshots, streamed messages, steering queue reconciliation, activity, tool execution updates, observed durations, event sequences, replay of snapshot `liveEvents`, and the committed plan read from `update_plan` results (see [plan](/src/features/plan/README.md)). It rejects stale snapshot responses and batches assistant deltas with `requestAnimationFrame`.

`App.tsx` keeps only cross-feature Pi effects such as session status, dialogs, Git refreshes, and notifications. Live and replayed events pass through that orchestration before reaching the runtime so their ordering and sequence deduplication remain consistent.

Pure protocol, reconciliation, and display rules stay separate:

- `tool-protocol.ts` interprets tool calls and execution updates;
- `message-reconciliation.ts` merges history with live messages;
- `message-display.ts` identifies protocol content visible in the thread and extracts its text;
- `tool-presentation.ts` and `tool-call-presentations/` describe tool-specific display;
- `event-sequence.ts` accepts new sequence numbers and rejects duplicates.

Presentation follows the same ownership boundaries:

- `Conversation.tsx` assembles the thread and owns scrolling and navigation;
- `UserMessageRail.tsx` renders the gutter navigator for user prompts;
- `MessageCard.tsx` renders protocol messages and turn usage;
- `ActivityIndicator.tsx` renders the current Pi activity;
- `Markdown.tsx` owns Markdown and front matter rendering;
- `ToolCallCard.tsx` owns tool state, actions, and expansion;
- `ToolCallOutput.tsx` renders file previews and expanded output;
- `ToolCallEditDiff.tsx` renders edit diffs.

Styles are split by the same surfaces: `conversation.css` for the shell, viewport, and empty/loading states, `messages.css`, `tool-call.css`, `conversation-actions.css`, `user-message-rail.css`, `activity.css`, and `conversation-motion.css`. Composer slash-command styles remain in `composer.css`.

Conversation views are simplified (messages only), semi-detailed (tool headers only; expanded calls show their full output with the existing scroll limits), or detailed (calls with their previews).

## User message rail

`UserMessageRail.tsx` renders marks in the thread gutter, one per user prompt. Hovering previews the prompt text and its send time through the shared `Tooltip`; clicking scrolls the thread back to that message and highlights it.

`user-message-anchors.ts` derives the marks from the reconciled thread entries, so prompts that only carry attachments are labelled instead of dropped. History prompts are addressed by their rendered index (`[data-message-index]`); prompts Pi has not reported yet stay addressable by streamed key (`[data-message-key]`). Both paths reuse the navigation that session-analysis targets already use, which mounts missing history, suspends auto-scroll, and resumes it only when the user returns to the bottom.

The rail renders as soon as the thread holds a user prompt, and stays hidden below 900px, where the message column no longer leaves a gutter.

## Tool call presentations

Tool calls are composed by `ToolCallCard` in `src/features/conversation/ToolCallCard.tsx`; previews and expanded results live in `ToolCallOutput.tsx`. The presentation is selected by `toolCallPresentation()` in `src/features/conversation/tool-presentation.ts`.

By default, the tool header exposes its full title on hover. Once the call is resolved, its status displays the character counts of its serialized JSON arguments (`↘`) and raw text output (`↗`); these values remain available to hover and screen readers. Code and text files show a four-line preview; CSV files show a bounded table preview; a click expands the full output. HTML, SVG, Markdown, and CSV files are rendered directly in the card (HTML in a sandboxed iframe, SVG as an image, Markdown via React-Markdown, CSV as a bounded table); a "View source" label toggles to syntax-highlighted code with line numbers. Markdown previews and source views are capped at 380px with vertical scroll; CSV table previews are capped at 380px and CSV source views at 540px; HTML and SVG previews and their source views are capped at 540px.

Follow the [step-by-step guide](/docs/HOW-TO-TOOL-PRESENTATION.md) before adding a presentation. Add one only when a tool genuinely provides information that is easier to understand in another form.

## Contextual conversation actions

Messages and tool calls expose contextual actions through explicit composition rather than a registry. `DefaultMessageCard` in `MessageCard.tsx` owns actions on ordinary messages; `ToolCallCard.tsx` owns actions on tool calls. Both reuse the `.conversation-actions` styles in `conversation-actions.css`, which reveal actions on hover or keyboard focus and keep them visible on touch devices. Unknown custom messages rendered by `DefaultCustomMessage` do not currently expose this surface.

Action components are implementations, not the extension contract. `CopyButton.tsx` uses the browser Clipboard API, while `OpenFileButton.tsx` delegates to the local backend so the operating system can launch the file. Both report failures through `onError` and expose accessible labels through the shared `Tooltip` component.

- Text messages expose one copy action when `visibleText()` returns content.
- Forkable user messages expose an action that starts a Pi fork before that prompt, refreshes the
  active branch, and places Pi's returned prompt text in the composer for editing.
- Tool calls always expose their serialized input (`↘`) and expose raw output (`↗`) once a result exists, including error results.
- Successful `read`, `write`, and `edit` calls expose an action that resolves relative paths from the session working directory and opens the resulting file, including absolute targets outside it.
- Pending calls have no output or file action. Directional markers distinguish copy actions without visible button text.

Follow the [conversation action guide](/docs/HOW-TO-CONVERSATION-ACTION.md) to add another action. Keep actions icon-only, keyboard-accessible, colocated with their owning content, and explicit in the relevant renderer. Do not introduce a registry unless actions need genuinely dynamic selection.
